import {hasHealthClaim} from './healthClaims';
import {parseFailure, parseSuccess, type ParseResult} from './parseResult';
import {parseIsoDateTimeMs} from '../time/ljubljanaTime';
import {
  EPISODE_FORMATS,
  LABEL_DECISIONS,
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  type EpisodeFormat,
  type LabelDecision,
} from '../store/planTypes';

/** "The" for a whole-plan import, "That" for the single field a person just typed. */
export type MessageVoice = 'The' | 'That';

export type FieldContext = {field: string; voice: MessageVoice};

const MAX_TEXT_LENGTH = 2200;
const TRACK_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOUR_PATTERN = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/i;
const SMOKRATES_PATTERN = /smokrates/i;

function parseText(value: unknown, context: FieldContext): ParseResult<string> {
  if (typeof value !== 'string' || value.trim() === '') {
    return parseFailure(context.field, `${context.field} must be some text.`);
  }
  if (value.length > MAX_TEXT_LENGTH) {
    return parseFailure(context.field, `${context.field} is longer than ${MAX_TEXT_LENGTH} characters.`);
  }
  return parseSuccess(value.trim());
}

function parseTextWithoutHealthClaim(value: unknown, context: FieldContext, noun: string): ParseResult<string> {
  const text = parseText(value, context);
  if (!text.ok) return text;
  if (hasHealthClaim(text.value)) {
    return parseFailure(context.field, `${context.voice} ${noun} makes a health claim.`);
  }
  return text;
}

export function parseCaption(value: unknown, context: FieldContext): ParseResult<string> {
  return parseTextWithoutHealthClaim(value, context, 'caption');
}

export function parseClaim(value: unknown, context: FieldContext): ParseResult<string> {
  return parseTextWithoutHealthClaim(value, context, 'claim');
}

/** The Grok prompt may not name the artist, hold a hex colour code, or make a health claim. */
export function parseGroksPrompt(value: unknown, context: FieldContext): ParseResult<string> {
  const prompt = parseText(value, context);
  if (!prompt.ok) return prompt;
  if (SMOKRATES_PATTERN.test(prompt.value)) return parseFailure(context.field, 'The Grok prompt names SMOKRATES.');
  if (HEX_COLOUR_PATTERN.test(prompt.value)) {
    return parseFailure(context.field, 'The Grok prompt holds a hex colour code. Name the colour in words.');
  }
  if (hasHealthClaim(prompt.value)) return parseFailure(context.field, 'The Grok prompt makes a health claim.');
  return prompt;
}

export function parseTrackSlug(value: unknown, context: FieldContext): ParseResult<string> {
  if (typeof value !== 'string' || !TRACK_SLUG_PATTERN.test(value)) {
    return parseFailure(context.field, `${context.field} must be a slug: lowercase letters, digits and dashes.`);
  }
  return parseSuccess(value);
}

export function parseNight(value: unknown, context: FieldContext): ParseResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 7) {
    return parseFailure(context.field, `${context.field} must be a whole number from 1 to 7.`);
  }
  return parseSuccess(value);
}

export function parseStartSecond(value: unknown, context: FieldContext): ParseResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return parseFailure(context.field, `${context.field} must be a number of seconds, 0 or more.`);
  }
  return parseSuccess(value);
}

export function parseDurationSeconds(value: unknown, context: FieldContext): ParseResult<number> {
  const isInRange = typeof value === 'number' && value >= MIN_DURATION_SECONDS && value <= MAX_DURATION_SECONDS;
  if (!isInRange) {
    return parseFailure(
      context.field,
      `${context.field} must be from ${MIN_DURATION_SECONDS} to ${MAX_DURATION_SECONDS} seconds.`,
    );
  }
  return parseSuccess(value);
}

export function parsePublishAtMs(value: unknown, context: FieldContext): ParseResult<number> {
  const epochMs = typeof value === 'string' ? parseIsoDateTimeMs(value) : undefined;
  if (epochMs === undefined) {
    return parseFailure(context.field, `${context.field} must be a date and time with an offset, like 2026-10-27T18:00:00+01:00.`);
  }
  return parseSuccess(epochMs);
}

export function parseFormat(value: unknown, context: FieldContext): ParseResult<EpisodeFormat> {
  const format = EPISODE_FORMATS.find((candidate) => candidate === value);
  if (format === undefined) {
    return parseFailure(context.field, `${context.field} must be one of: ${EPISODE_FORMATS.join(', ')}.`);
  }
  return parseSuccess(format);
}

export function parseLabelDecision(value: unknown, context: FieldContext): ParseResult<LabelDecision> {
  const decision = LABEL_DECISIONS.find((candidate) => candidate === value);
  if (decision === undefined) {
    return parseFailure(context.field, `${context.field} must be label_on or label_off.`);
  }
  return parseSuccess(decision);
}
