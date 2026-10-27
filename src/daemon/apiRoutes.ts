import type {IncomingMessage, ServerResponse} from 'node:http';
import type {DatabaseSync} from 'node:sqlite';
import {parseEpisodeUpdate} from '../api/parseEpisodeInput';
import {parsePlanImport, parseWeekStart} from '../api/parsePlanImport';
import type {ParseFailure} from '../api/parseResult';
import {sendError, sendJson} from './httpResponses';
import {readJsonBody} from './readJsonBody';
import {
  approveEpisode,
  approveWeek,
  getPlan,
  importPlan,
  skipEpisode,
  updateEpisode,
} from '../store/planStore';
import {listPublishesForWeek} from '../store/publishList';
import {readStudioHealth} from '../store/studioHealth';

export type StudioDeps = {
  db: DatabaseSync;
  nowMs: () => number;
  newId: () => string;
  outDir: string;
  webDir: string;
};

type RouteContext = {
  deps: StudioDeps;
  req: IncomingMessage;
  res: ServerResponse;
  param: string;
  query: URLSearchParams;
};

type Route = {
  method: string;
  pattern: RegExp;
  hasEpisodeId?: true;
  handle: (context: RouteContext) => Promise<void> | void;
};

const EPISODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function sendInvalidInput(res: ServerResponse, failure: ParseFailure): void {
  sendError(res, 400, {code: 'invalid_input', field: failure.field, message: failure.message});
}

function sendNoEpisode(res: ServerResponse): void {
  sendError(res, 404, {code: 'no_episode', message: 'No such episode.'});
}

function sendNoPlan(res: ServerResponse): void {
  sendError(res, 404, {code: 'no_plan', message: 'No plan for this week yet.'});
}

/** Reads the JSON body a route needs, or answers the failure itself and returns undefined. */
async function readRequiredBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  const body = await readJsonBody(req);
  if (body.kind === 'json') return body.value;
  if (body.kind === 'too-large') {
    res.setHeader('Connection', 'close');
    sendError(res, 413, {code: 'too_large', message: 'That request is too big.'});
  } else if (body.kind === 'wrong-content-type') {
    sendError(res, 415, {code: 'wrong_content_type', message: 'Send the body as application/json.'});
  } else if (body.kind === 'bad-json') {
    sendError(res, 400, {code: 'bad_json', message: 'The body is not valid JSON.'});
  } else {
    sendError(res, 400, {code: 'invalid_input', field: 'body', message: 'Send a JSON body.'});
  }
  return undefined;
}

function handleHealth({deps, res}: RouteContext): void {
  sendJson(res, 200, readStudioHealth(deps.db));
}

async function handleImportPlan({deps, req, res}: RouteContext): Promise<void> {
  const body = await readRequiredBody(req, res);
  if (body === undefined) return;
  const parsed = parsePlanImport(body);
  if (!parsed.ok) return sendInvalidInput(res, parsed);

  const result = importPlan(deps.db, {plan: parsed.value, nowMs: deps.nowMs(), newId: deps.newId});
  if (result.kind === 'imported') return sendJson(res, 201, result.plan);
  if (result.kind === 'work-in-progress') {
    return sendError(res, 409, {
      code: 'work_in_progress',
      message: 'This week already has work in progress. Send replace to overwrite it.',
    });
  }
  sendError(res, 409, {code: 'has_publishes', message: 'This week has sent nights and cannot be replaced.'});
}

function handleGetPlan({deps, res, param}: RouteContext): void {
  const weekStart = parseWeekStart(param);
  if (!weekStart.ok) return sendInvalidInput(res, weekStart);
  const result = getPlan(deps.db, weekStart.value);
  if (result.kind === 'found') return sendJson(res, 200, result.plan);
  sendNoPlan(res);
}

function handleListPublishes({deps, res, query}: RouteContext): void {
  const weekStart = parseWeekStart(query.get('weekStart'));
  if (!weekStart.ok) return sendInvalidInput(res, weekStart);
  sendJson(res, 200, listPublishesForWeek(deps.db, weekStart.value));
}

function handleApproveWeek({deps, res, param}: RouteContext): void {
  const weekStart = parseWeekStart(param);
  if (!weekStart.ok) return sendInvalidInput(res, weekStart);
  const result = approveWeek(deps.db, {weekStart: weekStart.value});
  if (result.kind === 'approved') return sendJson(res, 200, result.plan);
  if (result.kind === 'no-plan') return sendNoPlan(res);
  if (result.kind === 'not-new') {
    return sendError(res, 409, {code: 'not_new', message: `Night ${result.night} is not new. Change it or skip it.`});
  }
  sendError(res, 409, {code: 'not_rendered', message: `Night ${result.night} is not rendered. Render it or skip it.`});
}

async function handleUpdateEpisode({deps, req, res, param}: RouteContext): Promise<void> {
  const body = await readRequiredBody(req, res);
  if (body === undefined) return;
  const parsed = parseEpisodeUpdate(body);
  if (!parsed.ok) return sendInvalidInput(res, parsed);

  const result = updateEpisode(deps.db, {episodeId: param, update: parsed.value, nowMs: deps.nowMs()});
  if (result.kind === 'updated') return sendJson(res, 200, result.episode);
  if (result.kind === 'not-found') return sendNoEpisode(res);
  if (result.kind === 'time-in-past') {
    return sendError(res, 422, {code: 'time_in_past', field: 'publishAt', message: 'That time is in the past.'});
  }
  sendError(res, 409, {code: 'already_sent', message: 'This night is already with TikTok and cannot be changed.'});
}

function handleApproveEpisode({deps, res, param}: RouteContext): void {
  const result = approveEpisode(deps.db, {episodeId: param});
  if (result.kind === 'approved') return sendJson(res, 200, result.episode);
  if (result.kind === 'not-found') return sendNoEpisode(res);
  if (result.kind === 'is-skipped') {
    return sendError(res, 409, {code: 'is_skipped', message: 'This night is skipped. It cannot be approved.'});
  }
  if (result.kind === 'not-new') {
    return sendError(res, 409, {code: 'not_new', message: `Night ${result.night} is not new. Change it or skip it.`});
  }
  sendError(res, 409, {code: 'not_rendered', message: 'Render this night before you approve it.'});
}

function handleSkipEpisode({deps, res, param}: RouteContext): void {
  const result = skipEpisode(deps.db, {episodeId: param});
  if (result.kind === 'skipped') return sendJson(res, 200, result.episode);
  if (result.kind === 'not-found') return sendNoEpisode(res);
  sendError(res, 409, {code: 'already_sent', message: 'This night is already with TikTok and cannot be skipped.'});
}

const ROUTES: readonly Route[] = [
  {method: 'GET', pattern: /^\/api\/health$/, handle: handleHealth},
  {method: 'POST', pattern: /^\/api\/plans$/, handle: handleImportPlan},
  {method: 'GET', pattern: /^\/api\/publishes$/, handle: handleListPublishes},
  {method: 'GET', pattern: /^\/api\/plans\/([^/]+)$/, handle: handleGetPlan},
  {method: 'POST', pattern: /^\/api\/plans\/([^/]+)\/approve$/, handle: handleApproveWeek},
  {method: 'PATCH', pattern: /^\/api\/episodes\/([^/]+)$/, hasEpisodeId: true, handle: handleUpdateEpisode},
  {method: 'POST', pattern: /^\/api\/episodes\/([^/]+)\/approve$/, hasEpisodeId: true, handle: handleApproveEpisode},
  {method: 'POST', pattern: /^\/api\/episodes\/([^/]+)\/skip$/, hasEpisodeId: true, handle: handleSkipEpisode},
];

function decodeParam(rawParam: string | undefined): string {
  if (rawParam === undefined) return '';
  try {
    return decodeURIComponent(rawParam);
  } catch {
    return '';
  }
}

/** Routes one /api request. Answers 404 for an unknown path and 405 for a known path with another method. */
export async function handleApiRequest(options: {
  deps: StudioDeps;
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
}): Promise<void> {
  const {deps, req, res, pathname} = options;
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
  let isKnownPath = false;
  for (const route of ROUTES) {
    const match = route.pattern.exec(pathname);
    if (match === null) continue;
    isKnownPath = true;
    if (route.method !== req.method) continue;

    const param = decodeParam(match[1]);
    if (route.hasEpisodeId === true && !EPISODE_ID_PATTERN.test(param)) return sendNoEpisode(res);
    await route.handle({deps, req, res, param, query});
    return;
  }
  if (isKnownPath) return sendError(res, 405, {code: 'method_not_allowed', message: 'That method is not allowed here.'});
  sendError(res, 404, {code: 'not_found', message: 'Nothing here.'});
}
