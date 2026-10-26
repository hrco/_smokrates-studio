import type {DatabaseSync} from 'node:sqlite';
import {formatLjubljanaIso} from '../time/ljubljanaTime';
import {
  EPISODE_FORMATS,
  EPISODE_STATUSES,
  LABEL_DECISIONS,
  PLAN_STATUSES,
  type Episode,
  type Plan,
} from './planTypes';

type Row = Record<string, unknown>;

const EPISODE_SELECT = `
  SELECT e.*, (
    SELECT r.file_path FROM renders r WHERE r.episode_id = e.id
    ORDER BY r.created_at_ms DESC, r.rowid DESC LIMIT 1
  ) AS render_path
  FROM episodes e`;

function readString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`read-episode: column ${key} is not text`);
  return value;
}

function readNumber(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== 'number') throw new Error(`read-episode: column ${key} is not a number`);
  return value;
}

function readChoice<Choice extends string>(row: Row, key: string, choices: readonly Choice[]): Choice {
  const value = readString(row, key);
  const choice = choices.find((candidate) => candidate === value);
  if (choice === undefined) throw new Error(`read-episode: column ${key} holds unknown value ${value}`);
  return choice;
}

function toEpisode(row: Row): Episode {
  const renderPath = row.render_path;
  return {
    id: readString(row, 'id'),
    night: readNumber(row, 'night'),
    format: readChoice(row, 'format', EPISODE_FORMATS),
    trackSlug: readString(row, 'track_slug'),
    startSecond: readNumber(row, 'start_second'),
    durationSeconds: readNumber(row, 'duration_seconds'),
    caption: readString(row, 'caption'),
    claim: readString(row, 'claim'),
    publishAt: formatLjubljanaIso(readNumber(row, 'publish_at_ms')),
    labelDecision: readChoice(row, 'label_decision', LABEL_DECISIONS),
    status: readChoice(row, 'status', EPISODE_STATUSES),
    renderPath: typeof renderPath === 'string' ? renderPath : null,
  };
}

/** Reads one episode in the API shape, or undefined when the id is unknown. */
export function readEpisode(db: DatabaseSync, episodeId: string): Episode | undefined {
  const row = db.prepare(`${EPISODE_SELECT} WHERE e.id = ?`).get(episodeId);
  return row === undefined ? undefined : toEpisode(row);
}

/** Reads a week's plan in the API shape, episodes ordered by night, or undefined when there is no plan. */
export function readPlan(db: DatabaseSync, weekStart: string): Plan | undefined {
  const planRow = db.prepare('SELECT week_start, status FROM plans WHERE week_start = ?').get(weekStart);
  if (planRow === undefined) return undefined;
  const episodeRows = db.prepare(`${EPISODE_SELECT} WHERE e.week_start = ? ORDER BY e.night`).all(weekStart);
  return {
    weekStart: readString(planRow, 'week_start'),
    status: readChoice(planRow, 'status', PLAN_STATUSES),
    episodes: episodeRows.map(toEpisode),
  };
}

/** True when a TikTok publish row for the episode has status sent. A sent night is frozen. */
export function isEpisodeSent(db: DatabaseSync, episodeId: string): boolean {
  const row = db
    .prepare("SELECT 1 AS found FROM publishes WHERE episode_id = ? AND platform = 'tiktok' AND status = 'sent'")
    .get(episodeId);
  return row !== undefined;
}

export function hasRender(db: DatabaseSync, episodeId: string): boolean {
  return db.prepare('SELECT 1 AS found FROM renders WHERE episode_id = ? LIMIT 1').get(episodeId) !== undefined;
}

/** Path of the newest render of an episode, as stored: relative to the project root, or absolute. */
export function readLatestRenderPath(db: DatabaseSync, episodeId: string): string | undefined {
  const row = db
    .prepare('SELECT file_path FROM renders WHERE episode_id = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 1')
    .get(episodeId);
  return row === undefined ? undefined : readString(row, 'file_path');
}
