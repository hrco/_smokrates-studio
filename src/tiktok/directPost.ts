import {
  MAX_SINGLE_CHUNK_BYTES,
  describeApiError,
  putVideoBytes,
  readApiError,
} from './inboxUpload';
import {REQUEST_TIMEOUT_MS, failure, isNonEmptyString, isRecord, readJsonBody, type FetchFn, type TikTokResult} from './types';

const CREATOR_INFO_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';
const INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';

export const DEFAULT_PRIVACY = 'SELF_ONLY';

type ApiData = Record<string, unknown>;

/** Posts a JSON request and returns the `data` object of an `error.code === "ok"` reply. */
async function postApi(operation: string, url: string, accessToken: string, payload: unknown, fetchFn: FetchFn): Promise<TikTokResult<ApiData>> {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8'},
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await readJsonBody(response);
  if (!isRecord(body)) return failure(operation, 'invalid-response', `HTTP ${response.status} with a non-JSON body`);
  const apiError = readApiError(body);
  if (!apiError) return failure(operation, 'invalid-response', `HTTP ${response.status} without an error field`);
  if (apiError.code !== 'ok') return failure(operation, apiError.code, describeApiError(apiError));
  if (!isRecord(body.data)) return failure(operation, 'invalid-response', 'reply without a data object');
  return {ok: true, value: body.data};
}

export async function queryPrivacyOptions(accessToken: string, fetchFn: FetchFn): Promise<TikTokResult<string[]>> {
  const operation = 'query-creator-info';
  const result = await postApi(operation, CREATOR_INFO_URL, accessToken, undefined, fetchFn);
  if (!result.ok) return result;
  const options = result.value.privacy_level_options;
  if (!Array.isArray(options) || !options.every(isNonEmptyString)) {
    return failure(operation, 'invalid-response', 'creator info without privacy_level_options');
  }
  return {ok: true, value: options};
}

/**
 * Posts one mp4 straight to the creator's profile. Single chunk only (<= 64 MB).
 * Refuses before init when `privacyLevel` is not one of the creator's privacy_level_options.
 * The upload URL is never returned or logged. Returns the publish_id; poll it with fetchPublishStatus.
 */
export async function directPostVideo(
  input: {accessToken: string; videoBytes: Uint8Array<ArrayBuffer>; caption: string; privacyLevel?: string},
  fetchFn: FetchFn,
): Promise<TikTokResult<{publishId: string}>> {
  const operation = 'direct-post-video';
  const privacyLevel = input.privacyLevel ?? DEFAULT_PRIVACY;
  const size = input.videoBytes.byteLength;
  if (size === 0) return failure(operation, 'empty-video', 'the video file is empty');
  if (size > MAX_SINGLE_CHUNK_BYTES) {
    return failure(operation, 'video-too-large', `${size} bytes exceeds the 64 MB single-chunk limit; chunked upload is not supported`);
  }

  const options = await queryPrivacyOptions(input.accessToken, fetchFn);
  if (!options.ok) return options;
  if (!options.value.includes(privacyLevel)) {
    return failure(operation, 'privacy-not-allowed', `${privacyLevel} is not in privacy_level_options (${options.value.join(', ')})`);
  }

  const init = await postApi(
    'init-direct-post',
    INIT_URL,
    input.accessToken,
    {
      post_info: {
        title: input.caption,
        privacy_level: privacyLevel,
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
        is_aigc: true,
      },
      source_info: {source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1},
    },
    fetchFn,
  );
  if (!init.ok) return init;
  const {publish_id: publishId, upload_url: uploadUrl} = init.value;
  if (!isNonEmptyString(publishId) || !isNonEmptyString(uploadUrl)) {
    return failure('init-direct-post', 'invalid-response', 'init succeeded without publish_id and upload_url');
  }

  const put = await putVideoBytes(uploadUrl, input.videoBytes, fetchFn);
  if (!put.ok) {
    const {operation: putOperation, code, detail} = put.error;
    return failure(putOperation, code, `${detail} (publish_id ${publishId})`);
  }
  return {ok: true, value: {publishId}};
}
