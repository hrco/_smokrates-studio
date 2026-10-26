import type {DatabaseSync} from 'node:sqlite';
import {runInTransaction} from './withTransaction';

export type AttachRenderResult = {kind: 'attached'; renderId: string} | {kind: 'not-found'};

/**
 * Records a finished render for an episode and marks the night ready. The file path is stored relative
 * to the project root, such as out/ep-1.mp4. A skipped night stays skipped. Any other status becomes
 * ready, so a new render must be approved again.
 */
export function attachRender(
  db: DatabaseSync,
  options: {
    episodeId: string;
    filePath: string;
    durationSeconds: number;
    frameCount: number;
    nowMs: number;
    newId: () => string;
  },
): AttachRenderResult {
  const {episodeId, filePath, durationSeconds, frameCount, nowMs, newId} = options;
  return runInTransaction(db, `attach-render ${episodeId}`, () => {
    const episode = db.prepare('SELECT 1 AS found FROM episodes WHERE id = ?').get(episodeId);
    if (episode === undefined) return {kind: 'not-found'};

    const renderId = newId();
    db.prepare(
      `INSERT INTO renders (id, episode_id, file_path, duration_seconds, frame_count, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(renderId, episodeId, filePath, durationSeconds, frameCount, nowMs);
    db.prepare("UPDATE episodes SET status = 'ready' WHERE id = ? AND status <> 'skipped'").run(episodeId);
    return {kind: 'attached', renderId};
  });
}
