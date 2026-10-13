process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {copyFile, mkdir, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {getVideoMetadata, renderMedia, selectComposition} from '@remotion/renderer';
import type {ReviewDemoProps} from '../src/compositions/ReviewDemo';
import {REVIEW_DEMO_FPS, toFrameCount} from '../src/demo/reviewDemoTimeline';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(PROJECT_ROOT, 'out', 'review-demo.mp4');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const STAGED_RELATIVE_DIR = path.posix.join('media', 'review-demo');
const COMPOSITION_ID = 'ReviewDemo';
const LOGO_SOURCE = path.join(PROJECT_ROOT, 'docs', 'brand', 'nopanicpost-logo.png');
const LOGO_PUBLIC_PATH = path.join(PUBLIC_DIR, 'brand', 'nopanicpost-logo.png');
const ALLOWED_EXTENSIONS = ['.mov', '.mp4'];
const RENDER_CONCURRENCY = 2;
const FIRST_CRF = 28;
const CRF_STEP = 4;
const MAX_RERENDERS = 2;
const MAX_OUTPUT_BYTES = 45 * 1024 * 1024;

function exitWithError(message: string): never {
  console.error(`render-review-demo: ${message}`);
  process.exit(1);
}

async function assertClipFile(label: string, clipPath: string): Promise<void> {
  const isFile = await stat(clipPath).then((info) => info.isFile(), () => false);
  if (!isFile) exitWithError(`${label} recording not found: ${clipPath}`);
  const extension = path.extname(clipPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    exitWithError(`${label} recording must be .mov or .mp4, got "${extension}": ${clipPath}`);
  }
}

async function stageClip(clipPath: string, name: string): Promise<{src: string; frames: number}> {
  const fileName = `${name}${path.extname(clipPath).toLowerCase()}`;
  await copyFile(clipPath, path.join(PUBLIC_DIR, STAGED_RELATIVE_DIR, fileName));
  const stagedPath = path.join(PUBLIC_DIR, STAGED_RELATIVE_DIR, fileName);
  const metadata = await getVideoMetadata(stagedPath).catch((error: unknown) =>
    exitWithError(`cannot read ${clipPath}: ${error instanceof Error ? error.message : String(error)}`),
  );
  if (metadata.durationInSeconds === null) exitWithError(`no duration found in ${clipPath}`);
  return {
    src: path.posix.join(STAGED_RELATIVE_DIR, fileName),
    frames: toFrameCount(metadata.durationInSeconds, REVIEW_DEMO_FPS),
  };
}

async function stageInputs(macPath: string, phonePath: string | undefined): Promise<ReviewDemoProps> {
  const stagedDir = path.join(PUBLIC_DIR, STAGED_RELATIVE_DIR);
  await rm(stagedDir, {recursive: true, force: true});
  await mkdir(stagedDir, {recursive: true});
  await mkdir(path.dirname(LOGO_PUBLIC_PATH), {recursive: true});
  await copyFile(LOGO_SOURCE, LOGO_PUBLIC_PATH);

  const macClip = await stageClip(macPath, 'mac');
  const props: ReviewDemoProps = {macClipSrc: macClip.src, macClipFrames: macClip.frames};
  if (!phonePath) return props;

  const phoneClip = await stageClip(phonePath, 'phone');
  return {...props, phoneClipSrc: phoneClip.src, phoneClipFrames: phoneClip.frames};
}

async function renderWithCrf(serveUrl: string, props: ReviewDemoProps, crf: number): Promise<number> {
  const composition = await selectComposition({serveUrl, id: COMPOSITION_ID, inputProps: props});
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf,
    concurrency: RENDER_CONCURRENCY,
    inputProps: props,
    outputLocation: OUT_FILE,
    onProgress: ({progress}) => process.stdout.write(`\rrendering (crf ${crf}) ${Math.round(progress * 100)}%`),
  });
  process.stdout.write('\n');
  console.log(`duration: ${(composition.durationInFrames / composition.fps).toFixed(1)} s`);
  return (await stat(OUT_FILE)).size;
}

async function renderUnderSizeLimit(props: ReviewDemoProps): Promise<number> {
  const serveUrl = await bundle({entryPoint: path.join(PROJECT_ROOT, 'src/index.ts'), publicDir: PUBLIC_DIR});
  await mkdir(path.dirname(OUT_FILE), {recursive: true});

  let outputBytes = 0;
  for (let attempt = 0; attempt <= MAX_RERENDERS; attempt += 1) {
    outputBytes = await renderWithCrf(serveUrl, props, FIRST_CRF + attempt * CRF_STEP);
    if (outputBytes <= MAX_OUTPUT_BYTES) break;
    console.log(`${(outputBytes / 1024 / 1024).toFixed(1)} MB is over the limit, rendering again`);
  }
  return outputBytes;
}

async function main(): Promise<void> {
  const [macPath, phonePath] = process.argv.slice(2);
  if (!macPath) {
    exitWithError('usage: npx tsx scripts/render-review-demo.ts <mac-recording.mov|mp4> [phone-recording.mov|mp4]');
  }
  await assertClipFile('mac', macPath);
  if (phonePath) await assertClipFile('phone', phonePath);

  const props = await stageInputs(path.resolve(macPath), phonePath ? path.resolve(phonePath) : undefined);
  const outputBytes = await renderUnderSizeLimit(props).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    return exitWithError(`render failed (a .mov in HEVC may need re-exporting as H.264): ${detail}`);
  });

  const outputMegabytes = (outputBytes / 1024 / 1024).toFixed(1);
  console.log(`done: ${OUT_FILE} (${outputMegabytes} MB)`);
  if (outputBytes > MAX_OUTPUT_BYTES) console.warn('warning: output is still over 45 MB');
}

await main();
