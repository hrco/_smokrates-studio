import type {DatabaseSync} from 'node:sqlite';
import {describe, expect, it, vi} from 'vitest';
import {runTick, type RunTickResult} from '../src/publish/runTick';
import {failInterruptedSends} from '../src/publish/tickSelection';
import {sendEpisodeToTikTok} from '../src/publish/sendEpisodeToTikTok';
import type {CheckTikTokPublishesSummary} from '../src/publish/checkTikTokPublishes';
import type {SendEpisodeToTikTokResult} from '../src/publish/sendEpisodeToTikTok';
import {openStudioDb} from '../src/store/studioDb';

const WEEK = '2026-10-26';
const NOW_MS = Date.parse('2026-10-26T20:00:00+01:00');
const DUE_MS = Date.parse('2026-10-26T18:00:00+01:00');
const NOT_DUE_MS = Date.parse('2026-10-26T21:00:00+01:00');

const idleSummary: CheckTikTokPublishesSummary = {
  sent: 0,
  failed: 0,
  stalled: 0,
  stillProcessing: 0,
  statusErrors: [],
};

type Seed = {
  id?: string;
  night?: number;
  episodeStatus?: string;
  planStatus?: string;
  publishAtMs?: number;
  hasRender?: boolean;
  publishStatus?: string;
  publishCreatedAtMs?: number;
};

function openDb(): DatabaseSync {
  return openStudioDb({dbPath: ':memory:'}).db;
}

function seedEpisode(db: DatabaseSync, seed: Seed = {}): string {
  const id = seed.id ?? 'ep-1';
  const planStatus = seed.planStatus ?? 'approved';
  const existingPlan = db.prepare('SELECT status FROM plans WHERE week_start = ?').get(WEEK);
  if (existingPlan === undefined) {
    db.prepare('INSERT INTO plans (week_start, status, created_at_ms) VALUES (?, ?, 1)').run(WEEK, planStatus);
  }
  db.prepare(
    `INSERT INTO episodes (id, week_start, night, format, track_slug, start_second, duration_seconds,
       claim, caption, publish_at_ms, label_decision, status)
     VALUES (?, ?, ?, 'track_card', 'slug', 0, 15, 'claim', 'caption', ?, 'label_off', ?)`,
  ).run(id, WEEK, seed.night ?? 1, seed.publishAtMs ?? DUE_MS, seed.episodeStatus ?? 'approved');
  if (seed.hasRender !== false) {
    db.prepare(
      `INSERT INTO renders (id, episode_id, file_path, duration_seconds, frame_count, created_at_ms)
       VALUES (?, ?, ?, 15, 450, 1)`,
    ).run(`render-${id}`, id, `out/${id}.mp4`);
  }
  if (seed.publishStatus !== undefined) {
    db.prepare(
      `INSERT INTO publishes (id, episode_id, platform, status, attempts, created_at_ms)
       VALUES (?, ?, 'tiktok', ?, 1, ?)`,
    ).run(`pub-${id}`, id, seed.publishStatus, seed.publishCreatedAtMs ?? NOW_MS);
  }
  return id;
}

function readJobs(db: DatabaseSync): Record<string, unknown>[] {
  return db.prepare('SELECT id, kind, episode_id, status, message FROM jobs ORDER BY created_at_ms, id').all();
}

async function tick(
  db: DatabaseSync,
  options: {
    checkPublishes?: () => Promise<CheckTikTokPublishesSummary>;
    sendEpisode?: (episodeId: string) => Promise<SendEpisodeToTikTokResult>;
    hasStoredToken?: () => Promise<boolean>;
    nowMs?: number;
    ids?: {next: number};
  } = {},
): Promise<RunTickResult> {
  const ids = options.ids ?? {next: 0};
  return runTick({
    db,
    nowMs: options.nowMs ?? NOW_MS,
    newId: () => `job-${++ids.next}`,
    hasStoredToken: options.hasStoredToken ?? (async () => true),
    checkPublishes: options.checkPublishes ?? (async () => idleSummary),
    sendEpisode: options.sendEpisode ?? (async () => ({kind: 'sent-to-tiktok', publishId: 'pub-new'})),
  });
}

function countPublishes(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM publishes').get();
  if (row === undefined) throw new Error('count-publishes: no row');
  if (typeof row.count === 'number') return row.count;
  if (typeof row.count === 'bigint') return Number(row.count);
  throw new Error('count-publishes: count is not a number');
}

function inboxSend(db: DatabaseSync, fetchFn: typeof fetch): (episodeId: string) => Promise<SendEpisodeToTikTokResult> {
  let nextRow = 0;
  const videoBytes = new Uint8Array([1, 2, 3]);
  return (episodeId) =>
    sendEpisodeToTikTok({
      db,
      episodeId,
      videoBytes,
      accessToken: 'token',
      fetchFn,
      nowMs: NOW_MS,
      newId: () => `publish-${episodeId}-${++nextRow}`,
    });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

describe('runTick', () => {
  it('sends the oldest due approved night and leaves the later one', async () => {
    const db = openDb();
    seedEpisode(db, {id: 'ep-late', night: 2, publishAtMs: DUE_MS + 60_000});
    seedEpisode(db, {id: 'ep-early', night: 1, publishAtMs: DUE_MS});
    const sendEpisode = vi.fn(async () => ({kind: 'sent-to-tiktok' as const, publishId: 'pub-new'}));

    const result = await tick(db, {sendEpisode});

    expect(result).toEqual({kind: 'sent', jobId: 'job-1', episodeId: 'ep-early', publishId: 'pub-new'});
    expect(sendEpisode).toHaveBeenCalledTimes(1);
    expect(sendEpisode).toHaveBeenCalledWith('ep-early');
    expect(readJobs(db)).toEqual([
      {id: 'job-1', kind: 'send', episode_id: 'ep-early', status: 'succeeded', message: null},
    ]);
  });

  it('stays idle when the only night is not due yet', async () => {
    const db = openDb();
    seedEpisode(db, {publishAtMs: NOT_DUE_MS});
    const sendEpisode = vi.fn(async () => ({kind: 'sent-to-tiktok' as const, publishId: 'pub-new'}));

    const result = await tick(db, {sendEpisode});

    expect(result).toEqual({kind: 'idle', reason: 'nothing-due'});
    expect(sendEpisode).not.toHaveBeenCalled();
    expect(readJobs(db)).toEqual([]);
  });

  it('sends a night whose publish time is exactly now', async () => {
    const db = openDb();
    seedEpisode(db, {publishAtMs: NOW_MS});
    const sendEpisode = vi.fn(async () => ({kind: 'sent-to-tiktok' as const, publishId: 'pub-new'}));

    const result = await tick(db, {sendEpisode});

    expect(result).toMatchObject({kind: 'sent', episodeId: 'ep-1'});
  });

  it('does not send when the plan is still a draft', async () => {
    const db = openDb();
    seedEpisode(db, {planStatus: 'draft', episodeStatus: 'approved'});
    const sendEpisode = vi.fn(async () => ({kind: 'sent-to-tiktok' as const, publishId: 'pub-new'}));

    const result = await tick(db, {sendEpisode});

    expect(result).toEqual({kind: 'idle', reason: 'nothing-due'});
    expect(sendEpisode).not.toHaveBeenCalled();
  });

  it('does not send a skipped night', async () => {
    const db = openDb();
    seedEpisode(db, {episodeStatus: 'skipped'});
    const sendEpisode = vi.fn(async () => ({kind: 'sent-to-tiktok' as const, publishId: 'pub-new'}));

    const result = await tick(db, {sendEpisode});

    expect(result).toEqual({kind: 'idle', reason: 'nothing-due'});
    expect(sendEpisode).not.toHaveBeenCalled();
  });

  it('does not send a night with no render', async () => {
    const db = openDb();
    seedEpisode(db, {hasRender: false});
    const sendEpisode = vi.fn(async () => ({kind: 'sent-to-tiktok' as const, publishId: 'pub-new'}));

    const result = await tick(db, {sendEpisode});

    expect(result).toEqual({kind: 'idle', reason: 'nothing-due'});
    expect(sendEpisode).not.toHaveBeenCalled();
  });

  it('does not send a night that already has a publish row', async () => {
    const db = openDb();
    seedEpisode(db, {publishStatus: 'failed', publishCreatedAtMs: Date.parse('2026-10-25T12:00:00+01:00')});
    const sendEpisode = vi.fn(async () => ({kind: 'sent-to-tiktok' as const, publishId: 'pub-new'}));

    const result = await tick(db, {sendEpisode});

    expect(result).toEqual({kind: 'idle', reason: 'nothing-due'});
    expect(sendEpisode).not.toHaveBeenCalled();
  });

  it('sends at most one night per Europe/Ljubljana day', async () => {
    const db = openDb();
    seedEpisode(db, {
      id: 'ep-sent',
      night: 1,
      publishStatus: 'processing',
      publishCreatedAtMs: Date.parse('2026-10-26T00:05:00+01:00'),
    });
    seedEpisode(db, {id: 'ep-next', night: 2, publishAtMs: DUE_MS});
    const sendEpisode = vi.fn(async () => ({kind: 'sent-to-tiktok' as const, publishId: 'pub-new'}));

    const blocked = await tick(db, {sendEpisode});

    expect(blocked).toEqual({kind: 'idle', reason: 'already-sent-today'});
    expect(sendEpisode).not.toHaveBeenCalled();
  });

  it('sends again on the next Ljubljana day', async () => {
    const db = openDb();
    seedEpisode(db, {
      id: 'ep-yesterday',
      night: 1,
      publishStatus: 'sent',
      publishCreatedAtMs: Date.parse('2026-10-25T23:30:00+01:00'),
    });
    seedEpisode(db, {id: 'ep-today', night: 2});
    const sendEpisode = vi.fn(async () => ({kind: 'sent-to-tiktok' as const, publishId: 'pub-new'}));

    const result = await tick(db, {sendEpisode});

    expect(result).toMatchObject({kind: 'sent', episodeId: 'ep-today'});
  });

  it('surfaces the share cap and does not send another night', async () => {
    const db = openDb();
    seedEpisode(db, {id: 'ep-1', night: 1, publishAtMs: DUE_MS});
    seedEpisode(db, {id: 'ep-2', night: 2, publishAtMs: DUE_MS + 60_000});
    const sendEpisode = vi.fn(async () => ({kind: 'share-cap-reached' as const, inFlightShares: 5}));

    const result = await tick(db, {sendEpisode});

    expect(result).toEqual({
      kind: 'share-cap-reached',
      jobId: 'job-1',
      episodeId: 'ep-1',
      inFlightShares: 5,
    });
    expect(sendEpisode).toHaveBeenCalledTimes(1);
    expect(readJobs(db)).toEqual([
      {
        id: 'job-1',
        kind: 'send',
        episode_id: 'ep-1',
        status: 'failed',
        message: 'TikTok already has 5 shares in flight.',
      },
    ]);
  });

  it('checks processing publishes before it sends', async () => {
    const db = openDb();
    seedEpisode(db);
    const order: string[] = [];
    const checkPublishes = vi.fn(async () => {
      order.push('check');
      expect(readJobs(db)).toEqual([]);
      return idleSummary;
    });
    const sendEpisode = vi.fn(async () => {
      order.push('send');
      expect(readJobs(db)[0]).toMatchObject({status: 'running', kind: 'send'});
      return {kind: 'sent-to-tiktok' as const, publishId: 'pub-new'};
    });

    await tick(db, {checkPublishes, sendEpisode});

    expect(order).toEqual(['check', 'send']);
  });

  it('marks the job failed and sends nothing else when the upload fails', async () => {
    const db = openDb();
    seedEpisode(db, {id: 'ep-1', night: 1});
    seedEpisode(db, {id: 'ep-2', night: 2, publishAtMs: DUE_MS + 60_000});
    const sendEpisode = vi.fn(async () => ({
      kind: 'upload-failed' as const,
      publishId: null,
      error: {operation: 'init-inbox-upload', code: 'access_token_invalid', detail: 'bad'},
    }));

    const result = await tick(db, {sendEpisode});

    expect(result).toEqual({
      kind: 'failed',
      jobId: 'job-1',
      episodeId: 'ep-1',
      message: 'TikTok upload failed (init-inbox-upload access_token_invalid).',
    });
    expect(sendEpisode).toHaveBeenCalledTimes(1);
    expect(readJobs(db)[0]).toMatchObject({status: 'failed', episode_id: 'ep-1'});
  });

  it('lets the next tick send after a startup clears a send left running', async () => {
    const db = openDb();
    seedEpisode(db);
    db.prepare(
      `INSERT INTO jobs (id, kind, episode_id, status, created_at_ms, updated_at_ms)
       VALUES ('job-dead', 'send', 'ep-1', 'running', 1, 1)`,
    ).run();

    expect(failInterruptedSends(db, NOW_MS)).toBe(1);
    const result = await tick(db);

    expect(result).toMatchObject({kind: 'sent', episodeId: 'ep-1'});
    expect(readJobs(db).find((job) => job.id === 'job-dead')).toMatchObject({
      status: 'failed',
      message: 'The daemon stopped during this send.',
    });
  });

  it('stays busy and sends nothing when a send job is already running', async () => {
    const db = openDb();
    seedEpisode(db);
    db.prepare(
      `INSERT INTO jobs (id, kind, episode_id, status, created_at_ms, updated_at_ms)
       VALUES ('job-running', 'send', 'ep-1', 'running', 1, 1)`,
    ).run();
    const hasStoredToken = vi.fn(async () => true);
    const checkPublishes = vi.fn(async () => idleSummary);
    const sendEpisode = vi.fn(async () => ({kind: 'sent-to-tiktok' as const, publishId: 'pub-new'}));

    const result = await tick(db, {hasStoredToken, checkPublishes, sendEpisode});

    expect(result).toEqual({kind: 'busy'});
    expect(hasStoredToken).not.toHaveBeenCalled();
    expect(checkPublishes).not.toHaveBeenCalled();
    expect(sendEpisode).not.toHaveBeenCalled();
  });

  it('sends while a render is running, because a send is not the render mutex', async () => {
    const db = openDb();
    seedEpisode(db);
    db.prepare(
      `INSERT INTO jobs (id, kind, episode_id, status, created_at_ms, updated_at_ms)
       VALUES ('job-render', 'render', 'ep-1', 'running', 1, 1)`,
    ).run();

    const result = await tick(db);

    expect(result).toMatchObject({kind: 'sent', episodeId: 'ep-1'});
  });

  it('stays idle and creates no job when no TikTok token is stored', async () => {
    const db = openDb();
    seedEpisode(db);
    const hasStoredToken = vi.fn(async () => false);
    const checkPublishes = vi.fn(async () => idleSummary);
    const sendEpisode = vi.fn(async () => ({kind: 'sent-to-tiktok' as const, publishId: 'pub-new'}));

    const result = await tick(db, {hasStoredToken, checkPublishes, sendEpisode});

    expect(result).toEqual({kind: 'idle', reason: 'tiktok-not-connected'});
    expect(hasStoredToken).toHaveBeenCalledTimes(1);
    expect(checkPublishes).not.toHaveBeenCalled();
    expect(sendEpisode).not.toHaveBeenCalled();
    expect(readJobs(db)).toEqual([]);
  });

  it('sends the night on the next tick when init fails with a network error', async () => {
    const db = openDb();
    seedEpisode(db);
    let calls = 0;
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      if (init?.method === 'PUT') return new Response(null, {status: 201});
      return jsonResponse({
        data: {publish_id: 'pub-1', upload_url: 'https://upload.example/secret-path'},
        error: {code: 'ok', message: '', log_id: 'log-1'},
      });
    });
    const sendEpisode = inboxSend(db, fetchFn);
    const ids = {next: 0};

    const failed = await tick(db, {sendEpisode, ids});

    expect(failed).toMatchObject({kind: 'failed', episodeId: 'ep-1'});
    expect(countPublishes(db)).toBe(0);
    expect(readJobs(db)).toEqual([
      expect.objectContaining({id: 'job-1', status: 'failed', episode_id: 'ep-1'}),
    ]);

    const retried = await tick(db, {sendEpisode, ids});

    expect(retried).toMatchObject({kind: 'sent', episodeId: 'ep-1'});
    expect(countPublishes(db)).toBe(1);
  });

  it('keeps the publish row and does not resend when the upload fails after init', async () => {
    const db = openDb();
    seedEpisode(db);
    let calls = 0;
    const fetchFn = vi.fn<typeof fetch>(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          data: {publish_id: 'pub-1', upload_url: 'https://upload.example/secret-path'},
          error: {code: 'ok', message: '', log_id: 'log-1'},
        });
      }
      if (calls === 2) return new Response(null, {status: 500});
      throw new Error('tiktok was called again');
    });
    const sendEpisode = inboxSend(db, fetchFn);
    const ids = {next: 0};

    const failed = await tick(db, {sendEpisode, ids});

    expect(failed).toMatchObject({kind: 'failed', episodeId: 'ep-1'});
    const publish = db.prepare("SELECT status, external_id FROM publishes WHERE episode_id = 'ep-1'").get();
    expect(publish).toMatchObject({status: 'failed', external_id: 'pub-1'});

    const second = await tick(db, {sendEpisode, ids});

    expect(second).toEqual({kind: 'idle', reason: 'nothing-due'});
    expect(calls).toBe(2);
  });
});
