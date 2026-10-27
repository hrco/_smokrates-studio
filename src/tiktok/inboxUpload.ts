import {
  REQUEST_TIMEOUT_MS,
  failure,
  isNonEmptyString,
  isRecord,
  readJsonBody,
  type FetchFn,
  type TikTokResult,
} from './types';

const INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
const STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
const MAX_SINGLE_CHUNK_BYTES = 64 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export type PublishStatus =
  | 'PROCESSING_UPLOAD'
  | 'PROCESSING_DOWNLOAD'
  | 'SEND_TO_USER_INBOX'
  | 'PUBLISH_COMPLETE'
  | 'FAILED';

export type PublishStatusReport = {status: PublishStatus; failReason?: string};

const PUBLISH_STATUSES: readonly string[] = [
  'PROCESSING_UPLOAD',
  'PROCESSING_DOWNLOAD',
  'SEND_TO_USER_INBOX',
  'PUBLISH_COMPLETE',
  'FAILED',
];

function isPublishStatus(value: unknown): value is PublishStatus {
  return typeof value === 'string' && PUBLISH_STATUSES.includes(value);
}

type ApiErrorFields = {code: string; message: string; logId: string};

function readApiError(body: Record<string, unknown>): ApiErrorFields | undefined {
  const {error} = body;
  if (!isRecord(error) || !isNonEmptyString(error.code)) return undefined;
  return {
    code: error.code,
    message: typeof error.message === 'string' ? error.message : '',
    logId: typeof error.log_id === 'string' ? error.log_id : '',
  };
}

function describeApiError(apiError: ApiErrorFields): string {
  return `${apiError.message} (log_id ${apiError.logId})`;
}

type InitResult = TikTokResult<{publishId: string; uploadUrl: string}>;

async function initInboxUpload(accessToken: string, videoSize: number, fetchFn: FetchFn): Promise<InitResult> {
  const operation = 'init-inbox-upload';
  const response = await fetchFn(INIT_URL, {
    method: 'POST',
    headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8'},
    body: JSON.stringify({
      source_info: {source: 'FILE_UPLOAD', video_size: videoSize, chunk_size: videoSize, total_chunk_count: 1},
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await readJsonBody(response);
  if (!isRecord(body)) return failure(operation, 'invalid-response', `HTTP ${response.status} with a non-JSON body`);

  const apiError = readApiError(body);
  if (!apiError) return failure(operation, 'invalid-response', `HTTP ${response.status} without an error field`);
  if (apiError.code !== 'ok') return failure(operation, apiError.code, describeApiError(apiError));

  const data = body.data;
  if (!isRecord(data) || !isNonEmptyString(data.publish_id) || !isNonEmptyString(data.upload_url)) {
    return failure(operation, 'invalid-response', 'init succeeded without publish_id and upload_url');
  }
  return {ok: true, value: {publishId: data.publish_id, uploadUrl: data.upload_url}};
}

async function putVideoBytes(uploadUrl: string, videoBytes: Uint8Array<ArrayBuffer>, fetchFn: FetchFn): Promise<TikTokResult<null>> {
  const operation = 'put-video-bytes';
  const size = videoBytes.byteLength;
  const response = await fetchFn(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Content-Range': `bytes 0-${size - 1}/${size}`,
    },
    body: videoBytes,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (response.status === 206) return failure(operation, 'partial-upload', 'HTTP 206: expected single chunk complete');
  if (response.status === 200) {
    return failure(operation, 'upload-not-complete', 'HTTP 200: TikTok signals a complete upload only with 201');
  }
  if (response.status !== 201) {
    return failure(operation, 'upload-rejected', `HTTP ${response.status}`);
  }
  return {ok: true, value: null};
}

/**
 * Sends one mp4 to the creator's TikTok inbox as a draft. Single chunk only (<= 64 MB);
 * chunked upload is out of scope. Returns the publish_id. `onInitialized` runs after init and before the
 * bytes are sent, so the caller can store the publish_id first; if it throws, nothing is uploaded. The upload URL is never returned or logged.
 */
export async function uploadVideoToInbox(
  input: {
    accessToken: string;
    videoBytes: Uint8Array<ArrayBuffer>;
    onInitialized?: (publishId: string) => Promise<void>;
  },
  fetchFn: FetchFn,
): Promise<TikTokResult<{publishId: string}>> {
  const size = input.videoBytes.byteLength;
  if (size === 0) return failure('upload-video-to-inbox', 'empty-video', 'the video file is empty');
  if (size > MAX_SINGLE_CHUNK_BYTES) {
    return failure(
      'upload-video-to-inbox',
      'video-too-large',
      `${size} bytes exceeds the 64 MB single-chunk limit; chunked upload is not supported`,
    );
  }

  const init = await initInboxUpload(input.accessToken, size, fetchFn);
  if (!init.ok) return init;
  if (input.onInitialized) {
    try {
      await input.onInitialized(init.value.publishId);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      return failure('upload-video-to-inbox', 'record-publish-id-failed', `${cause} (publish_id ${init.value.publishId})`);
    }
  }
  const put = await putVideoBytes(init.value.uploadUrl, input.videoBytes, fetchFn);
  if (!put.ok) {
    const {operation, code, detail} = put.error;
    return failure(operation, code, `${detail} (publish_id ${init.value.publishId})`);
  }
  return {ok: true, value: {publishId: init.value.publishId}};
}

export async function fetchPublishStatus(
  input: {accessToken: string; publishId: string},
  fetchFn: FetchFn,
): Promise<TikTokResult<PublishStatusReport>> {
  const operation = 'fetch-publish-status';
  const response = await fetchFn(STATUS_URL, {
    method: 'POST',
    headers: {Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8'},
    body: JSON.stringify({publish_id: input.publishId}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await readJsonBody(response);
  if (!isRecord(body)) return failure(operation, 'invalid-response', `HTTP ${response.status} with a non-JSON body`);

  const apiError = readApiError(body);
  if (!apiError) return failure(operation, 'invalid-response', `HTTP ${response.status} without an error field`);
  if (apiError.code !== 'ok') return failure(operation, apiError.code, describeApiError(apiError));

  const data = body.data;
  if (!isRecord(data) || !isPublishStatus(data.status)) {
    return failure(operation, 'invalid-response', 'status response without a known status');
  }
  const failReason = typeof data.fail_reason === 'string' ? data.fail_reason : undefined;
  return {ok: true, value: failReason === undefined ? {status: data.status} : {status: data.status, failReason}};
}

export type WaitOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
};

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_WAIT_TIMEOUT_MS = 300_000;

function sleepForMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls until the draft reaches the inbox. The default 5 s interval is 12 requests a minute,
 * well under TikTok's 30 per minute limit.
 */
export async function waitForInboxDelivery(
  input: {accessToken: string; publishId: string},
  fetchFn: FetchFn,
  options: WaitOptions = {},
): Promise<TikTokResult<PublishStatusReport>> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const sleepFn = options.sleepFn ?? sleepForMs;
  const maxPolls = Math.floor(timeoutMs / pollIntervalMs) + 1;

  for (let pollCount = 1; pollCount <= maxPolls; pollCount += 1) {
    const report = await fetchPublishStatus(input, fetchFn);
    if (!report.ok) return report;
    const {status, failReason} = report.value;
    if (status === 'FAILED') return failure('wait-for-inbox-delivery', 'publish-failed', failReason ?? 'no fail_reason given');
    if (status === 'SEND_TO_USER_INBOX' || status === 'PUBLISH_COMPLETE') return report;
    if (pollCount < maxPolls) await sleepFn(pollIntervalMs);
  }
  return failure('wait-for-inbox-delivery', 'timeout', `no inbox delivery within ${timeoutMs} ms`);
}
