import type {DatabaseSync} from 'node:sqlite';
import {formatLjubljanaIso} from '../time/ljubljanaTime';

/** The Publish of docs/openapi.yaml. */
export type Publish = {
  id: string;
  episodeId: string;
  platform: 'tiktok' | 'youtube';
  externalId?: string;
  status: 'processing' | 'sent' | 'stalled' | 'failed';
  attempts: number;
  lastCheckedAt?: string;
};

const PLATFORMS = ['tiktok', 'youtube'] as const;
const STATUSES = ['processing', 'sent', 'stalled', 'failed'] as const;

function readChoice<Choice extends string>(value: unknown, choices: readonly Choice[], column: string): Choice {
  const choice = choices.find((candidate) => candidate === value);
  if (choice === undefined) throw new Error(`list-publishes: column ${column} holds an unknown value`);
  return choice;
}

function toPublish(row: Record<string, unknown>): Publish {
  const {id, episode_id: episodeId, attempts, external_id: externalId, last_checked_at_ms: lastCheckedAtMs} = row;
  if (typeof id !== 'string' || typeof episodeId !== 'string' || typeof attempts !== 'number') {
    throw new Error('list-publishes: unexpected row shape');
  }
  const publish: Publish = {
    id,
    episodeId,
    platform: readChoice(row.platform, PLATFORMS, 'platform'),
    status: readChoice(row.status, STATUSES, 'status'),
    attempts,
  };
  if (typeof externalId === 'string') publish.externalId = externalId;
  if (typeof lastCheckedAtMs === 'number') publish.lastCheckedAt = formatLjubljanaIso(lastCheckedAtMs);
  return publish;
}

/** Lists the publish rows of one week's episodes, oldest first. */
export function listPublishesForWeek(db: DatabaseSync, weekStart: string): Publish[] {
  const rows = db
    .prepare(
      `SELECT p.* FROM publishes p JOIN episodes e ON e.id = p.episode_id
       WHERE e.week_start = ? ORDER BY p.created_at_ms, p.id`,
    )
    .all(weekStart);
  return rows.map(toPublish);
}
