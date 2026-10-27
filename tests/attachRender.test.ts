import {describe, expect, it} from 'vitest';
import {parseAttachRenderArgs} from '../src/cli/parseAttachRenderArgs';
import {getPlan, importPlan} from '../src/store/planStore';
import {attachRender} from '../src/store/renderStore';
import {openStudioDb} from '../src/store/studioDb';

describe('parseAttachRenderArgs', () => {
  it('parses an episode id and an mp4 path', () => {
    expect(parseAttachRenderArgs(['ep-1', 'out/a.mp4'])).toEqual({
      ok: true,
      args: {episodeId: 'ep-1', filePath: 'out/a.mp4'},
    });
  });

  it.each([[[]], [['ep-1']], [['bad id', 'a.mp4']], [['ep-1', 'a.mov']], [['ep-1', 'a.mp4', 'extra']]])(
    'rejects %j with the usage text',
    (argv) => {
      const result = parseAttachRenderArgs(argv);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('usage: studio-attach-render');
    },
  );
});

describe('attachRender', () => {
  function seedEpisode() {
    const {db} = openStudioDb({dbPath: ':memory:'});
    importPlan(db, {
      plan: {
        weekStart: '2026-10-26',
        shouldReplace: false,
        episodes: [
          {
            night: 1,
            format: 'track_card',
            trackSlug: 'slug',
            startSecond: 0,
            durationSeconds: 15,
            caption: 'caption',
            claim: 'claim',
            publishAtMs: 2_000_000_000_000,
            labelDecision: 'label_off',
          },
        ],
      },
      nowMs: 1,
      newId: () => 'ep-1',
    });
    return db;
  }

  it('records the render and marks the night ready', () => {
    const db = seedEpisode();
    const result = attachRender(db, {
      episodeId: 'ep-1',
      filePath: 'out/ep-1.mp4',
      durationSeconds: 15,
      frameCount: 450,
      nowMs: 5,
      newId: () => 'render-1',
    });

    expect(result).toEqual({kind: 'attached', renderId: 'render-1'});
    const episode = getPlan(db, '2026-10-26');
    expect(episode.kind === 'found' && episode.plan.episodes[0]).toMatchObject({
      status: 'ready',
      renderPath: 'out/ep-1.mp4',
    });
  });

  it.each(['processing', 'stalled', 'failed', 'sent'])('refuses a %s publish row and writes nothing', (status) => {
    const db = seedEpisode();
    db.prepare(
      'INSERT INTO publishes (id, episode_id, platform, status, created_at_ms) VALUES (?, ?, ?, ?, 1)',
    ).run('p', 'ep-1', 'tiktok', status);
    const result = attachRender(db, {
      episodeId: 'ep-1',
      filePath: 'out/ep-1.mp4',
      durationSeconds: 15,
      frameCount: 450,
      nowMs: 5,
      newId: () => 'render-1',
    });
    expect(result).toEqual({kind: 'already-sent'});
    expect(db.prepare('SELECT COUNT(*) AS count FROM renders').get()).toEqual({count: 0});
  });

  it('refuses a youtube publish row the same way', () => {
    const db = seedEpisode();
    db.prepare(
      "INSERT INTO publishes (id, episode_id, platform, status, created_at_ms) VALUES ('p', 'ep-1', 'youtube', 'sent', 1)",
    ).run();
    const result = attachRender(db, {
      episodeId: 'ep-1',
      filePath: 'out/ep-1.mp4',
      durationSeconds: 15,
      frameCount: 450,
      nowMs: 5,
      newId: () => 'render-1',
    });
    expect(result).toEqual({kind: 'already-sent'});
    expect(db.prepare('SELECT COUNT(*) AS count FROM renders').get()).toEqual({count: 0});
  });

  it('records a render on a skipped night and leaves it skipped', () => {
    const db = seedEpisode();
    db.prepare("UPDATE episodes SET status = 'skipped' WHERE id = 'ep-1'").run();

    const result = attachRender(db, {
      episodeId: 'ep-1',
      filePath: 'out/ep-1.mp4',
      durationSeconds: 15,
      frameCount: 450,
      nowMs: 5,
      newId: () => 'render-1',
    });

    expect(result).toEqual({kind: 'attached', renderId: 'render-1'});
    const episode = getPlan(db, '2026-10-26');
    expect(episode.kind === 'found' && episode.plan.episodes[0]).toMatchObject({
      status: 'skipped',
      renderPath: 'out/ep-1.mp4',
    });
  });

  it('puts an approved night back to ready so the new video is approved again', () => {
    const db = seedEpisode();
    db.prepare("UPDATE episodes SET status = 'approved' WHERE id = 'ep-1'").run();

    const result = attachRender(db, {
      episodeId: 'ep-1',
      filePath: 'out/ep-1.mp4',
      durationSeconds: 15,
      frameCount: 450,
      nowMs: 5,
      newId: () => 'render-1',
    });

    expect(result).toEqual({kind: 'attached', renderId: 'render-1'});
    const episode = getPlan(db, '2026-10-26');
    expect(episode.kind === 'found' && episode.plan.episodes[0]?.status).toBe('ready');
  });

  it('names an unknown episode and writes nothing', () => {
    const db = seedEpisode();
    const result = attachRender(db, {
      episodeId: 'nope',
      filePath: 'out/x.mp4',
      durationSeconds: 1,
      frameCount: 30,
      nowMs: 5,
      newId: () => 'render-x',
    });
    expect(result).toEqual({kind: 'not-found'});
    expect(db.prepare('SELECT COUNT(*) AS count FROM renders').get()).toEqual({count: 0});
  });
});
