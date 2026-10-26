import {parseEpisodeInput} from './parseEpisodeInput';
import {isRecord, parseFailure, parseSuccess, type ParseResult} from './parseResult';
import {isMondayDate} from '../time/ljubljanaTime';
import {MAX_EPISODES_PER_WEEK, type EpisodeInput, type PlanImport} from '../store/planTypes';

const PLAN_IMPORT_KEYS = ['weekStart', 'replace', 'episodes'];

/** Parses a weekStart from a path or a body: a real Monday, written YYYY-MM-DD. */
export function parseWeekStart(value: unknown): ParseResult<string> {
  if (typeof value !== 'string' || !isMondayDate(value)) {
    return parseFailure('weekStart', 'weekStart must be the Monday of the week, written YYYY-MM-DD.');
  }
  return parseSuccess(value);
}

function parseEpisodes(value: unknown): ParseResult<EpisodeInput[]> {
  if (!Array.isArray(value)) return parseFailure('episodes', 'episodes must be a list of up to 7 nights.');
  if (value.length > MAX_EPISODES_PER_WEEK) {
    return parseFailure('episodes', `A week has at most ${MAX_EPISODES_PER_WEEK} nights.`);
  }
  const episodes: EpisodeInput[] = [];
  for (const [index, rawEpisode] of value.entries()) {
    const parsed = parseEpisodeInput(rawEpisode, `episodes[${index}]`);
    if (!parsed.ok) return parsed;
    if (episodes.some((episode) => episode.night === parsed.value.night)) {
      return parseFailure(`episodes[${index}].night`, `Night ${parsed.value.night} appears twice.`);
    }
    episodes.push(parsed.value);
  }
  return parseSuccess(episodes);
}

/** Parses the body of plan.import. Nothing is written unless every night passes. */
export function parsePlanImport(body: unknown): ParseResult<PlanImport> {
  if (!isRecord(body)) return parseFailure('body', 'Send an object with weekStart and episodes.');
  const unknownKey = Object.keys(body).find((key) => !PLAN_IMPORT_KEYS.includes(key));
  if (unknownKey !== undefined) return parseFailure(unknownKey, `Unknown field ${unknownKey}.`);

  const weekStart = parseWeekStart(body.weekStart);
  if (!weekStart.ok) return weekStart;
  if (body.replace !== undefined && typeof body.replace !== 'boolean') {
    return parseFailure('replace', 'replace must be true or false.');
  }
  const episodes = parseEpisodes(body.episodes);
  if (!episodes.ok) return episodes;
  return parseSuccess({weekStart: weekStart.value, shouldReplace: body.replace === true, episodes: episodes.value});
}
