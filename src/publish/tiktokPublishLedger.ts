import type {DatabaseSync} from 'node:sqlite';

export const STALLED_AFTER_MS = 30 * 60_000;
export const MAX_IN_FLIGHT_SHARES = 5;
export const SHARE_WINDOW_MS = 24 * 60 * 60_000;

export type TikTokPublishStatus = 'processing' | 'sent' | 'stalled' | 'failed';

export type ClaimResult =
  | {kind: 'claimed'; publishRowId: string}
  | {kind: 'already-claimed'; status: TikTokPublishStatus}
  | {kind: 'share-cap-reached'; inFlightShares: number};

export type SettledTikTokStatus = 'sent' | 'failed' | 'stalled';

export type ProcessingTikTokPublish = {
  publishRowId: string;
  episodeId: string;
  publishId: string | null;
  createdAtMs: number;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readCount(row: Record<string, unknown> | undefined): number {
  return Number(row?.count ?? 0);
}

/**
 * Counts TikTok shares that still hold a pending slot, created within 24 hours: processing, stalled,
 * or failed after init. TikTok keeps the slot of a share it initialised until the window passes, even
 * when our upload or its processing failed. A share that failed before init never took a slot.
 */
export function countInFlightShares(db: DatabaseSync, nowMs: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM publishes
       WHERE platform = 'tiktok' AND created_at_ms > ?
         AND (status IN ('processing', 'stalled') OR (status = 'failed' AND external_id IS NOT NULL))`,
    )
    .get(nowMs - SHARE_WINDOW_MS);
  return readCount(row);
}

function isTikTokPublishStatus(value: unknown): value is TikTokPublishStatus {
  return value === 'processing' || value === 'sent' || value === 'stalled' || value === 'failed';
}

function readExistingStatus(db: DatabaseSync, episodeId: string): TikTokPublishStatus | undefined {
  const row = db
    .prepare("SELECT status FROM publishes WHERE platform = 'tiktok' AND episode_id = ?")
    .get(episodeId);
  if (row === undefined) return undefined;
  if (!isTikTokPublishStatus(row.status)) {
    throw new Error(`claim-tiktok-publish: unknown publish status on episode ${episodeId}`);
  }
  return row.status;
}

/**
 * Claims the one TikTok publish row of an episode before the init call.
 * A row in any status blocks a second claim: a share is never retried.
 * Refuses a new claim when 5 shares are already in flight.
 */
export function claimTikTokPublish(
  db: DatabaseSync,
  options: {episodeId: string; nowMs: number; newId: () => string},
): ClaimResult {
  const {episodeId, nowMs, newId} = options;
  db.exec('BEGIN IMMEDIATE');
  try {
    const existingStatus = readExistingStatus(db, episodeId);
    if (existingStatus !== undefined) {
      db.exec('COMMIT');
      return {kind: 'already-claimed', status: existingStatus};
    }
    const inFlightShares = countInFlightShares(db, nowMs);
    if (inFlightShares >= MAX_IN_FLIGHT_SHARES) {
      db.exec('COMMIT');
      return {kind: 'share-cap-reached', inFlightShares};
    }
    const publishRowId = newId();
    db.prepare(
      `INSERT INTO publishes (id, episode_id, platform, external_id, status, attempts, created_at_ms)
       VALUES (?, ?, 'tiktok', NULL, 'processing', 1, ?)`,
    ).run(publishRowId, episodeId, nowMs);
    db.exec('COMMIT');
    return {kind: 'claimed', publishRowId};
  } catch (error) {
    db.exec('ROLLBACK');
    throw new Error(`claim-tiktok-publish failed for episode ${episodeId}: ${describeError(error)}`, {cause: error});
  }
}

/** Stores the publish_id the moment init returns. Throws when the row is missing or holds another publish_id. */
export function recordTikTokPublishId(
  db: DatabaseSync,
  options: {publishRowId: string; publishId: string; nowMs: number},
): void {
  const {publishRowId, publishId, nowMs} = options;
  const row = db.prepare('SELECT external_id FROM publishes WHERE id = ?').get(publishRowId);
  if (row === undefined) throw new Error(`record-tiktok-publish-id: no publish row ${publishRowId}`);
  if (row.external_id !== null && row.external_id !== publishId) {
    throw new Error(`record-tiktok-publish-id: publish row ${publishRowId} already holds a different publish_id`);
  }
  db.prepare('UPDATE publishes SET external_id = ?, last_checked_at_ms = ? WHERE id = ?').run(
    publishId,
    nowMs,
    publishRowId,
  );
}

/** Settles a publish row as sent, failed or stalled and stamps the check time. */
export function markTikTokPublish(
  db: DatabaseSync,
  options: {publishRowId: string; status: SettledTikTokStatus; nowMs: number},
): void {
  const {publishRowId, status, nowMs} = options;
  const result = db
    .prepare('UPDATE publishes SET status = ?, last_checked_at_ms = ? WHERE id = ?')
    .run(status, nowMs, publishRowId);
  if (result.changes !== 1) throw new Error(`mark-tiktok-publish: no publish row ${publishRowId}`);
}

function toProcessingPublish(row: Record<string, unknown>): ProcessingTikTokPublish {
  const {id, episode_id: episodeId, external_id: externalId, created_at_ms: createdAtMs} = row;
  if (typeof id !== 'string' || typeof episodeId !== 'string' || typeof createdAtMs !== 'number') {
    throw new Error('list-processing-tiktok-publishes: unexpected row shape');
  }
  if (externalId !== null && typeof externalId !== 'string') {
    throw new Error(`list-processing-tiktok-publishes: bad external_id on row ${id}`);
  }
  return {publishRowId: id, episodeId, publishId: externalId, createdAtMs};
}

/** Lists TikTok publish rows still in processing, oldest first. */
export function listProcessingTikTokPublishes(db: DatabaseSync): ProcessingTikTokPublish[] {
  const rows = db
    .prepare(
      `SELECT id, episode_id, external_id, created_at_ms FROM publishes
       WHERE platform = 'tiktok' AND status = 'processing' ORDER BY created_at_ms, id`,
    )
    .all();
  return rows.map(toProcessingPublish);
}
