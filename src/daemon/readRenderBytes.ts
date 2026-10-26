import {readFile} from 'node:fs/promises';
import type {DatabaseSync} from 'node:sqlite';
import {readLatestRenderPath} from '../store/episodeRows';
import {resolveRenderFile} from './serveMedia';

export type ReadRenderBytesResult =
  | {ok: true; videoBytes: Uint8Array<ArrayBuffer>}
  | {ok: false; message: string};

/**
 * Reads the newest render of an episode. The file must resolve inside outDir.
 * A missing file or a path outside that folder is a result, so the tick does not claim a publish row.
 */
export async function readRenderBytes(options: {
  db: DatabaseSync;
  outDir: string;
  episodeId: string;
}): Promise<ReadRenderBytesResult> {
  const {db, outDir, episodeId} = options;
  const storedPath = readLatestRenderPath(db, episodeId);
  if (storedPath === undefined) return {ok: false, message: `No render file for episode ${episodeId}.`};
  const realFile = await resolveRenderFile({storedPath, outDir});
  if (realFile === undefined) return {ok: false, message: `Render for episode ${episodeId} is not in the out folder.`};
  return readVideoFile(realFile, episodeId);
}

async function readVideoFile(realFile: string, episodeId: string): Promise<ReadRenderBytesResult> {
  try {
    const fileBytes = await readFile(realFile);
    const videoBytes = new Uint8Array(fileBytes.byteLength);
    videoBytes.set(fileBytes);
    return {ok: true, videoBytes};
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return {ok: false, message: `Could not read the render for episode ${episodeId}: ${cause}`};
  }
}
