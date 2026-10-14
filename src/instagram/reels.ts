import {
  REQUEST_TIMEOUT_MS,
  failure,
  graphUrl,
  isNonEmptyString,
  isRecord,
  readGraphBody,
  readGraphError,
  readJsonBody,
  type FetchFn,
  type InstagramResult,
} from './types';

const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_MAX_WAIT_MS = 5 * 60 * 1000;

function bearerHeaders(accessToken: string): Record<string, string> {
  return {Authorization: `Bearer ${accessToken}`};
}

/** graph.instagram.com ignores a JSON body on these POSTs, so the fields go form-encoded. */
function postForm(accessToken: string, fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: {...bearerHeaders(accessToken), 'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

function getWithBearer(accessToken: string): RequestInit {
  return {headers: bearerHeaders(accessToken), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)};
}

export async function fetchAccount(
  input: {accessToken: string},
  fetchFn: FetchFn,
): Promise<InstagramResult<{userId: string; username: string}>> {
  const operation = 'fetch-account';
  const response = await fetchFn(graphUrl('me?fields=user_id,username'), getWithBearer(input.accessToken));
  const body = await readGraphBody(operation, response);
  if (!body.ok) return body;
  const {user_id: userId, username} = body.value;
  if (!isNonEmptyString(userId) || !isNonEmptyString(username)) {
    return failure(operation, 'invalid-response', 'me response without user_id and username');
  }
  return {ok: true, value: {userId, username}};
}

/** Creates a resumable REELS container. The returned uri takes the video bytes next. */
export async function createReelContainer(
  input: {accessToken: string; userId: string; caption: string},
  fetchFn: FetchFn,
): Promise<InstagramResult<{containerId: string; uploadUri: string}>> {
  const operation = 'create-reel-container';
  const response = await fetchFn(
    graphUrl(`${encodeURIComponent(input.userId)}/media`),
    postForm(input.accessToken, {
      media_type: 'REELS',
      upload_type: 'resumable',
      caption: input.caption,
      share_to_feed: 'true',
    }),
  );
  const body = await readGraphBody(operation, response);
  if (!body.ok) return body;
  const {id, uri} = body.value;
  if (!isNonEmptyString(id) || !isNonEmptyString(uri)) {
    return failure(operation, 'invalid-response', 'container response without id and uri');
  }
  return {ok: true, value: {containerId: id, uploadUri: uri}};
}

/** Sends the whole video in one request to the resumable upload uri. */
export async function uploadReelBytes(
  input: {accessToken: string; uploadUri: string; videoBytes: Uint8Array<ArrayBuffer>; containerId: string},
  fetchFn: FetchFn,
): Promise<InstagramResult<null>> {
  const operation = 'upload-reel-bytes';
  const size = input.videoBytes.byteLength;
  if (size === 0) return failure(operation, 'empty-video', 'the video file is empty');
  const containerNote = `(container ${input.containerId})`;

  const response = await fetchFn(input.uploadUri, {
    method: 'POST',
    headers: {Authorization: `OAuth ${input.accessToken}`, offset: '0', file_size: String(size)},
    body: input.videoBytes,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  const body = await readJsonBody(response);
  if (!isRecord(body)) return failure(operation, 'invalid-response', `HTTP ${response.status} with a non-JSON body ${containerNote}`);
  if (body.success === true) return {ok: true, value: null};

  const graphError = readGraphError(operation, body);
  if (graphError) return failure(operation, graphError.code, `${graphError.detail} ${containerNote}`);
  return failure(operation, 'upload-rejected', `HTTP ${response.status} without success ${containerNote}`);
}

export type ContainerStatus = {statusCode: string; status?: string};

export type WaitOptions = {
  pollIntervalMs?: number;
  maxWaitMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
};

async function fetchContainerStatus(
  input: {accessToken: string; containerId: string},
  fetchFn: FetchFn,
): Promise<InstagramResult<ContainerStatus>> {
  const operation = 'fetch-container-status';
  const url = graphUrl(`${encodeURIComponent(input.containerId)}?fields=status_code,status`);
  const response = await fetchFn(url, getWithBearer(input.accessToken));
  const body = await readGraphBody(operation, response);
  if (!body.ok) return body;
  const {status_code: statusCode, status} = body.value;
  if (!isNonEmptyString(statusCode)) return failure(operation, 'invalid-response', 'status response without status_code');
  return {ok: true, value: typeof status === 'string' ? {statusCode, status} : {statusCode}};
}

function sleepForMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until the container is FINISHED. Fails on ERROR, EXPIRED or when maxWaitMs passes. */
export async function waitForContainer(
  input: {accessToken: string; containerId: string},
  fetchFn: FetchFn,
  options: WaitOptions = {},
): Promise<InstagramResult<ContainerStatus>> {
  const operation = 'wait-for-container';
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const sleepFn = options.sleepFn ?? sleepForMs;
  const nowFn = options.nowFn ?? Date.now;
  const startedAtMs = nowFn();

  for (;;) {
    const report = await fetchContainerStatus(input, fetchFn);
    if (!report.ok) return report;
    const {statusCode, status} = report.value;
    if (statusCode === 'FINISHED') return report;
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      return failure(operation, `container-${statusCode.toLowerCase()}`, `${status ?? 'no status given'} (container ${input.containerId})`);
    }
    if (nowFn() - startedAtMs + pollIntervalMs > maxWaitMs) {
      return failure(operation, 'timeout', `container ${input.containerId} not FINISHED within ${maxWaitMs} ms (last ${statusCode})`);
    }
    await sleepFn(pollIntervalMs);
  }
}

export async function publishContainer(
  input: {accessToken: string; userId: string; containerId: string},
  fetchFn: FetchFn,
): Promise<InstagramResult<{mediaId: string}>> {
  const operation = 'publish-container';
  const response = await fetchFn(
    graphUrl(`${encodeURIComponent(input.userId)}/media_publish`),
    postForm(input.accessToken, {creation_id: input.containerId}),
  );
  const body = await readGraphBody(operation, response);
  if (!body.ok) return body;
  if (!isNonEmptyString(body.value.id)) return failure(operation, 'invalid-response', 'publish response without id');
  return {ok: true, value: {mediaId: body.value.id}};
}

export async function fetchPermalink(
  input: {accessToken: string; mediaId: string},
  fetchFn: FetchFn,
): Promise<InstagramResult<{permalink: string}>> {
  const operation = 'fetch-permalink';
  const response = await fetchFn(
    graphUrl(`${encodeURIComponent(input.mediaId)}?fields=permalink`),
    getWithBearer(input.accessToken),
  );
  const body = await readGraphBody(operation, response);
  if (!body.ok) return body;
  if (!isNonEmptyString(body.value.permalink)) return failure(operation, 'invalid-response', 'media response without permalink');
  return {ok: true, value: {permalink: body.value.permalink}};
}
