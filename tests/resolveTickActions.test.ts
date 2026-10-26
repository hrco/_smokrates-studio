import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {resolveTickActions} from '../src/daemon/resolveTickActions';
import {openStudioDb} from '../src/store/studioDb';
import type {TikTokTokens} from '../src/tiktok/oauth';
import type {TokenStore} from '../src/tiktok/tokenStore';

const NOW_MS = Date.parse('2026-10-26T20:00:00+01:00');
const WEEK = '2026-10-26';

const okInit = {
  data: {publish_id: 'pub-1', upload_url: 'https://upload.example/secret-path'},
  error: {code: 'ok', message: '', log_id: 'log-1'},
};

type MemoryStore = TokenStore & {saved: TikTokTokens[]};

function memoryStore(initial: TikTokTokens | undefined): MemoryStore {
  let current = initial;
  const saved: TikTokTokens[] = [];
  return {
    saved,
    async load() {
      return current;
    },
    async save(next) {
      current = next;
      saved.push(next);
    },
  };
}

function tokensValidAt(nowMs: number, accessToken = 'access-1'): TikTokTokens {
  return {
    accessToken,
    refreshToken: 'refresh-1',
    accessExpiresAt: nowMs + 60 * 60_000,
    refreshExpiresAt: nowMs + 24 * 60 * 60_000,
    openId: 'open-1',
    scope: 'video.upload',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function seedEpisode(db: DatabaseSync, filePath: string): void {
  db.prepare("INSERT INTO plans (week_start, status, created_at_ms) VALUES (?, 'approved', 1)").run(WEEK);
  db.prepare(
    `INSERT INTO episodes (id, week_start, night, format, track_slug, start_second, duration_seconds,
       claim, caption, publish_at_ms, label_decision, status)
     VALUES ('ep-1', ?, 1, 'track_card', 'slug', 0, 15, 'claim', 'caption', 1, 'label_off', 'approved')`,
  ).run(WEEK);
  db.prepare(
    `INSERT INTO renders (id, episode_id, file_path, duration_seconds, frame_count, created_at_ms)
     VALUES ('render-1', 'ep-1', ?, 15, 450, 1)`,
  ).run(filePath);
}

function publishCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM publishes').get();
  return Number(row?.count ?? 0);
}

let rootDir: string | undefined;

afterEach(async () => {
  if (rootDir !== undefined) await rm(rootDir, {recursive: true, force: true});
  rootDir = undefined;
});

describe('resolveTickActions', () => {
  it('reports a missing token on the publish check and does not call TikTok', async () => {
    const {db} = openStudioDb({dbPath: ':memory:'});
    const fetchFn = vi.fn<typeof fetch>();
    const actions = resolveTickActions({
      env: {TIKTOK_CLIENT_KEY: 'key', TIKTOK_CLIENT_SECRET: 'secret'},
      db,
      outDir: '/tmp/studio-tick-out',
      fetchFn,
      tokenStore: memoryStore(undefined),
    });

    const summary = await actions?.checkPublishes(NOW_MS);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(summary).toMatchObject({sent: 0, failed: 0, stalled: 0, stillProcessing: 0});
    expect(summary?.statusErrors).toEqual([
      expect.objectContaining({operation: 'get-access-token', code: 'no-tokens'}),
    ]);
  });

  it('checks a processing share with the saved access token', async () => {
    const {db} = openStudioDb({dbPath: ':memory:'});
    seedEpisode(db, 'out/ep-1.mp4');
    db.prepare(
      `INSERT INTO publishes (id, episode_id, platform, external_id, status, attempts, created_at_ms)
       VALUES ('row-1', 'ep-1', 'tiktok', 'pub-1', 'processing', 1, ?)`,
    ).run(NOW_MS);
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({data: {status: 'SEND_TO_USER_INBOX'}, error: {code: 'ok', message: '', log_id: 'log-1'}}),
    );
    const actions = resolveTickActions({
      env: {TIKTOK_CLIENT_KEY: 'key', TIKTOK_CLIENT_SECRET: 'secret'},
      db,
      outDir: '/tmp/studio-tick-out',
      fetchFn,
      tokenStore: memoryStore(tokensValidAt(NOW_MS)),
    });

    const summary = await actions?.checkPublishes(NOW_MS);

    expect(summary).toEqual({sent: 1, failed: 0, stalled: 0, stillProcessing: 0, statusErrors: []});
    expect(fetchFn).toHaveBeenCalledOnce();
    const [, init] = fetchFn.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({Authorization: 'Bearer access-1'});
    expect(init?.body).toBe(JSON.stringify({publish_id: 'pub-1'}));
    expect(db.prepare("SELECT status FROM publishes WHERE id = 'row-1'").get()).toEqual({status: 'sent'});
  });

  it('does not claim a publish when the render resolves outside the out folder', async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'tick-actions-'));
    const outDir = path.join(rootDir, 'out');
    await mkdir(outDir);
    await writeFile(path.join(rootDir, 'secret.mp4'), Buffer.from('not-the-render'));
    const {db} = openStudioDb({dbPath: ':memory:'});
    seedEpisode(db, 'secret.mp4');
    const fetchFn = vi.fn<typeof fetch>();
    const actions = resolveTickActions({
      env: {TIKTOK_CLIENT_KEY: 'key', TIKTOK_CLIENT_SECRET: 'secret'},
      db,
      outDir,
      fetchFn,
      tokenStore: memoryStore(tokensValidAt(NOW_MS)),
    });

    const result = await actions?.sendEpisode({episodeId: 'ep-1', nowMs: NOW_MS, newId: () => 'row-1'});

    expect(result).toMatchObject({kind: 'upload-failed', publishId: null, error: {operation: 'read-render', code: 'no-render'}});
    expect(fetchFn).not.toHaveBeenCalled();
    expect(publishCount(db)).toBe(0);
  });

  it('does not claim a publish when the token is missing, even if the render is readable', async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'tick-actions-'));
    const outDir = path.join(rootDir, 'out');
    await mkdir(outDir);
    await writeFile(path.join(outDir, 'ep-1.mp4'), Buffer.from('video-bytes'));
    const {db} = openStudioDb({dbPath: ':memory:'});
    seedEpisode(db, 'out/ep-1.mp4');
    const fetchFn = vi.fn<typeof fetch>();
    const actions = resolveTickActions({
      env: {TIKTOK_CLIENT_KEY: 'key', TIKTOK_CLIENT_SECRET: 'secret'},
      db,
      outDir,
      fetchFn,
      tokenStore: memoryStore(undefined),
    });

    const result = await actions?.sendEpisode({episodeId: 'ep-1', nowMs: NOW_MS, newId: () => 'row-1'});

    expect(result).toMatchObject({kind: 'upload-failed', publishId: null, error: {operation: 'get-access-token', code: 'no-tokens'}});
    expect(fetchFn).not.toHaveBeenCalled();
    expect(publishCount(db)).toBe(0);
  });

  it('uploads the render bytes with the saved access token and leaves the row processing', async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'tick-actions-'));
    const outDir = path.join(rootDir, 'out');
    await mkdir(outDir);
    const video = Buffer.from('video-bytes');
    await writeFile(path.join(outDir, 'ep-1.mp4'), video);
    const {db} = openStudioDb({dbPath: ':memory:'});
    seedEpisode(db, 'out/ep-1.mp4');
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === 'PUT') return new Response(null, {status: 201});
      return jsonResponse(okInit);
    });
    const actions = resolveTickActions({
      env: {TIKTOK_CLIENT_KEY: 'key', TIKTOK_CLIENT_SECRET: 'secret'},
      db,
      outDir,
      fetchFn,
      tokenStore: memoryStore(tokensValidAt(NOW_MS)),
    });

    const result = await actions?.sendEpisode({episodeId: 'ep-1', nowMs: NOW_MS, newId: () => 'row-1'});

    expect(result).toEqual({kind: 'sent-to-tiktok', publishId: 'pub-1'});
    const initCall = fetchFn.mock.calls[0]?.[1];
    expect(initCall?.headers).toMatchObject({Authorization: 'Bearer access-1'});
    expect(String(initCall?.body)).toContain(`"video_size":${video.byteLength}`);
    expect(Buffer.from(fetchFn.mock.calls[1]?.[1]?.body as Uint8Array)).toEqual(video);
    expect(db.prepare('SELECT status, external_id FROM publishes').get()).toEqual({status: 'processing', external_id: 'pub-1'});
  });

  it('refreshes with the sandbox client when both credential pairs are set', async () => {
    const {db} = openStudioDb({dbPath: ':memory:'});
    const store = memoryStore({
      ...tokensValidAt(NOW_MS),
      accessExpiresAt: NOW_MS + 60_000,
    });
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        access_token: 'access-new',
        refresh_token: 'refresh-new',
        expires_in: 86_400,
        refresh_expires_in: 86_400,
        open_id: 'open-1',
        scope: 'video.upload',
      }),
    );
    const actions = resolveTickActions({
      env: {
        TIKTOK_CLIENT_KEY: 'prod-key',
        TIKTOK_CLIENT_SECRET: 'prod-secret',
        TIKTOK_CLIENT_KEY_SANDBOX: 'sb-key',
        TIKTOK_CLIENT_SECRET_SANDBOX: 'sb-secret',
      },
      db,
      outDir: '/tmp/studio-tick-out',
      fetchFn,
      tokenStore: store,
    });

    const summary = await actions?.checkPublishes(NOW_MS);

    expect(summary?.statusErrors).toEqual([]);
    expect(fetchFn).toHaveBeenCalledOnce();
    const body = String(fetchFn.mock.calls[0]?.[1]?.body);
    expect(body).toContain('client_key=sb-key');
    expect(body).toContain('client_secret=sb-secret');
    expect(body).toContain('grant_type=refresh_token');
    expect(body).not.toContain('prod-key');
    expect(body).not.toContain('prod-secret');
    expect(store.saved[0]?.accessToken).toBe('access-new');
  });
});
