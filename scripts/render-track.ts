process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {copyFile, mkdir, rm, stat, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {findTrackDirBySlug, loadTrack, type Track} from '../src/assets/smokStudio';
import {parseRenderArgs, type RenderArgs} from '../src/cli/parseRenderArgs';
import {buildPublishSidecar, toShortLine} from '../src/publish/buildCaption';
import type {TrackCardProps} from '../src/compositions/TrackCard';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'out');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const COMPOSITION_ID = 'TrackCard';
const RENDER_CONCURRENCY = 2;
const STILL_FRAMES = [0, 300];

function exitWithError(message: string): never {
  console.error(`render-track: ${message}`);
  process.exit(1);
}

function readStudioDir(): string {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const studioDir = process.env.SMOK_STUDIO_DIR;
  if (!studioDir) exitWithError('SMOK_STUDIO_DIR is not set. Set it in .env or the shell (see .env.example).');
  return studioDir;
}

async function loadTrackOrExit(studioDir: string, slug: string): Promise<Track> {
  const trackDir = await findTrackDirBySlug(studioDir, slug);
  if (!trackDir) exitWithError(`no track with slug "${slug}" under ${studioDir}`);
  const result = await loadTrack(trackDir);
  if (!result.ok) {
    exitWithError(`slug "${slug}": ${result.error.code} in ${result.error.trackDir} (${result.error.detail})`);
  }
  return result.track;
}

async function stageMedia(track: Track, args: RenderArgs): Promise<TrackCardProps> {
  const relativeDir = path.posix.join('media', track.slug);
  const stagedDir = path.join(PUBLIC_DIR, relativeDir);
  await rm(stagedDir, {recursive: true, force: true});
  await mkdir(stagedDir, {recursive: true});

  const audioName = `audio${path.extname(track.audioPath).toLowerCase()}`;
  await copyFile(track.coverPath, path.join(stagedDir, 'cover.png'));
  await copyFile(track.audioPath, path.join(stagedDir, audioName));

  const props: TrackCardProps = {
    title: track.title,
    theme: toShortLine(track.theme),
    coverSrc: path.posix.join(relativeDir, 'cover.png'),
    audioSrc: path.posix.join(relativeDir, audioName),
    audioStartSeconds: args.audioStartSeconds,
  };
  if (!args.backgroundPath) return props;

  const backgroundName = `background${path.extname(args.backgroundPath).toLowerCase()}`;
  await copyFile(args.backgroundPath, path.join(stagedDir, backgroundName));
  return {...props, backgroundVideoSrc: path.posix.join(relativeDir, backgroundName)};
}

async function assertBackgroundExists(backgroundPath: string | undefined): Promise<void> {
  if (!backgroundPath) return;
  const isFile = await stat(backgroundPath).then((info) => info.isFile(), () => false);
  if (!isFile) exitWithError(`--background file not found: ${backgroundPath}`);
}

function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

async function renderVideoAndStills(props: TrackCardProps, args: RenderArgs, outputBase: string): Promise<void> {
  const serveUrl = await bundle({
    entryPoint: path.join(PROJECT_ROOT, 'src/index.ts'),
    publicDir: PUBLIC_DIR,
  });
  const composition = await selectComposition({serveUrl, id: COMPOSITION_ID, inputProps: props});
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    concurrency: RENDER_CONCURRENCY,
    inputProps: props,
    outputLocation: `${outputBase}.mp4`,
    onProgress: ({progress}) => process.stdout.write(`\rrendering ${Math.round(progress * 100)}%`),
  });
  process.stdout.write('\n');
  if (!args.shouldRenderStills) return;

  for (const frame of STILL_FRAMES) {
    await renderStill({
      composition,
      serveUrl,
      frame,
      inputProps: props,
      output: `${outputBase}-frame${frame}.png`,
    });
  }
}

async function main(): Promise<void> {
  const parsed = parseRenderArgs(process.argv.slice(2));
  if (!parsed.ok) exitWithError(parsed.message);
  const {args} = parsed;

  const studioDir = readStudioDir();
  await assertBackgroundExists(args.backgroundPath);
  const track = await loadTrackOrExit(studioDir, args.slug);
  const props = await stageMedia(track, args);

  await mkdir(OUT_DIR, {recursive: true});
  const outputBase = path.join(OUT_DIR, `${formatLocalDate(new Date())}-${track.slug}`);
  await renderVideoAndStills(props, args, outputBase);

  const sidecar = buildPublishSidecar(track);
  await writeFile(`${outputBase}.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
  console.log(`done: ${outputBase}.mp4 and ${outputBase}.json`);
}

await main();
