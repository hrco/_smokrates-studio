import {request, type Server} from 'node:http';
import type {DatabaseSync} from 'node:sqlite';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createStudioServer} from '../src/daemon/studioServer';
import type {TickActions} from '../src/daemon/tickActions';
import {resolveTickActions} from '../src/daemon/resolveTickActions';
import {openStudioDb} from '../src/store/studioDb';

const NOW_MS = Date.parse('2026-10-26T20:00:00+01:00');
const DUE_MS = Date.parse('2026-10-26T18:00:00+01:00');
const WEEK = '2026-10-26';

const idleCheck: TickActions['checkPublishes'] = async () => ({
  sent: 0,
  failed: 0,
  stalled: 0,
  stillProcessing: 0,
  statusErrors: [],
});

type Reply = {status: number; body: string};

type Sandbox = {server: Server; db: DatabaseSync; port: number};

let sandbox: Sandbox | undefined;

async function start(tick?: TickActions): Promise<Sandbox> {
  const {db} = openStudioDb({dbPath: ':memory:'});
  let nextId = 0;
  const server = createStudioServer({
    db,
    nowMs: () => NOW_MS,
    newId: () => `id-${++nextId}`,
    outDir: '/tmp/studio-tick-out',
    webDir: '/tmp/studio-tick-web',
    tick,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('studio server did not bind a port');
  return {server, db, port: address.port};
}

function send(options: {method?: string; path: string; headers?: Record<string, string>} = {path: '/api/tick'}): Promise<Reply> {
  if (sandbox === undefined) throw new Error('sandbox is not started');
  const {port} = sandbox;
  const headers = {Host: `127.0.0.1:${port}`, ...options.headers};
  return new Promise((resolve, reject) => {
    const req = request(
      {host: '127.0.0.1', port, method: options.method ?? 'POST', path: options.path, headers},
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8')}));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function seedDueEpisode(db: DatabaseSync): void {
  db.prepare("INSERT INTO plans (week_start, status, created_at_ms) VALUES (?, 'approved', 1)").run(WEEK);
  db.prepare(
    `INSERT INTO episodes (id, week_start, night, format, track_slug, start_second, duration_seconds,
       claim, caption, publish_at_ms, label_decision, status)
     VALUES ('ep-1', ?, 1, 'track_card', 'slug', 0, 15, 'claim', 'caption', ?, 'label_off', 'approved')`,
  ).run(WEEK, DUE_MS);
  db.prepare(
    `INSERT INTO renders (id, episode_id, file_path, duration_seconds, frame_count, created_at_ms)
     VALUES ('render-1', 'ep-1', 'out/ep-1.mp4', 15, 450, 1)`,
  ).run();
}

afterEach(async () => {
  if (sandbox === undefined) return;
  sandbox.server.closeAllConnections();
  const {server} = sandbox;
  sandbox = undefined;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('tick.run', () => {
  it('returns 202 and the job id when a send starts', async () => {
    const sendEpisode = vi.fn<TickActions['sendEpisode']>(async () => ({kind: 'sent-to-tiktok', publishId: 'pub-1'}));
    sandbox = await start({checkPublishes: idleCheck, sendEpisode});
    seedDueEpisode(sandbox.db);

    const reply = await send({path: '/api/tick'});

    expect(reply.status).toBe(202);
    expect(JSON.parse(reply.body)).toEqual({jobId: 'id-1'});
    expect(sendEpisode).toHaveBeenCalledOnce();
  });

  it('returns 200 idle when nothing is due', async () => {
    sandbox = await start({
      checkPublishes: idleCheck,
      sendEpisode: async () => ({kind: 'sent-to-tiktok', publishId: 'pub-1'}),
    });

    const reply = await send({path: '/api/tick'});

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({status: 'idle', reason: 'nothing-due'});
  });

  it('returns 409 while a send is still running', async () => {
    let releaseSend: () => void = () => {};
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    sandbox = await start({
      checkPublishes: idleCheck,
      sendEpisode: async () => {
        markStarted();
        await sendGate;
        return {kind: 'sent-to-tiktok', publishId: 'pub-1'};
      },
    });
    seedDueEpisode(sandbox.db);

    const first = send({path: '/api/tick'});
    await started;
    const second = await send({path: '/api/tick'});
    releaseSend();
    const finished = await first;

    expect(second.status).toBe(409);
    expect(JSON.parse(second.body)).toEqual({code: 'tick_busy', message: 'A send is already running.'});
    expect(finished.status).toBe(202);
  });

  it('returns idle tiktok-not-connected when credentials are missing', () => {
    const {db} = openStudioDb({dbPath: ':memory:'});
    expect(resolveTickActions({env: {}, db, outDir: '/tmp/studio-tick-out'})).toBeUndefined();
  });

  it('builds tick actions from credentials without calling fetch', () => {
    const {db} = openStudioDb({dbPath: ':memory:'});
    const fetchFn = vi.fn<typeof fetch>();
    const actions = resolveTickActions({
      env: {TIKTOK_CLIENT_KEY: 'key', TIKTOK_CLIENT_SECRET: 'secret'},
      db,
      outDir: '/tmp/studio-tick-out',
      fetchFn,
      tokenStore: {
        async load() {
          return undefined;
        },
        async save() {},
      },
    });
    expect(actions).toBeDefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns 202 and the job id when the share cap refuses the send', async () => {
    sandbox = await start({
      checkPublishes: idleCheck,
      sendEpisode: async () => ({kind: 'share-cap-reached', inFlightShares: 5}),
    });
    seedDueEpisode(sandbox.db);

    const reply = await send({path: '/api/tick'});

    expect(reply.status).toBe(202);
    expect(JSON.parse(reply.body)).toEqual({jobId: 'id-1'});
    const job = sandbox.db.prepare('SELECT status, message FROM jobs WHERE id = ?').get('id-1');
    expect(job).toMatchObject({status: 'failed'});
  });

  it('answers 200 idle tiktok-not-connected and still starts without tick actions', async () => {
    sandbox = await start();
    seedDueEpisode(sandbox.db);

    const reply = await send({path: '/api/tick'});

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({status: 'idle', reason: 'tiktok-not-connected'});
  });

  it('refuses a foreign Origin on the tick the same way as the other routes', async () => {
    sandbox = await start();

    const reply = await send({path: '/api/tick', headers: {Origin: 'https://evil.example'}});

    expect(reply.status).toBe(403);
    expect(JSON.parse(reply.body).code).toBe('foreign_origin');
  });
});
