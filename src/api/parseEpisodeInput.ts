import {
  parseCaption,
  parseClaim,
  parseDurationSeconds,
  parseFormat,
  parseGroksPrompt,
  parseLabelDecision,
  parseNight,
  parsePublishAtMs,
  parseStartSecond,
  parseTrackSlug,
  type FieldContext,
  type MessageVoice,
} from './parseEpisodeFields';
import {isRecord, mapParseResult, parseFailure, parseSuccess, type ParseResult} from './parseResult';
import type {EpisodeInput, EpisodeUpdate} from '../store/planTypes';

const INPUT_KEYS = [
  'night',
  'format',
  'trackSlug',
  'startSecond',
  'durationSeconds',
  'caption',
  'claim',
  'publishAt',
  'labelDecision',
  'groksPrompt',
];

function findUnknownKey(body: Record<string, unknown>, knownKeys: readonly string[]): string | undefined {
  return Object.keys(body).find((key) => !knownKeys.includes(key));
}

/** Parses one night of a plan import. `path` names the night in errors, such as episodes[2]. */
export function parseEpisodeInput(body: unknown, path: string): ParseResult<EpisodeInput> {
  if (!isRecord(body)) return parseFailure(path, `${path} must be an object.`);
  const unknownKey = findUnknownKey(body, INPUT_KEYS);
  if (unknownKey !== undefined) return parseFailure(`${path}.${unknownKey}`, `Unknown field ${unknownKey}.`);

  const at = (key: string) => ({field: `${path}.${key}`, voice: 'The' as MessageVoice});
  const night = parseNight(body.night, at('night'));
  if (!night.ok) return night;
  const format = parseFormat(body.format, at('format'));
  if (!format.ok) return format;
  const trackSlug = parseTrackSlug(body.trackSlug, at('trackSlug'));
  if (!trackSlug.ok) return trackSlug;
  const startSecond = parseStartSecond(body.startSecond, at('startSecond'));
  if (!startSecond.ok) return startSecond;
  const durationSeconds = parseDurationSeconds(body.durationSeconds, at('durationSeconds'));
  if (!durationSeconds.ok) return durationSeconds;
  const caption = parseCaption(body.caption, at('caption'));
  if (!caption.ok) return caption;
  const claim = parseClaim(body.claim, at('claim'));
  if (!claim.ok) return claim;
  const publishAtMs = parsePublishAtMs(body.publishAt, at('publishAt'));
  if (!publishAtMs.ok) return publishAtMs;
  const labelDecision = parseLabelDecision(body.labelDecision, at('labelDecision'));
  if (!labelDecision.ok) return labelDecision;

  const episode: EpisodeInput = {
    night: night.value,
    format: format.value,
    trackSlug: trackSlug.value,
    startSecond: startSecond.value,
    durationSeconds: durationSeconds.value,
    caption: caption.value,
    claim: claim.value,
    publishAtMs: publishAtMs.value,
    labelDecision: labelDecision.value,
  };
  if (body.groksPrompt === undefined) return parseSuccess(episode);

  if (format.value !== 'scene') {
    return parseFailure(`${path}.groksPrompt`, 'A Grok prompt belongs to the scene format only.');
  }
  const groksPrompt = parseGroksPrompt(body.groksPrompt, at('groksPrompt'));
  if (!groksPrompt.ok) return groksPrompt;
  return parseSuccess({...episode, groksPrompt: groksPrompt.value});
}

type UpdateFieldParser = (value: unknown, context: FieldContext) => ParseResult<EpisodeUpdate>;

const UPDATE_PARSERS: Readonly<Record<string, UpdateFieldParser>> = {
  publishAt: (value, context) => mapParseResult(parsePublishAtMs(value, context), (publishAtMs) => ({publishAtMs})),
  caption: (value, context) => mapParseResult(parseCaption(value, context), (caption) => ({caption})),
  trackSlug: (value, context) => mapParseResult(parseTrackSlug(value, context), (trackSlug) => ({trackSlug})),
  startSecond: (value, context) => mapParseResult(parseStartSecond(value, context), (startSecond) => ({startSecond})),
  durationSeconds: (value, context) =>
    mapParseResult(parseDurationSeconds(value, context), (durationSeconds) => ({durationSeconds})),
  format: (value, context) => mapParseResult(parseFormat(value, context), (format) => ({format})),
  labelDecision: (value, context) =>
    mapParseResult(parseLabelDecision(value, context), (labelDecision) => ({labelDecision})),
};

/** Parses the body of episode.update. At least one known field is required; unknown fields are refused. */
export function parseEpisodeUpdate(body: unknown): ParseResult<EpisodeUpdate> {
  if (!isRecord(body)) return parseFailure('body', 'Send an object with the fields to change.');
  const unknownKey = findUnknownKey(body, Object.keys(UPDATE_PARSERS));
  if (unknownKey !== undefined) return parseFailure(unknownKey, `Unknown field ${unknownKey}.`);

  let update: EpisodeUpdate = {};
  for (const [key, parseField] of Object.entries(UPDATE_PARSERS)) {
    const value = body[key];
    if (value === undefined) continue;
    const parsed = parseField(value, {field: key, voice: 'That'});
    if (!parsed.ok) return parsed;
    update = {...update, ...parsed.value};
  }
  if (Object.keys(update).length === 0) return parseFailure('body', 'Send at least one field to change.');
  return parseSuccess(update);
}
