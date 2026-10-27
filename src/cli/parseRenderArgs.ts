import {LABEL_DECISIONS, type LabelDecision} from '../store/planTypes';

export type RenderArgs = {
  slug: string;
  audioStartSeconds: number;
  backgroundPath?: string;
  shouldRenderStills: boolean;
  labelDecision: LabelDecision;
};

export type ParseRenderArgsResult =
  | {ok: true; args: RenderArgs}
  | {ok: false; message: string};

export const RENDER_USAGE =
  'usage: render-track <slug> --label label_on|label_off [--start <seconds>] [--background <path>] [--stills]';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(message: string): ParseRenderArgsResult {
  return {ok: false, message: `${message}\n${RENDER_USAGE}`};
}

function parseLabelDecision(rawValue: string | undefined): LabelDecision | undefined {
  return LABEL_DECISIONS.find((decision) => decision === rawValue);
}

function parseStartSeconds(rawValue: string | undefined): number | undefined {
  if (rawValue === undefined || rawValue.trim() === '') return undefined;
  const seconds = Number(rawValue);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function parseRenderArgs(argv: readonly string[]): ParseRenderArgsResult {
  let slug: string | undefined;
  let audioStartSeconds = 0;
  let backgroundPath: string | undefined;
  let shouldRenderStills = false;
  let labelDecision: LabelDecision | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument === '--stills') {
      shouldRenderStills = true;
    } else if (argument === '--start') {
      index += 1;
      const seconds = parseStartSeconds(argv[index]);
      if (seconds === undefined) return fail('--start needs a number of seconds >= 0');
      audioStartSeconds = seconds;
    } else if (argument === '--label') {
      index += 1;
      labelDecision = parseLabelDecision(argv[index]);
      if (labelDecision === undefined) return fail('--label needs label_on or label_off');
    } else if (argument === '--background') {
      index += 1;
      backgroundPath = argv[index];
      if (!backgroundPath) return fail('--background needs a file path');
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
  if (labelDecision === undefined) {
    return fail('missing --label: say label_on only if a frame is photoreal, else label_off');
  }
  return {ok: true, args: {slug, audioStartSeconds, backgroundPath, shouldRenderStills, labelDecision}};
}
