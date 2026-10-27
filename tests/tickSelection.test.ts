import type {DatabaseSync} from 'node:sqlite';
import {describe, expect, it} from 'vitest';
import {beginSendJob} from '../src/publish/tickSelection';
import {openStudioDb} from '../src/store/studioDb';

const WEEK = '2026-10-26';
const NOW_MS = Date.parse('2026-10-26T20:00:00+01:00');
const DUE_MS = Date.parse('2026-10-26T18:00:00+01:00');
const DAY_MS = 24 * 60 * 60 * 1000;

type Seed = {id?: string; night?: number; publishAtMs?: number};

function openDb(): DatabaseSync {
  return openStudioDb({dbPath: ':memory:'}).db;
}

function seedEpisode(db: DatabaseSync, seed: Seed = {}): string {
  const id = seed.id ?? 'ep-1';
  const existingPlan = db.prepare('SELECT status FROM plans WHERE week_start = ?').get(WEEK);
  if (existingPlan === undefined) {
    db.prepare("INSERT INTO plans (week_start, status, created_at_ms) VALUES (?, 'approved', 1)").run(WEEK);
  }
  db.prepare(
    `INSERT INTO episodes (id, week_start, night, format, track_slug, start_second, duration_seconds,
       claim, caption, publish_at_ms, label_decision, status)
     VALUES (?, ?, ?, 'track_card', 'slug', 0, 15, 'claim', 'caption', ?, 'label_off', 'approved')`,
  ).run(id, WEEK, seed.night ?? 1, seed.publishAtMs ?? DUE_MS);
  db.prepare(
    `INSERT INTO renders (id, episode_id, file_path, duration_seconds, frame_count, created_at_ms)
     VALUES (?, ?, ?, 15, 450, 1)`,
  ).run(`render-${id}`, id, `out/${id}.mp4`);
  return id;
}

function insertFailedJobs(db: DatabaseSync, episodeId: string, count: number, kind: 'send' | 'render'): void {
  for (let index = 1; index <= count; index += 1) {
    db.prepare(
      `INSERT INTO jobs (id, kind, episode_id, status, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 'failed', ?, ?)`,
    ).run(`failed-${kind}-${episodeId}-${index}`, kind, episodeId, index, index);
  }
}

function begin(db: DatabaseSync, nowMs = NOW_MS) {
  return beginSendJob(db, {nowMs, newId: () => 'job-new'});
}

describe('findDueEpisodeId through beginSendJob', () => {
  it('skips a night that already has three failed sends and takes the next night', () => {
    const db = openDb();
    seedEpisode(db, {id: 'ep-stuck', night: 1, publishAtMs: DUE_MS});
    seedEpisode(db, {id: 'ep-next', night: 2, publishAtMs: DUE_MS + 60_000});
    insertFailedJobs(db, 'ep-stuck', 3, 'send');

    expect(begin(db)).toEqual({kind: 'ready', jobId: 'job-new', episodeId: 'ep-next'});
  });

  it('tries a night again after two failed sends', () => {
    const db = openDb();
    seedEpisode(db);
    insertFailedJobs(db, 'ep-1', 2, 'send');

    expect(begin(db)).toEqual({kind: 'ready', jobId: 'job-new', episodeId: 'ep-1'});
  });

  it('does not count failed render jobs toward the send limit', () => {
    const db = openDb();
    seedEpisode(db);
    insertFailedJobs(db, 'ep-1', 3, 'render');

    expect(begin(db)).toEqual({kind: 'ready', jobId: 'job-new', episodeId: 'ep-1'});
  });

  it('stays idle and creates no job when the only due night has three failed sends', () => {
    const db = openDb();
    seedEpisode(db);
    insertFailedJobs(db, 'ep-1', 3, 'send');

    expect(begin(db)).toEqual({kind: 'idle', reason: 'nothing-due'});
    expect(db.prepare('SELECT id FROM jobs').all()).toHaveLength(3);
  });

  it('skips a night whose publish time is more than 24 hours ago and sends a later one', () => {
    const db = openDb();
    seedEpisode(db, {id: 'ep-stale', night: 1, publishAtMs: NOW_MS - DAY_MS - 1});
    seedEpisode(db, {id: 'ep-fresh', night: 2, publishAtMs: DUE_MS});

    expect(begin(db)).toEqual({kind: 'ready', jobId: 'job-new', episodeId: 'ep-fresh'});
  });

  it('sends a night whose publish time is exactly 24 hours ago', () => {
    const db = openDb();
    seedEpisode(db, {publishAtMs: NOW_MS - DAY_MS});

    expect(begin(db)).toEqual({kind: 'ready', jobId: 'job-new', episodeId: 'ep-1'});
  });

  it('stays idle when the only due night is more than 24 hours late', () => {
    const db = openDb();
    seedEpisode(db, {publishAtMs: NOW_MS - DAY_MS - 1});

    expect(begin(db)).toEqual({kind: 'idle', reason: 'nothing-due'});
    expect(db.prepare('SELECT id FROM jobs').all()).toEqual([]);
  });
});
