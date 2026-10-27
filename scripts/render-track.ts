process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {copyFile, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {findTrackDirBySlug, loadTrack, type Track} from '../src/assets/smokStudio';
import {parseRenderArgs, type RenderArgs} from '../src/cli/parseRenderArgs';
import {pickShortLine} from '../src/cli/shortLine';
import {buildPublishSidecar, toShortLine} from '../src/publish/buildCaption';
import {getStillFrames} from '../src/compositions/reel/reelTimeline';
import type {TrackReelProps} from '../src/compositions/reel/TrackReel';
import type {TrackCardProps} from '../src/compositions/TrackCard';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'out');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const RENDER_CONCURRENCY = 2;
const CARD_STILL_FRAMES = [0, 300];
const FPS = 30;
const REEL_VIDEO_BITRATE = '12M';
const REEL_AUDIO_BITRATE = '320k';

type RenderPlan = {
  compositionId: 'TrackReel' | 'TrackCard';
  videoProps: TrackReelProps | TrackCardProps;
  stillProps: TrackReelProps | TrackCardProps;
  stills: Array<{frame: number; suffix: string}>;
};

type StagedMedia = {stagedDir: string; relativeDir: string; coverSrc: string; audioSrc: string};

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

async function assertFilesExist(files: Array<{flag: string; filePath: string | undefined}>): Promise<void> {
  for (const {flag, filePath} of files) {
    if (!filePath) continue;
    const isFile = await stat(filePath).then((info) => info.isFile(), () => false);
    if (!isFile) exitWithError(`${flag} file not found: ${filePath}`);
  }
}

async function stageCoverAndAudio(track: Track): Promise<StagedMedia> {
  const relativeDir = path.posix.join('media', track.slug);
  const stagedDir = path.join(PUBLIC_DIR, relativeDir);
  await rm(stagedDir, {recursive: true, force: true});
  await mkdir(stagedDir, {recursive: true});

  const audioName = `audio${path.extname(track.audioPath).toLowerCase()}`;
  await copyFile(track.coverPath, path.join(stagedDir, 'cover.png'));
  await copyFile(track.audioPath, path.join(stagedDir, audioName));
  return {
    stagedDir,
    relativeDir,
    coverSrc: path.posix.join(relativeDir, 'cover.png'),
    audioSrc: path.posix.join(relativeDir, audioName),
  };
}

async function stageOptionalFile(staged: StagedMedia, sourcePath: string | undefined, baseName: string): Promise<string | undefined> {
  if (!sourcePath) return undefined;
  const fileName = `${baseName}${path.extname(sourcePath).toLowerCase()}`;
  await copyFile(sourcePath, path.join(staged.stagedDir, fileName));
  return path.posix.join(staged.relativeDir, fileName);
}

async function readShortLine(track: Track): Promise<string> {
  const songJson: unknown = JSON.parse(await readFile(path.join(track.trackDir, 'song.json'), 'utf8'));
  return pickShortLine(songJson, track.title);
}

async function planCard(track: Track, args: RenderArgs): Promise<RenderPlan> {
  const staged = await stageCoverAndAudio(track);
  const backgroundVideoSrc = await stageOptionalFile(staged, args.backgroundPath, 'background');
  const props: TrackCardProps = {
    title: track.title,
    theme: toShortLine(track.theme),
    coverSrc: staged.coverSrc,
    audioSrc: staged.audioSrc,
    audioStartSeconds: args.audioStartSeconds,
    backgroundVideoSrc,
  };
  return {
    compositionId: 'TrackCard',
    videoProps: props,
    stillProps: props,
    stills: CARD_STILL_FRAMES.map((frame) => ({frame, suffix: `-frame${frame}`})),
  };
}

async function planReel(track: Track, args: RenderArgs): Promise<RenderPlan> {
  const staged = await stageCoverAndAudio(track);
  const props: TrackReelProps = {
    shortLine: await readShortLine(track),
    coverSrc: staged.coverSrc,
    audioSrc: staged.audioSrc,
    audioStartSeconds: args.audioStartSeconds,
    durationSeconds: args.durationSeconds,
    introClipSrc: await stageOptionalFile(staged, args.introPath, 'intro'),
    loopClipSrc: await stageOptionalFile(staged, args.loopPath, 'loop'),
    stillSrc: await stageOptionalFile(staged, args.stillPath, 'still'),
  };
  const totalFrames = Math.round((args.durationSeconds ?? 16) * FPS);
  const safeSuffix = args.shouldDrawSafeZone ? '-safe' : '';
  return {
    compositionId: 'TrackReel',
    videoProps: props,
    stillProps: {...props, shouldDrawSafeZone: args.shouldDrawSafeZone},
    stills: getStillFrames(totalFrames, FPS).map((frame) => ({frame, suffix: `-still-${frame / FPS}s${safeSuffix}`})),
  };
}

function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

async function renderPlan(plan: RenderPlan, args: RenderArgs, outputBase: string): Promise<void> {
  const serveUrl = await bundle({
    entryPoint: path.join(PROJECT_ROOT, 'src/index.ts'),
    publicDir: PUBLIC_DIR,
  });
  if (!args.shouldSkipVideo) {
    const composition = await selectComposition({serveUrl, id: plan.compositionId, inputProps: plan.videoProps});
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      ...(plan.compositionId === 'TrackReel'
        ? {videoBitrate: REEL_VIDEO_BITRATE, audioBitrate: REEL_AUDIO_BITRATE}
        : {}),
      concurrency: RENDER_CONCURRENCY,
      inputProps: plan.videoProps,
      outputLocation: `${outputBase}.mp4`,
      onProgress: ({progress}) => process.stdout.write(`\rrendering ${Math.round(progress * 100)}%`),
    });
    process.stdout.write('\n');
  }
  if (!args.shouldRenderStills) return;

  const stillComposition = await selectComposition({serveUrl, id: plan.compositionId, inputProps: plan.stillProps});
  for (const {frame, suffix} of plan.stills) {
    const output = `${outputBase}${suffix}.png`;
    await renderStill({composition: stillComposition, serveUrl, frame, inputProps: plan.stillProps, output});
    console.log(`still: ${output}`);
  }
}

async function main(): Promise<void> {
  const parsed = parseRenderArgs(process.argv.slice(2));
  if (!parsed.ok) exitWithError(parsed.message);
  const {args} = parsed;

  const studioDir = readStudioDir();
  await assertFilesExist([
    {flag: '--background', filePath: args.backgroundPath},
    {flag: '--intro', filePath: args.introPath},
    {flag: '--loop', filePath: args.loopPath},
    {flag: '--still', filePath: args.stillPath},
  ]);
  const track = await loadTrackOrExit(studioDir, args.slug);
  const plan = args.format === 'reel' ? await planReel(track, args) : await planCard(track, args);

  await mkdir(OUT_DIR, {recursive: true});
  const outputBase = path.join(OUT_DIR, `${formatLocalDate(new Date())}-${track.slug}`);
  await renderPlan(plan, args, outputBase);
  if (args.shouldSkipVideo) return;

  const sidecar = buildPublishSidecar(track);
  await writeFile(`${outputBase}.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
  console.log(`done: ${outputBase}.mp4 and ${outputBase}.json`);
}

await main();
