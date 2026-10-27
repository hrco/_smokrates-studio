import type {DatabaseSync} from 'node:sqlite';
import {uploadVideoToInbox} from '../tiktok/inboxUpload';
import type {FetchFn, TikTokError} from '../tiktok/types';
import {
  claimTikTokPublish,
  markTikTokPublish,
  recordTikTokPublishId,
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
 * A failed upload marks the row failed and is never retried, because TikTok may still hold the pending slot.
 * If init succeeded but the publish id was not stored, the row stays processing so the share cap still counts it.
 * On success the row stays processing; delivery is checked later. Episode status is not touched.
 */
export async function sendEpisodeToTikTok(options: SendEpisodeToTikTokOptions): Promise<SendEpisodeToTikTokResult> {
  const {db, episodeId, videoBytes, accessToken, fetchFn, nowMs, newId} = options;
  const claim = claimTikTokPublish(db, {episodeId, nowMs, newId});
  if (claim.kind !== 'claimed') return claim;

  const {publishRowId} = claim;
  let storedPublishId: string | null = null;
  const upload = await uploadVideoToInbox(
    {
      accessToken,
      videoBytes,
      onInitialized: async (publishId) => {
        recordTikTokPublishId(db, {publishRowId, publishId, nowMs});
        storedPublishId = publishId;
      },
    },
    fetchFn,
  );
  if (upload.ok) return {kind: 'sent-to-tiktok', publishId: upload.value.publishId};

  // Init succeeded but the publish id was not stored. TikTok holds the slot.
  // Leave the row processing so the cap counts it and the checker stalls it.
  if (upload.error.code !== 'record-publish-id-failed') {
    markTikTokPublish(db, {publishRowId, status: 'failed', nowMs});
  }
  return {kind: 'upload-failed', error: upload.error, publishId: storedPublishId};
}
