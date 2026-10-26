import type {DatabaseSync} from 'node:sqlite';
import {describe, expect, it, vi} from 'vitest';
import {checkTikTokPublishes} from '../src/publish/checkTikTokPublishes';
import {STALLED_AFTER_MS} from '../src/publish/tiktokPublishLedger';
import {openStudioDb} from '../src/store/studioDb';
import type {PublishStatus, PublishStatusReport} from '../src/tiktok/inboxUpload';
import type {TikTokResult} from '../src/tiktok/types';

const CREATED_AT_MS = 1_000_000_000_000;
const MINUTE_MS = 60_000;

function openDbWithProcessingRow(publishId: string | null): DatabaseSync {
  const {db} = openStudioDb({dbPath: ':memory:'});
  db.prepare("INSERT INTO plans (week_start, status, created_at_ms) VALUES ('2026-10-19', 'draft', 1)").run();
  db.prepare(
    `INSERT INTO episodes (id, week_start, night, format, track_slug, start_second, duration_seconds,
       claim, caption, publish_at_ms, label_decision, status)
     VALUES ('ep-1', '2026-10-19', 1, 'track_card', 'slug', 0, 15, 'claim', 'caption', 1, 'label_on', 'approved')`,
  ).run();
  db.prepare(
    `INSERT INTO publishes (id, episode_id, platform, external_id, status, attempts, created_at_ms)
     VALUES ('row-1', 'ep-1', 'tiktok', ?, 'processing', 1, ?)`,
  ).run(publishId, CREATED_AT_MS);
  return db;
}

function readStatus(db: DatabaseSync): string {
  return String(db.prepare("SELECT status FROM publishes WHERE id = 'row-1'").get()?.status);
}

function reportOf(status: PublishStatus): TikTokResult<PublishStatusReport> {
  return {ok: true, value: {status}};
}

describe('checkTikTokPublishes', () => {
  it.each(['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE'] as const)('marks %s as sent', async (status) => {
    const db = openDbWithProcessingRow('pub-1');
    const fetchStatus = vi.fn().mockResolvedValue(reportOf(status));

    const summary = await checkTikTokPublishes({db, nowMs: CREATED_AT_MS + MINUTE_MS, fetchStatus});

    expect(summary).toEqual({sent: 1, failed: 0, stalled: 0, stillProcessing: 0, statusErrors: []});
    expect(readStatus(db)).toBe('sent');
    expect(fetchStatus).toHaveBeenCalledExactlyOnceWith('pub-1');
  });

  it('marks FAILED as failed', async () => {
    const db = openDbWithProcessingRow('pub-1');

    const summary = await checkTikTokPublishes({db, nowMs: CREATED_AT_MS + MINUTE_MS, fetchStatus: async () => reportOf('FAILED')});

    expect(summary.failed).toBe(1);
    expect(readStatus(db)).toBe('failed');
  });

  it('keeps a share processing at 29 minutes and at exactly 30 minutes', async () => {
    for (const ageMs of [29 * MINUTE_MS, STALLED_AFTER_MS]) {
      const db = openDbWithProcessingRow('pub-1');

      const summary = await checkTikTokPublishes({
        db,
        nowMs: CREATED_AT_MS + ageMs,
        fetchStatus: async () => reportOf('PROCESSING_UPLOAD'),
      });

      expect(summary.stillProcessing).toBe(1);
      expect(readStatus(db)).toBe('processing');
    }
  });

  it('stalls a share still processing at 31 minutes', async () => {
    const db = openDbWithProcessingRow('pub-1');

    const summary = await checkTikTokPublishes({
      db,
      nowMs: CREATED_AT_MS + 31 * MINUTE_MS,
      fetchStatus: async () => reportOf('PROCESSING_DOWNLOAD'),
    });

    expect(summary.stalled).toBe(1);
    expect(readStatus(db)).toBe('stalled');
  });

  it('stalls a row without publish id at 31 minutes and fetches nothing', async () => {
    const db = openDbWithProcessingRow(null);
    const fetchStatus = vi.fn();

    const summary = await checkTikTokPublishes({db, nowMs: CREATED_AT_MS + 31 * MINUTE_MS, fetchStatus});

    expect(summary.stalled).toBe(1);
    expect(readStatus(db)).toBe('stalled');
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('leaves a young row without publish id processing and fetches nothing', async () => {
    const db = openDbWithProcessingRow(null);
    const fetchStatus = vi.fn();

    const summary = await checkTikTokPublishes({db, nowMs: CREATED_AT_MS + 5 * MINUTE_MS, fetchStatus});

    expect(summary.stillProcessing).toBe(1);
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('stalls on a fetch error at 31 minutes and collects the error', async () => {
    const db = openDbWithProcessingRow('pub-1');
    const error = {operation: 'fetch-publish-status', code: 'rate_limit_exceeded', detail: 'slow down'};

    const summary = await checkTikTokPublishes({
      db,
      nowMs: CREATED_AT_MS + 31 * MINUTE_MS,
      fetchStatus: async () => ({ok: false, error}),
    });

    expect(summary).toEqual({sent: 0, failed: 0, stalled: 1, stillProcessing: 0, statusErrors: [error]});
    expect(readStatus(db)).toBe('stalled');
  });

  it('keeps a young row processing on a fetch error', async () => {
    const db = openDbWithProcessingRow('pub-1');
    const error = {operation: 'fetch-publish-status', code: 'rate_limit_exceeded', detail: 'slow down'};

    const summary = await checkTikTokPublishes({
      db,
      nowMs: CREATED_AT_MS + MINUTE_MS,
      fetchStatus: async () => ({ok: false, error}),
    });

    expect(summary.stillProcessing).toBe(1);
    expect(summary.statusErrors).toEqual([error]);
    expect(readStatus(db)).toBe('processing');
  });
});
