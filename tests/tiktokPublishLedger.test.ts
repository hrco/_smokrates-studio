import type {DatabaseSync} from 'node:sqlite';
import {describe, expect, it} from 'vitest';
import {openStudioDb} from '../src/store/studioDb';
import {
  SHARE_WINDOW_MS,
  claimTikTokPublish,
  countInFlightShares,
  listProcessingTikTokPublishes,
  markTikTokPublish,
  recordTikTokPublishId,
} from '../src/publish/tiktokPublishLedger';

const NOW_MS = 1_000_000_000_000;

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

function sequentialIds(): () => string {
  let counter = 0;
  return () => `row-${++counter}`;
}

function readRow(db: DatabaseSync, publishRowId: string): Record<string, unknown> {
  const row = db.prepare('SELECT * FROM publishes WHERE id = ?').get(publishRowId);
  if (row === undefined) throw new Error(`missing row ${publishRowId}`);
  return row;
}

describe('claimTikTokPublish', () => {
  it('claims a processing row with attempts 1 and no external id', () => {
    const db = openSeededDb(1);

    const claim = claimTikTokPublish(db, {episodeId: 'ep-1', nowMs: NOW_MS, newId: sequentialIds()});

    expect(claim).toEqual({kind: 'claimed', publishRowId: 'row-1'});
    expect(readRow(db, 'row-1')).toMatchObject({status: 'processing', attempts: 1, external_id: null, created_at_ms: NOW_MS});
  });

  it.each(['processing', 'failed', 'stalled', 'sent'] as const)('refuses a second claim after status %s', (status) => {
    const db = openSeededDb(1);
    const newId = sequentialIds();
    claimTikTokPublish(db, {episodeId: 'ep-1', nowMs: NOW_MS, newId});
    if (status !== 'processing') markTikTokPublish(db, {publishRowId: 'row-1', status, nowMs: NOW_MS});

    const second = claimTikTokPublish(db, {episodeId: 'ep-1', nowMs: NOW_MS, newId});

    expect(second).toEqual({kind: 'already-claimed', status});
  });

  it('refuses the 6th share while 5 are in flight', () => {
    const db = openSeededDb(6);
    const newId = sequentialIds();
    for (let night = 1; night <= 5; night += 1) {
      expect(claimTikTokPublish(db, {episodeId: `ep-${night}`, nowMs: NOW_MS, newId}).kind).toBe('claimed');
    }

    expect(claimTikTokPublish(db, {episodeId: 'ep-6', nowMs: NOW_MS, newId})).toEqual({
      kind: 'share-cap-reached',
      inFlightShares: 5,
    });
  });

  it('lets a new share start once the five in-flight rows leave the 24 hour window', () => {
    const db = openSeededDb(6);
    const newId = sequentialIds();
    for (let night = 1; night <= 5; night += 1) {
      expect(claimTikTokPublish(db, {episodeId: `ep-${night}`, nowMs: NOW_MS, newId}).kind).toBe('claimed');
    }

    expect(
      claimTikTokPublish(db, {episodeId: 'ep-6', nowMs: NOW_MS + SHARE_WINDOW_MS - 1, newId}),
    ).toEqual({kind: 'share-cap-reached', inFlightShares: 5});
    expect(claimTikTokPublish(db, {episodeId: 'ep-6', nowMs: NOW_MS + SHARE_WINDOW_MS, newId})).toEqual({
      kind: 'claimed',
      publishRowId: 'row-6',
    });
  });

  it('rolls back and rethrows with context when the insert fails', () => {
    const db = openSeededDb(1);

    expect(() => claimTikTokPublish(db, {episodeId: 'no-such-episode', nowMs: NOW_MS, newId: sequentialIds()})).toThrow(
      /claim-tiktok-publish failed for episode no-such-episode/,
    );
    expect(() => db.exec('BEGIN IMMEDIATE')).not.toThrow();
    db.exec('ROLLBACK');
  });
});

describe('countInFlightShares', () => {
  it('counts processing and stalled, never sent or failed before init', () => {
    const db = openSeededDb(4);
    const newId = sequentialIds();
    for (let night = 1; night <= 4; night += 1) claimTikTokPublish(db, {episodeId: `ep-${night}`, nowMs: NOW_MS, newId});
    markTikTokPublish(db, {publishRowId: 'row-2', status: 'stalled', nowMs: NOW_MS});
    markTikTokPublish(db, {publishRowId: 'row-3', status: 'sent', nowMs: NOW_MS});
    markTikTokPublish(db, {publishRowId: 'row-4', status: 'failed', nowMs: NOW_MS});

    expect(countInFlightShares(db, NOW_MS)).toBe(2);
  });

  it('counts a share that failed after init, because TikTok still holds its pending slot', () => {
    const db = openSeededDb(2);
    const newId = sequentialIds();
    claimTikTokPublish(db, {episodeId: 'ep-1', nowMs: NOW_MS, newId});
    claimTikTokPublish(db, {episodeId: 'ep-2', nowMs: NOW_MS, newId});
    recordTikTokPublishId(db, {publishRowId: 'row-1', publishId: 'pub-1', nowMs: NOW_MS});
    markTikTokPublish(db, {publishRowId: 'row-1', status: 'failed', nowMs: NOW_MS});
    markTikTokPublish(db, {publishRowId: 'row-2', status: 'failed', nowMs: NOW_MS});

    expect(countInFlightShares(db, NOW_MS)).toBe(1);
  });

  it('stops counting a stalled share older than 24 hours', () => {
    const db = openSeededDb(1);
    claimTikTokPublish(db, {episodeId: 'ep-1', nowMs: NOW_MS, newId: sequentialIds()});
    markTikTokPublish(db, {publishRowId: 'row-1', status: 'stalled', nowMs: NOW_MS});

    expect(countInFlightShares(db, NOW_MS + SHARE_WINDOW_MS - 1)).toBe(1);
    expect(countInFlightShares(db, NOW_MS + SHARE_WINDOW_MS)).toBe(0);
  });
});

describe('recordTikTokPublishId', () => {
  it('stores the publish id and accepts the same id twice', () => {
    const db = openSeededDb(1);
    claimTikTokPublish(db, {episodeId: 'ep-1', nowMs: NOW_MS, newId: sequentialIds()});

    recordTikTokPublishId(db, {publishRowId: 'row-1', publishId: 'pub-1', nowMs: NOW_MS});
    recordTikTokPublishId(db, {publishRowId: 'row-1', publishId: 'pub-1', nowMs: NOW_MS});

    expect(readRow(db, 'row-1').external_id).toBe('pub-1');
  });

  it('throws for a different publish id or a missing row', () => {
    const db = openSeededDb(1);
    claimTikTokPublish(db, {episodeId: 'ep-1', nowMs: NOW_MS, newId: sequentialIds()});
    recordTikTokPublishId(db, {publishRowId: 'row-1', publishId: 'pub-1', nowMs: NOW_MS});

    expect(() => recordTikTokPublishId(db, {publishRowId: 'row-1', publishId: 'pub-2', nowMs: NOW_MS})).toThrow(
      /different publish_id/,
    );
    expect(() => recordTikTokPublishId(db, {publishRowId: 'nope', publishId: 'pub-1', nowMs: NOW_MS})).toThrow(/no publish row/);
  });
});

describe('markTikTokPublish and listProcessingTikTokPublishes', () => {
  it('sets status and last checked time, and drops the row from the processing list', () => {
    const db = openSeededDb(2);
    const newId = sequentialIds();
    claimTikTokPublish(db, {episodeId: 'ep-1', nowMs: NOW_MS, newId});
    claimTikTokPublish(db, {episodeId: 'ep-2', nowMs: NOW_MS + 1, newId});
    recordTikTokPublishId(db, {publishRowId: 'row-2', publishId: 'pub-2', nowMs: NOW_MS});

    markTikTokPublish(db, {publishRowId: 'row-1', status: 'sent', nowMs: NOW_MS + 5});

    expect(readRow(db, 'row-1')).toMatchObject({status: 'sent', last_checked_at_ms: NOW_MS + 5});
    expect(listProcessingTikTokPublishes(db)).toEqual([
      {publishRowId: 'row-2', episodeId: 'ep-2', publishId: 'pub-2', createdAtMs: NOW_MS + 1},
    ]);
  });
});
