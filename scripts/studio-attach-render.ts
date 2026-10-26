process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {randomUUID} from 'node:crypto';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {parseAttachRenderArgs} from '../src/cli/parseAttachRenderArgs';
import {readDaemonConfig} from '../src/daemon/readDaemonConfig';
import {attachRender} from '../src/store/renderStore';
import {openStudioDb} from '../src/store/studioDb';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'out');
const RENDER_FPS = 30;

function exitWithError(message: string): never {
  console.error(`studio-attach-render: ${message}`);
  process.exit(1);
}

async function assertIsFileInsideOutDir(absolutePath: string): Promise<void> {
  const isInsideOutDir = absolutePath.startsWith(OUT_DIR + path.sep);
  if (!isInsideOutDir) exitWithError(`${absolutePath} is not inside ${OUT_DIR}`);
  const isFile = await stat(absolutePath).then((info) => info.isFile(), () => false);
  if (!isFile) exitWithError(`file not found: ${absolutePath}`);
}

function readEpisodeDurationSeconds(db: DatabaseSync, episodeId: string): number {
  const row = db.prepare('SELECT duration_seconds FROM episodes WHERE id = ?').get(episodeId);
  if (row === undefined) exitWithError(`no episode with id ${episodeId}`);
  return Number(row.duration_seconds);
}

async function main(): Promise<void> {
  const parsed = parseAttachRenderArgs(process.argv.slice(2));
  if (!parsed.ok) exitWithError(parsed.message);
  const absolutePath = path.resolve(parsed.args.filePath);
  await assertIsFileInsideOutDir(absolutePath);

  const configResult = readDaemonConfig(process.env);
  if (!configResult.ok) exitWithError(configResult.message);
  const {db} = openStudioDb({dbPath: configResult.config.dbPath});
  try {
    const durationSeconds = readEpisodeDurationSeconds(db, parsed.args.episodeId);
    const result = attachRender(db, {
      episodeId: parsed.args.episodeId,
      filePath: path.relative(PROJECT_ROOT, absolutePath),
      durationSeconds,
      frameCount: Math.round(durationSeconds * RENDER_FPS),
      nowMs: Date.now(),
      newId: () => randomUUID(),
    });
    if (result.kind === 'not-found') exitWithError(`no episode with id ${parsed.args.episodeId}`);
    if (result.kind === 'already-sent') {
      exitWithError(`episode ${parsed.args.episodeId} already has a publish row, so it is frozen and takes no new render`);
    }
    console.log(`attached ${path.relative(PROJECT_ROOT, absolutePath)} to ${parsed.args.episodeId}; status ready`);
  } finally {
    db.close();
  }
}

await main();
