import type {DatabaseSync} from 'node:sqlite';
import {uploadVideoToInbox} from '../tiktok/inboxUpload';
import type {FetchFn, TikTokError} from '../tiktok/types';
import {
  claimTikTokPublish,
  recordTikTokPublishId,
  settleFailedTikTokUpload,
  type TikTokPublishStatus,
} from './tiktokPublishLedger';

export type SendEpisodeToTikTokOptions = {
  db: DatabaseSync;
  episodeId: string;
  videoBytes: Uint8Array<ArrayBuffer>;
  accessToken: string;
  fetchFn: FetchFn;
  nowMs: number;
  newId: () => string;
};

export type SendEpisodeToTikTokResult =
  | {kind: 'sent-to-tiktok'; publishId: string}
  | {kind: 'already-claimed'; status: TikTokPublishStatus}
  | {kind: 'share-cap-reached'; inFlightShares: number}
  | {kind: 'upload-failed'; error: TikTokError; publishId: string | null};

/**
 * Sends one episode video to the TikTok inbox at most once.
 * The publish row is claimed before init and the publish_id is stored before the bytes upload.
 * A failure before init deletes that row, so the night and the day stay free for the next tick.
 * A failure after init keeps the row, because TikTok may still hold the pending slot.
 * On success the row stays processing. Episode status is not touched.
 */
export async function sendEpisodeToTikTok(options: SendEpisodeToTikTokOptions): Promise<SendEpisodeToTikTokResult> {
  const claim = claimTikTokPublish(options.db, {
    episodeId: options.episodeId,
    nowMs: options.nowMs,
    newId: options.newId,
  });
  if (claim.kind !== 'claimed') return claim;
  return uploadClaimedEpisode(options, claim.publishRowId);
}

function shouldReleaseClaim(publishId: string | null, error: TikTokError): boolean {
  if (publishId !== null) return false;
  if (error.operation === 'init-inbox-upload') return true;
  return error.code === 'empty-video' || error.code === 'video-too-large';
}

function thrownUploadError(error: unknown, publishId: string | null): TikTokError {
  const detail = error instanceof Error ? error.message : String(error);
  const operation = publishId === null ? 'init-inbox-upload' : 'put-video-bytes';
  return {operation, code: 'network-error', detail};
}

function failClaimedUpload(
  options: SendEpisodeToTikTokOptions,
  publishRowId: string,
  publishId: string | null,
  error: TikTokError,
): SendEpisodeToTikTokResult {
  settleFailedTikTokUpload(options.db, {
    publishRowId,
    nowMs: options.nowMs,
    releaseClaim: shouldReleaseClaim(publishId, error),
  });
  return {kind: 'upload-failed', error, publishId};
}

async function uploadClaimedEpisode(
  options: SendEpisodeToTikTokOptions,
  publishRowId: string,
): Promise<SendEpisodeToTikTokResult> {
  let publishId: string | null = null;
  try {
    const upload = await uploadVideoToInbox(
      {
        accessToken: options.accessToken,
        videoBytes: options.videoBytes,
        onInitialized: async (initializedPublishId) => {
          recordTikTokPublishId(options.db, {publishRowId, publishId: initializedPublishId, nowMs: options.nowMs});
          publishId = initializedPublishId;
        },
      },
      options.fetchFn,
    );
    if (upload.ok) return {kind: 'sent-to-tiktok', publishId: upload.value.publishId};
    return failClaimedUpload(options, publishRowId, publishId, upload.error);
  } catch (error) {
    return failClaimedUpload(options, publishRowId, publishId, thrownUploadError(error, publishId));
  }
}
