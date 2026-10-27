export type RenderFormat = 'reel' | 'card';

export type RenderArgs = {
  slug: string;
  format: RenderFormat;
  audioStartSeconds: number;
  backgroundPath?: string;
  introPath?: string;
  loopPath?: string;
  stillPath?: string;
  durationSeconds?: number;
  shouldRenderStills: boolean;
  shouldSkipVideo: boolean;
  shouldDrawSafeZone: boolean;
};

export type ParseRenderArgsResult =
  | {ok: true; args: RenderArgs}
  | {ok: false; message: string};

export const RENDER_USAGE =
  'usage: render-track <slug> [--format reel|card] [--start <seconds>] [--duration <seconds>] ' +
  '[--intro <clip>] [--loop <clip>] [--still <png>] [--background <clip>, card only] [--stills [--stills-only] [--safe-zone]]';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type PathOption = 'backgroundPath' | 'introPath' | 'loopPath' | 'stillPath';

const PATH_OPTIONS: Record<string, PathOption> = {
  '--background': 'backgroundPath',
  '--intro': 'introPath',
  '--loop': 'loopPath',
  '--still': 'stillPath',
};

const REEL_ONLY_OPTIONS: PathOption[] = ['introPath', 'loopPath', 'stillPath'];

function fail(message: string): ParseRenderArgsResult {
  return {ok: false, message: `${message}\n${RENDER_USAGE}`};
}

function parseSeconds(rawValue: string | undefined, minimumSeconds: number): number | undefined {
  if (rawValue === undefined || rawValue.trim() === '') return undefined;
  const seconds = Number(rawValue);
  return Number.isFinite(seconds) && seconds >= minimumSeconds ? seconds : undefined;
}

function parseFormat(rawValue: string | undefined): RenderFormat | undefined {
  return rawValue === 'reel' || rawValue === 'card' ? rawValue : undefined;
}

export function parseRenderArgs(argv: readonly string[]): ParseRenderArgsResult {
  let slug: string | undefined;
  let format: RenderFormat = 'reel';
  let audioStartSeconds = 0;
  let durationSeconds: number | undefined;
  let shouldRenderStills = false;
  let shouldSkipVideo = false;
  let shouldDrawSafeZone = false;
  const paths: Partial<Record<PathOption, string>> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    const pathOption = PATH_OPTIONS[argument];
    if (argument === '--stills') {
      shouldRenderStills = true;
    } else if (argument === '--stills-only') {
      shouldRenderStills = true;
      shouldSkipVideo = true;
    } else if (argument === '--safe-zone') {
      shouldDrawSafeZone = true;
    } else if (argument === '--format') {
      index += 1;
      const parsedFormat = parseFormat(argv[index]);
      if (!parsedFormat) return fail('--format must be reel or card');
      format = parsedFormat;
    } else if (argument === '--start') {
      index += 1;
      const seconds = parseSeconds(argv[index], 0);
      if (seconds === undefined) return fail('--start needs a number of seconds >= 0');
      audioStartSeconds = seconds;
    } else if (argument === '--duration') {
      index += 1;
      const seconds = parseSeconds(argv[index], 1);
      if (seconds === undefined) return fail('--duration needs a number of seconds >= 1');
      durationSeconds = seconds;
    } else if (pathOption) {
      index += 1;
      const rawPath = argv[index];
      if (!rawPath || rawPath.startsWith('--')) return fail(`${argument} needs a file path`);
      paths[pathOption] = rawPath;
    } else if (argument.startsWith('--')) {
      return fail(`unknown option ${argument}`);
    } else if (slug === undefined) {
      slug = argument;
    } else {
      return fail(`unexpected extra argument ${argument}`);
    }
  }

  if (slug === undefined) return fail('missing <slug>');
  if (!SLUG_PATTERN.test(slug)) return fail(`invalid slug "${slug}": use lowercase letters, digits and dashes`);
  if (format === 'reel' && paths.backgroundPath) return fail('--background is for --format card; use --intro and --loop for a reel');
  if (format === 'card' && REEL_ONLY_OPTIONS.some((option) => paths[option])) {
    return fail('--intro, --loop and --still are for --format reel; use --background for a card');
  }
  if (format === 'card' && durationSeconds !== undefined) return fail('--duration is for --format reel');
  if (shouldDrawSafeZone && !shouldRenderStills) return fail('--safe-zone only draws on --stills');

  return {
    ok: true,
    args: {slug, format, audioStartSeconds, durationSeconds, shouldRenderStills, shouldSkipVideo, shouldDrawSafeZone, ...paths},
  };
}
