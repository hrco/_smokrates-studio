import type {DatabaseSync} from 'node:sqlite';
import {beforeEach, describe, expect, it} from 'vitest';
import {
  approveEpisode,
  approveWeek,
  getPlan,
  importPlan,
  skipEpisode,
  updateEpisode,
} from '../src/store/planStore';
import type {EpisodeInput, Plan} from '../src/store/planTypes';
import {openStudioDb} from '../src/store/studioDb';

const WEEK_START = '2026-10-26';
const NOW_MS = Date.parse('2026-10-26T08:00:00+01:00');
const FUTURE_MS = Date.parse('2026-10-27T18:00:00+01:00');

function buildEpisodeInput(night: number, overrides: Partial<EpisodeInput> = {}): EpisodeInput {
  return {
    night,
    format: 'track_card',
    trackSlug: 'golden-hour-groove',
    startSecond: 12,
    durationSeconds: 15,
    caption: 'Golden Hour Groove',
    claim: 'New dub every night',
    publishAtMs: FUTURE_MS + night * 86_400_000,
    labelDecision: 'label_off',
    ...overrides,
  };
}

function createIdFactory(): () => string {
  let counter = 0;
  return () => `ep-${++counter}`;
}

function importWeek(db: DatabaseSync, options: {nightCount?: number; shouldReplace?: boolean} = {}) {
  return importPlan(db, {
    plan: {
      weekStart: WEEK_START,
      shouldReplace: options.shouldReplace ?? false,
      episodes: Array.from({length: options.nightCount ?? 3}, (_, index) => buildEpisodeInput(index + 1)),
    },
    nowMs: NOW_MS,
    newId: createIdFactory(),
  });
}

function addRender(db: DatabaseSync, episodeId: string, createdAtMs = 1): void {
  db.prepare(
    `INSERT INTO renders (id, episode_id, file_path, duration_seconds, frame_count, created_at_ms)
     VALUES (?, ?, ?, 15, 450, ?)`,
  ).run(`render-${episodeId}-${createdAtMs}`, episodeId, `out/${episodeId}-${createdAtMs}.mp4`, createdAtMs);
  db.prepare("UPDATE episodes SET status = 'ready' WHERE id = ?").run(episodeId);
}

function addSentPublish(db: DatabaseSync, episodeId: string, status = 'sent'): void {
  db.prepare(
    `INSERT INTO publishes (id, episode_id, platform, status, created_at_ms)
     VALUES (?, ?, 'tiktok', ?, 1)`,
  ).run(`pub-${episodeId}`, episodeId, status);
}

function requirePlan(db: DatabaseSync): Plan {
  const result = getPlan(db, WEEK_START);
  if (result.kind !== 'found') throw new Error('expected a plan');
  return result.plan;
}

let db: DatabaseSync;

beforeEach(() => {
  db = openStudioDb({dbPath: ':memory:'}).db;
});

describe('importPlan', () => {
  it('writes a draft plan with every night planned', () => {
    const result = importWeek(db);

    expect(result.kind).toBe('imported');
    const plan = requirePlan(db);
    expect(plan.status).toBe('draft');
    expect(plan.episodes.map((episode) => [episode.id, episode.night, episode.status])).toEqual([
      ['ep-1', 1, 'planned'],
      ['ep-2', 2, 'planned'],
      ['ep-3', 3, 'planned'],
    ]);
  });

  it('refuses a second import when a night is past planned', () => {
    importWeek(db);
    addRender(db, 'ep-1');

    expect(importWeek(db)).toEqual({kind: 'work-in-progress'});
    expect(requirePlan(db).episodes).toHaveLength(3);
  });

  it('allows a second import while every night is still planned', () => {
    importWeek(db);
    expect(importWeek(db, {nightCount: 2}).kind).toBe('imported');
    expect(requirePlan(db).episodes).toHaveLength(2);
  });

  it('replaces a week in progress when told to, and drops its renders', () => {
    importWeek(db);
    addRender(db, 'ep-1');

    const result = importWeek(db, {shouldReplace: true, nightCount: 2});

    expect(result.kind).toBe('imported');
    expect(requirePlan(db).episodes.map((episode) => episode.status)).toEqual(['planned', 'planned']);
    expect(db.prepare('SELECT COUNT(*) AS count FROM renders').get()).toEqual({count: 0});
  });

  it('never replaces a week that has a publish row', () => {
    importWeek(db);
    addSentPublish(db, 'ep-1');

    expect(importWeek(db, {shouldReplace: true})).toEqual({kind: 'has-publishes'});
    expect(requirePlan(db).episodes).toHaveLength(3);
  });
});

describe('getPlan', () => {
  it('returns the API shape with an ISO publish time and the latest render path', () => {
    importWeek(db);
    addRender(db, 'ep-1', 1);
    addRender(db, 'ep-1', 2);

    const [first, second] = requirePlan(db).episodes;

    expect(first).toEqual({
      id: 'ep-1',
      night: 1,
      format: 'track_card',
      trackSlug: 'golden-hour-groove',
      startSecond: 12,
      durationSeconds: 15,
      caption: 'Golden Hour Groove',
      claim: 'New dub every night',
      publishAt: '2026-10-28T18:00:00+01:00',
      labelDecision: 'label_off',
      status: 'ready',
      renderPath: 'out/ep-1-2.mp4',
    });
    expect(second?.renderPath).toBeNull();
  });

  it('keeps the summer offset for a time before the clocks change back', () => {
    importPlan(db, {
      plan: {
        weekStart: '2026-10-19',
        shouldReplace: false,
        episodes: [buildEpisodeInput(1, {publishAtMs: Date.parse('2026-10-20T18:00:00+02:00')})],
      },
      nowMs: NOW_MS,
      newId: createIdFactory(),
    });
    const result = getPlan(db, '2026-10-19');
    expect(result.kind === 'found' && result.plan.episodes[0]?.publishAt).toBe('2026-10-20T18:00:00+02:00');
  });

  it('says there is no plan for an unknown week', () => {
    expect(getPlan(db, WEEK_START)).toEqual({kind: 'no-plan'});
  });
});

describe('updateEpisode', () => {
  beforeEach(() => {
    importWeek(db);
  });

  it('changes the caption and the time', () => {
    const newTimeMs = FUTURE_MS + 3_600_000;
    const result = updateEpisode(db, {
      episodeId: 'ep-1',
      update: {caption: 'New words', publishAtMs: newTimeMs},
      nowMs: NOW_MS,
    });

    expect(result.kind === 'updated' && result.episode.caption).toBe('New words');
    expect(result.kind === 'updated' && result.episode.publishAt).toBe('2026-10-27T19:00:00+01:00');
  });

  it('refuses a time that is now or in the past and changes nothing', () => {
    for (const publishAtMs of [NOW_MS, NOW_MS - 1]) {
      const result = updateEpisode(db, {
        episodeId: 'ep-1',
        update: {caption: 'Changed', publishAtMs},
        nowMs: NOW_MS,
      });
      expect(result).toEqual({kind: 'time-in-past'});
    }
    expect(requirePlan(db).episodes[0]?.caption).toBe('Golden Hour Groove');
  });

  it('refuses a sent night', () => {
    addSentPublish(db, 'ep-1');
    expect(updateEpisode(db, {episodeId: 'ep-1', update: {caption: 'x'}, nowMs: NOW_MS})).toEqual({
      kind: 'already-sent',
    });
  });

  it.each(['processing', 'stalled', 'failed'])('refuses a night whose publish row is %s', (status) => {
    addSentPublish(db, 'ep-1', status);
    addRender(db, 'ep-1');
    expect(updateEpisode(db, {episodeId: 'ep-1', update: {startSecond: 30}, nowMs: NOW_MS})).toEqual({
      kind: 'already-sent',
    });
    expect(requirePlan(db).episodes[0]?.renderPath).toBe('out/ep-1-1.mp4');
  });

  it('names an unknown episode', () => {
    expect(updateEpisode(db, {episodeId: 'nope', update: {caption: 'x'}, nowMs: NOW_MS})).toEqual({
      kind: 'not-found',
    });
  });

  it('clears the render when the start second changes, but not when the caption does', () => {
    addRender(db, 'ep-1');

    updateEpisode(db, {episodeId: 'ep-1', update: {caption: 'Only words'}, nowMs: NOW_MS});
    expect(requirePlan(db).episodes[0]?.renderPath).toBe('out/ep-1-1.mp4');

    const result = updateEpisode(db, {episodeId: 'ep-1', update: {startSecond: 30}, nowMs: NOW_MS});
    expect(result.kind === 'updated' && result.episode.renderPath).toBeNull();
    expect(result.kind === 'updated' && result.episode.status).toBe('planned');
  });
});

describe('approveEpisode', () => {
  beforeEach(() => {
    importWeek(db);
  });

  it('refuses a night that is not rendered', () => {
    expect(approveEpisode(db, {episodeId: 'ep-1'})).toEqual({kind: 'not-rendered'});
  });

  it('approves a rendered night', () => {
    addRender(db, 'ep-1');
    const result = approveEpisode(db, {episodeId: 'ep-1'});
    expect(result.kind === 'approved' && result.episode.status).toBe('approved');
  });

  it('refuses a night that is not new', () => {
    addRender(db, 'ep-1');
    db.prepare("UPDATE episodes SET status = 'not_new' WHERE id = 'ep-1'").run();
    expect(approveEpisode(db, {episodeId: 'ep-1'})).toEqual({kind: 'not-new', night: 1});
  });

  it('refuses a skipped night and an unknown one', () => {
    addRender(db, 'ep-1');
    skipEpisode(db, {episodeId: 'ep-1'});
    expect(approveEpisode(db, {episodeId: 'ep-1'})).toEqual({kind: 'is-skipped'});
    expect(approveEpisode(db, {episodeId: 'nope'})).toEqual({kind: 'not-found'});
  });
});

describe('skipEpisode', () => {
  beforeEach(() => {
    importWeek(db);
  });

  it('skips a night', () => {
    const result = skipEpisode(db, {episodeId: 'ep-2'});
    expect(result.kind === 'skipped' && result.episode.status).toBe('skipped');
  });

  it('refuses a sent night', () => {
    addSentPublish(db, 'ep-2');
    expect(skipEpisode(db, {episodeId: 'ep-2'})).toEqual({kind: 'already-sent'});
    expect(requirePlan(db).episodes[1]?.status).toBe('planned');
  });

  it.each(['processing', 'stalled', 'failed'])('refuses a night whose publish row is %s', (status) => {
    addSentPublish(db, 'ep-2', status);
    expect(skipEpisode(db, {episodeId: 'ep-2'})).toEqual({kind: 'already-sent'});
    expect(requirePlan(db).episodes[1]?.status).toBe('planned');
  });

  it('names an unknown episode', () => {
    expect(skipEpisode(db, {episodeId: 'nope'})).toEqual({kind: 'not-found'});
  });
});

describe('approveWeek', () => {
  beforeEach(() => {
    importWeek(db);
  });

  it('names the first unrendered night and changes nothing', () => {
    addRender(db, 'ep-1');
    addRender(db, 'ep-3');

    expect(approveWeek(db, {weekStart: WEEK_START})).toEqual({kind: 'not-rendered', night: 2});
    expect(requirePlan(db).status).toBe('draft');
    expect(requirePlan(db).episodes.map((episode) => episode.status)).toEqual(['ready', 'planned', 'ready']);
  });

  it('approves the week when every night is rendered or skipped', () => {
    addRender(db, 'ep-1');
    skipEpisode(db, {episodeId: 'ep-2'});
    addRender(db, 'ep-3');

    const result = approveWeek(db, {weekStart: WEEK_START});

    expect(result.kind).toBe('approved');
    const plan = requirePlan(db);
    expect(plan.status).toBe('approved');
    expect(plan.episodes.map((episode) => episode.status)).toEqual(['approved', 'skipped', 'approved']);
  });

  it('blocks on a night that is not new', () => {
    addRender(db, 'ep-1');
    skipEpisode(db, {episodeId: 'ep-2'});
    addRender(db, 'ep-3');
    db.prepare("UPDATE episodes SET status = 'not_new' WHERE id = 'ep-3'").run();

    expect(approveWeek(db, {weekStart: WEEK_START})).toEqual({kind: 'not-new', night: 3});
  });

  it('says there is no plan for an unknown week', () => {
    expect(approveWeek(db, {weekStart: '2026-11-02'})).toEqual({kind: 'no-plan'});
  });
});
