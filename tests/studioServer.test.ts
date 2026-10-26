import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {request, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {lookUpStaticFile} from '../src/daemon/serveStatic';
import {createStudioServer} from '../src/daemon/studioServer';
import {openStudioDb} from '../src/store/studioDb';

const NOW_MS = Date.parse('2026-10-26T08:00:00+01:00');
const VIDEO_BYTES = Buffer.from('0123456789abcdefghij');

type Reply = {status: number; headers: Record<string, string | string[] | undefined>; body: string};

type Sandbox = {
  server: Server;
  db: DatabaseSync;
  rootDir: string;
  port: number;
  loggedErrors: string[];
};

let sandbox: Sandbox;

async function startSandbox(): Promise<Sandbox> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-server-'));
  const webDir = path.join(rootDir, 'web');
  const outDir = path.join(rootDir, 'out');
  await mkdir(path.join(webDir, 'review'), {recursive: true});
  await mkdir(path.join(webDir, 'vendor/dnp-xiii'), {recursive: true});
  await mkdir(outDir, {recursive: true});
  await writeFile(path.join(webDir, 'review/index.html'), '<!doctype html><title>Week</title>');
  await writeFile(path.join(webDir, 'review.js'), 'export {};');
  await writeFile(path.join(webDir, 'review/review.css'), 'body{}');
  await writeFile(path.join(webDir, 'vendor/dnp-xiii/tokens.css'), ':root{}');
  await writeFile(path.join(rootDir, 'secret.txt'), 'top secret');
  await symlink(path.join(rootDir, 'secret.txt'), path.join(webDir, 'vendor/dnp-xiii/leak.css'));
  await writeFile(path.join(outDir, 'ep-1.mp4'), VIDEO_BYTES);

  const {db} = openStudioDb({dbPath: ':memory:'});
  const loggedErrors: string[] = [];
  let idCounter = 0;
  const server = createStudioServer({
    db,
    nowMs: () => NOW_MS,
    newId: () => `ep-${++idCounter}`,
    outDir,
    webDir,
    logError: (message) => loggedErrors.push(message),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {server, db, rootDir, port, loggedErrors};
}

function send(options: {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  json?: unknown;
}): Promise<Reply> {
  const payload = options.json === undefined ? options.body : JSON.stringify(options.json);
  const headers: Record<string, string> = {Host: `127.0.0.1:${sandbox.port}`, ...options.headers};
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  if (payload !== undefined) headers['Content-Length'] = String(Buffer.byteLength(payload));
  return new Promise((resolve, reject) => {
    const req = request(
      {host: '127.0.0.1', port: sandbox.port, method: options.method ?? 'GET', path: options.path, headers},
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8')}),
        );
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function buildEpisode(night: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    night,
    format: 'track_card',
    trackSlug: 'golden-hour-groove',
    startSecond: 12,
    durationSeconds: 15,
    caption: 'Golden Hour Groove',
    claim: 'New dub every night',
    publishAt: `2026-10-${27 + night}T18:00:00+01:00`,
    labelDecision: 'label_off',
    ...overrides,
  };
}

function importBody(nightCount = 2, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const episodes = Array.from({length: nightCount}, (_, index) => buildEpisode(index + 1));
  return {weekStart: '2026-10-26', episodes, ...extra};
}

async function importWeek(nightCount = 2): Promise<void> {
  const reply = await send({method: 'POST', path: '/api/plans', json: importBody(nightCount)});
  expect(reply.status).toBe(201);
}

function addRender(episodeId: string, filePath = `out/${episodeId}.mp4`): void {
  sandbox.db
    .prepare(
      `INSERT INTO renders (id, episode_id, file_path, duration_seconds, frame_count, created_at_ms)
       VALUES (?, ?, ?, 15, 450, 1)`,
    )
    .run(`render-${episodeId}`, episodeId, filePath);
  sandbox.db.prepare("UPDATE episodes SET status = 'ready' WHERE id = ?").run(episodeId);
}

beforeEach(async () => {
  sandbox = await startSandbox();
});

afterEach(async () => {
  sandbox.server.closeAllConnections();
  await new Promise<void>((resolve) => sandbox.server.close(() => resolve()));
  await rm(sandbox.rootDir, {recursive: true, force: true});
});

describe('health and plan routes', () => {
  it('health.get reports the schema version', async () => {
    const reply = await send({path: '/api/health'});
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({isUp: true, schemaVersion: 2, isWorkerBusy: false});
  });

  it('health.get is busy for a running render or asset, and idle for a send or a finished job', async () => {
    const insert = sandbox.db.prepare(
      'INSERT INTO jobs (id, kind, status, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 1, 1)',
    );
    insert.run('job-send', 'send', 'running');
    expect(JSON.parse((await send({path: '/api/health'})).body).isWorkerBusy).toBe(false);

    insert.run('job-asset', 'asset', 'running');
    expect(JSON.parse((await send({path: '/api/health'})).body).isWorkerBusy).toBe(true);

    sandbox.db.prepare("UPDATE jobs SET status = 'succeeded' WHERE id = 'job-asset'").run();
    insert.run('job-render', 'render', 'queued');
    expect(JSON.parse((await send({path: '/api/health'})).body).isWorkerBusy).toBe(false);

    sandbox.db.prepare("UPDATE jobs SET status = 'running' WHERE id = 'job-render'").run();
    expect(JSON.parse((await send({path: '/api/health'})).body).isWorkerBusy).toBe(true);
  });

  it('plan.import writes the week, then refuses a second import over work in progress', async () => {
    await importWeek();
    addRender('ep-1');

    const again = await send({method: 'POST', path: '/api/plans', json: importBody()});
    expect(again.status).toBe(409);
    expect(JSON.parse(again.body).message).toBe(
      'This week already has work in progress. Send replace to overwrite it.',
    );

    const replaced = await send({method: 'POST', path: '/api/plans', json: importBody(2, {replace: true})});
    expect(replaced.status).toBe(201);
  });

  it('plan.import names the field of an invalid night and the health claim', async () => {
    const body = {weekStart: '2026-10-26', episodes: [buildEpisode(1, {caption: 'Sleep better'})]};
    const reply = await send({method: 'POST', path: '/api/plans', json: body});
    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body)).toEqual({
      code: 'invalid_input',
      field: 'episodes[0].caption',
      message: 'The caption makes a health claim.',
    });
  });

  it('plan.import refuses bad JSON and a missing body', async () => {
    const badJson = await send({method: 'POST', path: '/api/plans', body: '{nope', headers: {'Content-Type': 'application/json'}});
    expect(badJson.status).toBe(400);
    const noBody = await send({method: 'POST', path: '/api/plans'});
    expect(noBody.status).toBe(400);
  });

  it('plan.get returns the plan, 404 for an empty week, 400 for a bad date', async () => {
    await importWeek();
    const found = await send({path: '/api/plans/2026-10-26'});
    expect(found.status).toBe(200);
    expect(JSON.parse(found.body).episodes).toHaveLength(2);

    const empty = await send({path: '/api/plans/2026-11-02'});
    expect(empty.status).toBe(404);
    expect(JSON.parse(empty.body).message).toBe('No plan for this week yet.');

    expect((await send({path: '/api/plans/2026-10-27'})).status).toBe(400);
  });

  it('week.approve names the first unrendered night, then approves', async () => {
    await importWeek();
    addRender('ep-2');
    const blocked = await send({method: 'POST', path: '/api/plans/2026-10-26/approve'});
    expect(blocked.status).toBe(409);
    expect(JSON.parse(blocked.body).message).toBe('Night 1 is not rendered. Render it or skip it.');

    addRender('ep-1');
    const approved = await send({method: 'POST', path: '/api/plans/2026-10-26/approve'});
    expect(approved.status).toBe(200);
    expect(JSON.parse(approved.body).status).toBe('approved');
  });

  it('answers 404 for an unknown path and 405 for a wrong method', async () => {
    expect((await send({path: '/api/nothing'})).status).toBe(404);
    expect((await send({method: 'DELETE', path: '/api/health'})).status).toBe(405);
  });
});

describe('episode routes', () => {
  beforeEach(async () => {
    await importWeek();
  });

  it('episode.update changes the caption and returns the episode', async () => {
    const reply = await send({method: 'PATCH', path: '/api/episodes/ep-1', json: {caption: 'New words'}});
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body).caption).toBe('New words');
  });

  it('episode.update refuses a past time, an empty body, a health claim and an unknown episode', async () => {
    const past = await send({method: 'PATCH', path: '/api/episodes/ep-1', json: {publishAt: '2026-10-25T10:00:00+01:00'}});
    expect(past.status).toBe(422);
    expect(JSON.parse(past.body).message).toBe('That time is in the past.');

    expect((await send({method: 'PATCH', path: '/api/episodes/ep-1', json: {}})).status).toBe(400);

    const claim = await send({method: 'PATCH', path: '/api/episodes/ep-1', json: {caption: 'Heal fast'}});
    expect(JSON.parse(claim.body).message).toBe('That caption makes a health claim.');

    expect((await send({method: 'PATCH', path: '/api/episodes/nope', json: {caption: 'x'}})).status).toBe(404);
  });

  it('episode.approve refuses an unrendered night, then approves a rendered one', async () => {
    const blocked = await send({method: 'POST', path: '/api/episodes/ep-1/approve'});
    expect(blocked.status).toBe(409);
    expect(JSON.parse(blocked.body).message).toBe('Render this night before you approve it.');

    addRender('ep-1');
    const approved = await send({method: 'POST', path: '/api/episodes/ep-1/approve'});
    expect(approved.status).toBe(200);
    expect(JSON.parse(approved.body).status).toBe('approved');
  });

  it('episode.approve refuses a night that is not new', async () => {
    addRender('ep-1');
    sandbox.db.prepare("UPDATE episodes SET status = 'not_new' WHERE id = 'ep-1'").run();
    const reply = await send({method: 'POST', path: '/api/episodes/ep-1/approve'});
    expect(reply.status).toBe(409);
    expect(JSON.parse(reply.body)).toMatchObject({code: 'not_new', message: 'Night 1 is not new. Change it or skip it.'});
  });

  it('episode.skip skips, and refuses a sent night', async () => {
    const skipped = await send({method: 'POST', path: '/api/episodes/ep-1/skip'});
    expect(JSON.parse(skipped.body).status).toBe('skipped');

    sandbox.db
      .prepare("INSERT INTO publishes (id, episode_id, platform, status, created_at_ms) VALUES ('p', 'ep-2', 'tiktok', 'sent', 1)")
      .run();
    const sent = await send({method: 'POST', path: '/api/episodes/ep-2/skip'});
    expect(sent.status).toBe(409);
    expect(JSON.parse(sent.body).message).toBe('This night is already with TikTok and cannot be skipped.');
  });
});

describe('publishes.list', () => {
  it('lists the publish rows of one week and validates weekStart', async () => {
    await importWeek();
    sandbox.db
      .prepare(
        "INSERT INTO publishes (id, episode_id, platform, status, created_at_ms, external_id, last_checked_at_ms) VALUES ('p', 'ep-1', 'tiktok', 'sent', 1, 'pub-9', 1792990800000)",
      )
      .run();

    const reply = await send({path: '/api/publishes?weekStart=2026-10-26'});
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual([
      {
        id: 'p',
        episodeId: 'ep-1',
        platform: 'tiktok',
        status: 'sent',
        attempts: 0,
        externalId: 'pub-9',
        lastCheckedAt: '2026-10-26T06:00:00+01:00',
      },
    ]);
    expect(JSON.parse((await send({path: '/api/publishes?weekStart=2026-11-02'})).body)).toEqual([]);
    expect((await send({path: '/api/publishes'})).status).toBe(400);
  });
});

describe('request guards', () => {
  it('refuses a Host header that is not loopback on this port', async () => {
    expect((await send({path: '/api/health', headers: {Host: 'evil.example'}})).status).toBe(421);
    expect((await send({path: '/api/health', headers: {Host: '127.0.0.1:1'}})).status).toBe(421);
    expect((await send({path: '/api/health', headers: {Host: `localhost:${sandbox.port}`}})).status).toBe(200);
  });

  it('refuses a cross-origin POST and allows the same origin and no origin', async () => {
    const foreign = await send({method: 'POST', path: '/api/plans', json: importBody(), headers: {Origin: 'https://evil.example'}});
    expect(foreign.status).toBe(403);
    expect((await send({method: 'POST', path: '/api/plans', json: importBody(), headers: {Origin: 'null'}})).status).toBe(403);

    const sameOrigin = await send({
      method: 'POST',
      path: '/api/plans',
      json: importBody(),
      headers: {Origin: `http://127.0.0.1:${sandbox.port}`},
    });
    expect(sameOrigin.status).toBe(201);
  });

  it('refuses a body that is not application/json', async () => {
    const reply = await send({method: 'POST', path: '/api/plans', body: 'x=1', headers: {'Content-Type': 'text/plain'}});
    expect(reply.status).toBe(415);
  });

  it('accepts application/json with a charset', async () => {
    const reply = await send({
      method: 'POST',
      path: '/api/plans',
      body: JSON.stringify(importBody()),
      headers: {'Content-Type': 'application/json; charset=utf-8'},
    });
    expect(reply.status).toBe(201);
  });

  it('refuses a body over 64 KB and closes the connection', async () => {
    const big = JSON.stringify({weekStart: '2026-10-26', episodes: [], padding: 'x'.repeat(70 * 1024)});
    const reply = await send({method: 'POST', path: '/api/plans', body: big, headers: {'Content-Type': 'application/json'}});
    expect(reply.status).toBe(413);
    expect(reply.headers.connection).toBe('close');
  });

  it('sends security headers', async () => {
    const reply = await send({path: '/api/health'});
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(String(reply.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
  });

  it('answers 500 with a generic message, logs the cause, and never leaks a stack', async () => {
    sandbox.db.close();
    const reply = await send({path: '/api/health'});
    expect(reply.status).toBe(500);
    expect(JSON.parse(reply.body)).toEqual({code: 'internal', message: 'Something went wrong in the studio. Try again.'});
    expect(sandbox.loggedErrors).toHaveLength(1);
  });
});

describe('static files', () => {
  it('serves the page, script, style and vendored tokens with fixed content types', async () => {
    const page = await send({path: '/'});
    expect([page.status, page.headers['content-type']]).toEqual([200, 'text/html; charset=utf-8']);
    expect((await send({path: '/review.js'})).headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect((await send({path: '/review.css'})).headers['content-type']).toBe('text/css; charset=utf-8');
    const tokens = await send({path: '/vendor/dnp-xiii/tokens.css?v=1'});
    expect([tokens.status, tokens.body]).toEqual([200, ':root{}']);
  });

  it.each([
    '/vendor/dnp-xiii/../../secret.txt',
    '/vendor/../../secret.txt',
    '/vendor/dnp-xiii/%2e%2e/%2e%2e/secret.txt',
    '/vendor/dnp-xiii/..%2fsecret.txt',
    '/vendor/dnp-xiii/%2E%2E%5Csecret.txt',
  ])('refuses the traversal %s', async (requestPath) => {
    const reply = await send({path: requestPath});
    expect([400, 404]).toContain(reply.status);
    expect(reply.body).not.toContain('top secret');
  });

  it('does not follow a symlink out of the web folder', async () => {
    const reply = await send({path: '/vendor/dnp-xiii/leak.css'});
    expect(reply.status).toBe(404);
    expect(reply.body).not.toContain('top secret');
  });

  it('answers 404 for a path outside the allowed set', async () => {
    expect((await send({path: '/package.json'})).status).toBe(404);
    expect((await send({path: '/vendor/dnp-xiii/missing.css'})).status).toBe(404);
  });
});

describe('page files', () => {
  it('every page file the server maps exists in the real web folder', () => {
    const realWebDir = path.resolve(__dirname, '../web');
    for (const urlPath of ['/', '/review.js', '/review.css']) {
      const lookup = lookUpStaticFile(urlPath, realWebDir);
      if (lookup.kind !== 'file') throw new Error(`${urlPath} is not mapped`);
      expect(existsSync(path.join(lookup.rootDir, lookup.relativePath)), urlPath).toBe(true);
    }
  });
});

describe('media', () => {
  beforeEach(async () => {
    await importWeek();
  });

  it('answers 404 for an unknown episode and for a night with no render', async () => {
    expect((await send({path: '/media/nope.mp4'})).status).toBe(404);
    expect((await send({path: '/media/ep-1.mp4'})).status).toBe(404);
  });

  it('streams the render whole, and as 206 for a Range request', async () => {
    addRender('ep-1');
    const whole = await send({path: '/media/ep-1.mp4'});
    expect([whole.status, whole.body, whole.headers['accept-ranges']]).toEqual([200, VIDEO_BYTES.toString(), 'bytes']);

    const part = await send({path: '/media/ep-1.mp4', headers: {Range: 'bytes=5-9'}});
    expect(part.status).toBe(206);
    expect(part.body).toBe('56789');
    expect(part.headers['content-range']).toBe('bytes 5-9/20');

    const tail = await send({path: '/media/ep-1.mp4', headers: {Range: 'bytes=15-'}});
    expect([tail.status, tail.body]).toEqual([206, 'fghij']);
    const suffix = await send({path: '/media/ep-1.mp4', headers: {Range: 'bytes=-3'}});
    expect([suffix.status, suffix.body]).toEqual([206, 'hij']);
  });

  it('answers 416 for a range past the end', async () => {
    addRender('ep-1');
    const reply = await send({path: '/media/ep-1.mp4', headers: {Range: 'bytes=50-60'}});
    expect(reply.status).toBe(416);
    expect(reply.headers['content-range']).toBe('bytes */20');
  });

  it('clamps a range past the end, rejects an empty or reversed range, and ignores a multi-range', async () => {
    addRender('ep-1');
    const clamped = await send({path: '/media/ep-1.mp4', headers: {Range: 'bytes=18-100'}});
    expect([clamped.status, clamped.body, clamped.headers['content-range']]).toEqual([206, 'ij', 'bytes 18-19/20']);

    const reversed = await send({path: '/media/ep-1.mp4', headers: {Range: 'bytes=10-5'}});
    expect(reversed.status).toBe(416);
    const emptySuffix = await send({path: '/media/ep-1.mp4', headers: {Range: 'bytes=-0'}});
    expect(emptySuffix.status).toBe(416);

    const multi = await send({path: '/media/ep-1.mp4', headers: {Range: 'bytes=0-1,2-3'}});
    expect([multi.status, multi.body]).toEqual([200, VIDEO_BYTES.toString()]);
  });

  it('refuses a render path that resolves outside the out folder', async () => {
    addRender('ep-1', 'secret.txt');
    const reply = await send({path: '/media/ep-1.mp4'});
    expect(reply.status).toBe(404);
    expect(reply.body).not.toContain('top secret');
  });
});
