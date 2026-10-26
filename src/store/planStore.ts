import type {DatabaseSync} from 'node:sqlite';
import {hasRender, isEpisodeSent, readEpisode, readPlan} from './episodeRows';
import type {Episode, EpisodeInput, EpisodeUpdate, Plan, PlanImport} from './planTypes';
import {runInTransaction} from './withTransaction';

type Clock = {nowMs: number};

export type ImportPlanResult =
  | {kind: 'imported'; plan: Plan}
  | {kind: 'work-in-progress'}
  | {kind: 'has-publishes'};

export type GetPlanResult = {kind: 'found'; plan: Plan} | {kind: 'no-plan'};

export type UpdateEpisodeResult =
  | {kind: 'updated'; episode: Episode}
  | {kind: 'not-found'}
  | {kind: 'time-in-past'}
  | {kind: 'already-sent'};

export type ApproveEpisodeResult =
  | {kind: 'approved'; episode: Episode}
  | {kind: 'not-found'}
  | {kind: 'is-skipped'}
  | {kind: 'not-rendered'};

export type SkipEpisodeResult =
  | {kind: 'skipped'; episode: Episode}
  | {kind: 'not-found'}
  | {kind: 'already-sent'};

/** A skipped night does not block the week. A night that is not new, or not rendered, does. */
export type ApproveWeekResult =
  | {kind: 'approved'; plan: Plan}
  | {kind: 'no-plan'}
  | {kind: 'not-rendered'; night: number}
  | {kind: 'not-new'; night: number};

const UPDATE_COLUMNS: ReadonlyArray<readonly [keyof EpisodeUpdate, string]> = [
  ['publishAtMs', 'publish_at_ms'],
  ['caption', 'caption'],
  ['trackSlug', 'track_slug'],
  ['startSecond', 'start_second'],
  ['durationSeconds', 'duration_seconds'],
  ['format', 'format'],
  ['labelDecision', 'label_decision'],
];

const RENDER_INPUT_FIELDS: ReadonlyArray<'trackSlug' | 'startSecond' | 'durationSeconds' | 'format'> = [
  'trackSlug',
  'startSecond',
  'durationSeconds',
  'format',
];

function insertEpisode(db: DatabaseSync, options: {id: string; weekStart: string; episode: EpisodeInput}): void {
  const {id, weekStart, episode} = options;
  db.prepare(
    `INSERT INTO episodes (id, week_start, night, format, track_slug, start_second, duration_seconds,
       claim, caption, publish_at_ms, label_decision, status, groks_prompt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?)`,
  ).run(
    id,
    weekStart,
    episode.night,
    episode.format,
    episode.trackSlug,
    episode.startSecond,
    episode.durationSeconds,
    episode.claim,
    episode.caption,
    episode.publishAtMs,
    episode.labelDecision,
    episode.groksPrompt ?? null,
  );
}

function hasWorkInProgress(db: DatabaseSync, weekStart: string): boolean {
  const row = db
    .prepare("SELECT 1 AS found FROM episodes WHERE week_start = ? AND status <> 'planned' LIMIT 1")
    .get(weekStart);
  return row !== undefined;
}

function hasPublishRows(db: DatabaseSync, weekStart: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS found FROM publishes p JOIN episodes e ON e.id = p.episode_id
       WHERE e.week_start = ? LIMIT 1`,
    )
    .get(weekStart);
  return row !== undefined;
}

function deleteWeek(db: DatabaseSync, weekStart: string): void {
  const episodeIds = '(SELECT id FROM episodes WHERE week_start = ?)';
  db.prepare(`DELETE FROM jobs WHERE episode_id IN ${episodeIds}`).run(weekStart);
  db.prepare(`DELETE FROM renders WHERE episode_id IN ${episodeIds}`).run(weekStart);
  db.prepare('DELETE FROM episodes WHERE week_start = ?').run(weekStart);
  db.prepare('DELETE FROM plans WHERE week_start = ?').run(weekStart);
}

function requirePlan(db: DatabaseSync, weekStart: string): Plan {
  const plan = readPlan(db, weekStart);
  if (plan === undefined) throw new Error(`plan ${weekStart} vanished inside its transaction`);
  return plan;
}

/**
 * Writes a hand-written week as a draft with every night planned.
 * Refuses when any night is past planned, unless the import says replace. Replace never destroys a
 * week that has a publish row: a sent night stays on record.
 */
export function importPlan(
  db: DatabaseSync,
  options: Clock & {plan: PlanImport; newId: () => string},
): ImportPlanResult {
  const {plan: planImport, nowMs, newId} = options;
  const {weekStart} = planImport;
  return runInTransaction(db, `import-plan ${weekStart}`, () => {
    if (!planImport.shouldReplace && hasWorkInProgress(db, weekStart)) return {kind: 'work-in-progress'};
    if (hasPublishRows(db, weekStart)) return {kind: 'has-publishes'};

    deleteWeek(db, weekStart);
    db.prepare("INSERT INTO plans (week_start, status, created_at_ms) VALUES (?, 'draft', ?)").run(weekStart, nowMs);
    for (const episode of planImport.episodes) insertEpisode(db, {id: newId(), weekStart, episode});
    return {kind: 'imported', plan: requirePlan(db, weekStart)};
  });
}

/** Reads the plan of one week with its episodes and latest render paths. */
export function getPlan(db: DatabaseSync, weekStart: string): GetPlanResult {
  const plan = readPlan(db, weekStart);
  return plan === undefined ? {kind: 'no-plan'} : {kind: 'found', plan};
}

function changesRenderInput(current: Episode, update: EpisodeUpdate): boolean {
  return RENDER_INPUT_FIELDS.some((field) => update[field] !== undefined && update[field] !== current[field]);
}

function applyUpdate(db: DatabaseSync, episodeId: string, update: EpisodeUpdate): void {
  const assignments: string[] = [];
  const values: Array<string | number> = [];
  for (const [field, column] of UPDATE_COLUMNS) {
    const value = update[field];
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(value);
  }
  if (assignments.length === 0) return;
  db.prepare(`UPDATE episodes SET ${assignments.join(', ')} WHERE id = ?`).run(...values, episodeId);
}

function clearRender(db: DatabaseSync, episodeId: string): void {
  db.prepare('DELETE FROM renders WHERE episode_id = ?').run(episodeId);
  db.prepare("UPDATE episodes SET status = 'planned' WHERE id = ? AND status IN ('rendering', 'ready', 'approved')").run(
    episodeId,
  );
}

/**
 * Changes fields of one night. Refuses a sent night and a time that is not in the future.
 * A change to track, start second, duration or format clears the render, because the old video no
 * longer matches. The caller has validated the values at the boundary.
 */
export function updateEpisode(
  db: DatabaseSync,
  options: Clock & {episodeId: string; update: EpisodeUpdate},
): UpdateEpisodeResult {
  const {episodeId, update, nowMs} = options;
  return runInTransaction(db, `update-episode ${episodeId}`, () => {
    const current = readEpisode(db, episodeId);
    if (current === undefined) return {kind: 'not-found'};
    if (isEpisodeSent(db, episodeId)) return {kind: 'already-sent'};
    if (update.publishAtMs !== undefined && update.publishAtMs <= nowMs) return {kind: 'time-in-past'};

    const shouldClearRender = changesRenderInput(current, update);
    applyUpdate(db, episodeId, update);
    if (shouldClearRender) clearRender(db, episodeId);
    return {kind: 'updated', episode: requireEpisode(db, episodeId)};
  });
}

function requireEpisode(db: DatabaseSync, episodeId: string): Episode {
  const episode = readEpisode(db, episodeId);
  if (episode === undefined) throw new Error(`episode ${episodeId} vanished inside its transaction`);
  return episode;
}

/** Approves one rendered night. Approving an approved night is a no-op. A skipped night cannot be approved. */
export function approveEpisode(db: DatabaseSync, options: {episodeId: string}): ApproveEpisodeResult {
  const {episodeId} = options;
  return runInTransaction(db, `approve-episode ${episodeId}`, () => {
    const current = readEpisode(db, episodeId);
    if (current === undefined) return {kind: 'not-found'};
    if (current.status === 'skipped') return {kind: 'is-skipped'};
    if (!hasRender(db, episodeId)) return {kind: 'not-rendered'};

    db.prepare("UPDATE episodes SET status = 'approved' WHERE id = ?").run(episodeId);
    return {kind: 'approved', episode: requireEpisode(db, episodeId)};
  });
}

/** Skips one night so it is never sent. Refuses a night that is already sent. */
export function skipEpisode(db: DatabaseSync, options: {episodeId: string}): SkipEpisodeResult {
  const {episodeId} = options;
  return runInTransaction(db, `skip-episode ${episodeId}`, () => {
    if (readEpisode(db, episodeId) === undefined) return {kind: 'not-found'};
    if (isEpisodeSent(db, episodeId)) return {kind: 'already-sent'};

    db.prepare("UPDATE episodes SET status = 'skipped' WHERE id = ?").run(episodeId);
    return {kind: 'skipped', episode: requireEpisode(db, episodeId)};
  });
}

function findBlockingNight(db: DatabaseSync, plan: Plan): ApproveWeekResult | undefined {
  for (const episode of plan.episodes) {
    if (episode.status === 'skipped') continue;
    if (episode.status === 'not_new') return {kind: 'not-new', night: episode.night};
    if (!hasRender(db, episode.id)) return {kind: 'not-rendered', night: episode.night};
  }
  return undefined;
}

/**
 * Approves the week: every rendered night becomes approved and the plan becomes approved.
 * A skipped night does not block. The first night, in night order, that is not rendered or not new
 * stops the approval and nothing changes.
 */
export function approveWeek(db: DatabaseSync, options: {weekStart: string}): ApproveWeekResult {
  const {weekStart} = options;
  return runInTransaction(db, `approve-week ${weekStart}`, () => {
    const plan = readPlan(db, weekStart);
    if (plan === undefined) return {kind: 'no-plan'};
    const blockingNight = findBlockingNight(db, plan);
    if (blockingNight !== undefined) return blockingNight;

    db.prepare("UPDATE episodes SET status = 'approved' WHERE week_start = ? AND status <> 'skipped'").run(weekStart);
    db.prepare("UPDATE plans SET status = 'approved' WHERE week_start = ?").run(weekStart);
    return {kind: 'approved', plan: requirePlan(db, weekStart)};
  });
}
