import type {DatabaseSync} from 'node:sqlite';
import {ljubljanaDayStartMs, nextLjubljanaDayStartMs} from '../time/ljubljanaTime';
import {runInTransaction} from '../store/withTransaction';

export type BeginSendResult =
  | {kind: 'busy'}
  | {kind: 'idle'; reason: 'nothing-due' | 'already-sent-today'}
  | {kind: 'ready'; jobId: string; episodeId: string};

function readCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error('count-publishes-today: count is not a number');
}

function hasRunningSendJob(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 AS found FROM jobs WHERE kind = 'send' AND status = 'running' LIMIT 1").get() !== undefined;
}

/** The oldest approved, due, rendered episode whose plan is approved and which has no publish row. */
function findDueEpisodeId(db: DatabaseSync, nowMs: number): string | undefined {
  const row = db
    .prepare(
      `SELECT e.id AS id
       FROM episodes e
       JOIN plans p ON p.week_start = e.week_start
       WHERE e.status = 'approved'
         AND p.status = 'approved'
         AND e.publish_at_ms <= ?
         AND EXISTS (SELECT 1 FROM renders r WHERE r.episode_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM publishes pub WHERE pub.episode_id = e.id)
       ORDER BY e.publish_at_ms, e.night, e.id
       LIMIT 1`,
    )
    .get(nowMs);
  if (row === undefined) return undefined;
  if (typeof row.id !== 'string') throw new Error('find-due-episode: id is not text');
  return row.id;
}

function countPublishesCreatedToday(db: DatabaseSync, nowMs: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM publishes WHERE created_at_ms >= ? AND created_at_ms < ?')
    .get(ljubljanaDayStartMs(nowMs), nextLjubljanaDayStartMs(nowMs));
  if (row === undefined) throw new Error('count-publishes-today: no row');
  return readCount(row.count);
}

function insertRunningSendJob(db: DatabaseSync, options: {jobId: string; episodeId: string; nowMs: number}): void {
  const {jobId, episodeId, nowMs} = options;
  db.prepare(
    `INSERT INTO jobs (id, kind, episode_id, status, message, created_at_ms, updated_at_ms)
     VALUES (?, 'send', ?, 'queued', NULL, ?, ?)`,
  ).run(jobId, episodeId, nowMs, nowMs);
  db.prepare("UPDATE jobs SET status = 'running', updated_at_ms = ? WHERE id = ?").run(nowMs, jobId);
}

function decideSend(db: DatabaseSync, options: {nowMs: number; newId: () => string}): BeginSendResult {
  if (hasRunningSendJob(db)) return {kind: 'busy'};
  const episodeId = findDueEpisodeId(db, options.nowMs);
  if (episodeId === undefined) return {kind: 'idle', reason: 'nothing-due'};
  if (countPublishesCreatedToday(db, options.nowMs) > 0) return {kind: 'idle', reason: 'already-sent-today'};
  const jobId = options.newId();
  insertRunningSendJob(db, {jobId, episodeId, nowMs: options.nowMs});
  return {kind: 'ready', jobId, episodeId};
}

/**
 * Takes the one running send slot, or reports why this tick sends nothing.
 * The render and asset mutex stays the partial unique index on jobs. A send may run beside a render,
 * so the tick's slot is one running send row claimed in this write transaction. Two ticks cannot both
 * pass it. There is no second lock.
 */
export function beginSendJob(db: DatabaseSync, options: {nowMs: number; newId: () => string}): BeginSendResult {
  return runInTransaction(db, 'begin-send-job', () => decideSend(db, options));
}

/**
 * Fails send jobs left running by a daemon that stopped mid-tick.
 * Call this once at startup, before listening. A publish row, if the init already happened, still blocks a second send.
 */
export function failInterruptedSends(db: DatabaseSync, nowMs: number): number {
  const result = db
    .prepare(
      `UPDATE jobs SET status = 'failed', message = ?, updated_at_ms = ?
       WHERE kind = 'send' AND status = 'running'`,
    )
    .run('The daemon stopped during this send.', nowMs);
  return Number(result.changes);
}

/** Moves the send job to succeeded or failed. Throws when the row is missing, so a tick cannot finish silently. */
export function finishSendJob(
  db: DatabaseSync,
  options: {jobId: string; status: 'succeeded' | 'failed'; message: string | null; nowMs: number},
): void {
  const {jobId, status, message, nowMs} = options;
  const result = db
    .prepare("UPDATE jobs SET status = ?, message = ?, updated_at_ms = ? WHERE id = ? AND kind = 'send'")
    .run(status, message, nowMs, jobId);
  if (result.changes !== 1) throw new Error(`finish-send-job: no send job ${jobId}`);
}
