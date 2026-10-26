import type {DatabaseSync} from 'node:sqlite';
import {describe, expect, it, vi} from 'vitest';
import {sendEpisodeToTikTok} from '../src/publish/sendEpisodeToTikTok';
import {openStudioDb} from '../src/store/studioDb';

const NOW_MS = 1_000_000_000_000;
const videoBytes = new Uint8Array([1, 2, 3]);

const okInit = {
  data: {publish_id: 'pub-1', upload_url: 'https://upload.example/secret-path'},
  error: {code: 'ok', message: '', log_id: 'log-1'},
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function openSeededDb(episodeCount: number): DatabaseSync {
  const {db} = openStudioDb({dbPath: ':memory:'});
  db.prepare("INSERT INTO plans (week_start, status, created_at_ms) VALUES ('2026-10-19', 'draft', 1)").run();
  for (let night = 1; night <= episodeCount; night += 1) {
    db.prepare(
      `INSERT INTO episodes (id, week_start, night, format, track_slug, start_second, duration_seconds,
         claim, caption, publish_at_ms, label_decision, status)
       VALUES (?, '2026-10-19', ?, 'track_card', 'slug', 0, 15, 'claim', 'caption', 1, 'label_on', 'approved')`,
    ).run(`ep-${night}`, night);
  }
  return db;
}

function readPublish(db: DatabaseSync, episodeId: string): Record<string, unknown> {
  const row = db.prepare("SELECT * FROM publishes WHERE platform = 'tiktok' AND episode_id = ?").get(episodeId);
  if (row === undefined) throw new Error(`no publish row for ${episodeId}`);
  return row;
}

function sendOptions(db: DatabaseSync, fetchFn: typeof fetch, episodeId = 'ep-1') {
  let counter = 0;
  return {db, episodeId, videoBytes, accessToken: 'tok', fetchFn, nowMs: NOW_MS, newId: () => `row-${episodeId}-${++counter}`};
}

describe('sendEpisodeToTikTok', () => {
  it('stores the publish id in the db before the PUT runs and leaves the row processing', async () => {
    const db = openSeededDb(1);
    let publishIdSeenAtPut: unknown;
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method !== 'PUT') return jsonResponse(okInit);
      publishIdSeenAtPut = readPublish(db, 'ep-1').external_id;
      return new Response(null, {status: 201});
    });

    const result = await sendEpisodeToTikTok(sendOptions(db, fetchFn));

    expect(result).toEqual({kind: 'sent-to-tiktok', publishId: 'pub-1'});
    expect(publishIdSeenAtPut).toBe('pub-1');
    expect(readPublish(db, 'ep-1')).toMatchObject({status: 'processing', external_id: 'pub-1'});
  });

  it('marks the row failed with a null publish id when init fails', async () => {
    const db = openSeededDb(1);
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({error: {code: 'access_token_invalid', message: 'bad', log_id: 'l'}}, 401),
    );

    const result = await sendEpisodeToTikTok(sendOptions(db, fetchFn));

    expect(result).toMatchObject({kind: 'upload-failed', publishId: null, error: {code: 'access_token_invalid'}});
    expect(readPublish(db, 'ep-1')).toMatchObject({status: 'failed', external_id: null});
  });

  it('marks the row failed and keeps the publish id when the PUT fails', async () => {
    const db = openSeededDb(1);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(okInit))
      .mockResolvedValueOnce(new Response(null, {status: 500}));

    const result = await sendEpisodeToTikTok(sendOptions(db, fetchFn));

    expect(result).toMatchObject({kind: 'upload-failed', publishId: 'pub-1', error: {code: 'upload-rejected'}});
    expect(readPublish(db, 'ep-1')).toMatchObject({status: 'failed', external_id: 'pub-1'});
  });

  it('never inits twice for the same episode, even after a failure', async () => {
    const db = openSeededDb(1);
    const failingFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({error: {code: 'internal_error', message: '', log_id: ''}}, 500));
    await sendEpisodeToTikTok(sendOptions(db, failingFetch));
    const secondFetch = vi.fn<typeof fetch>();

    const result = await sendEpisodeToTikTok(sendOptions(db, secondFetch));

    expect(result).toEqual({kind: 'already-claimed', status: 'failed'});
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it('refuses a new share without any request when 5 are in flight', async () => {
    const db = openSeededDb(6);
    for (let night = 1; night <= 5; night += 1) {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(okInit))
        .mockResolvedValueOnce(new Response(null, {status: 201}));
      await sendEpisodeToTikTok(sendOptions(db, fetchFn, `ep-${night}`));
    }
    const sixthFetch = vi.fn<typeof fetch>();

    const result = await sendEpisodeToTikTok(sendOptions(db, sixthFetch, 'ep-6'));

    expect(result).toEqual({kind: 'share-cap-reached', inFlightShares: 5});
    expect(sixthFetch).not.toHaveBeenCalled();
  });
});
