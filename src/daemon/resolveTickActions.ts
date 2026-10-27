import path from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {checkTikTokPublishes, type CheckTikTokPublishesSummary} from '../publish/checkTikTokPublishes';
import {sendEpisodeToTikTok, type SendEpisodeToTikTokResult} from '../publish/sendEpisodeToTikTok';
import {readTikTokCredentials, type TikTokCredentials} from '../tiktok/credentials';
import {fetchPublishStatus} from '../tiktok/inboxUpload';
import {refreshAccessToken} from '../tiktok/oauth';
import {
  createAccessTokenProvider,
  createFileTokenStore,
  DEFAULT_TOKEN_PATH,
  type AccessTokenProvider,
  type TokenStore,
} from '../tiktok/tokenStore';
import type {FetchFn, TikTokError} from '../tiktok/types';
import {readRenderBytes, type ReadRenderBytesResult} from './readRenderBytes';
import type {TickActions, TickSendRequest} from './tickActions';

export type ResolveTickActionsOptions = {
  env: NodeJS.ProcessEnv;
  db: DatabaseSync;
  outDir: string;
  fetchFn?: FetchFn;
  tokenStore?: TokenStore;
  readVideoBytes?: (episodeId: string) => Promise<ReadRenderBytesResult>;
};

function uploadFailed(error: TikTokError): SendEpisodeToTikTokResult {
  return {kind: 'upload-failed', publishId: null, error};
}

function tokenStoreFor(credentials: TikTokCredentials, tokenStore: TokenStore | undefined): TokenStore {
  if (tokenStore !== undefined) return tokenStore;
  // Each environment keeps its own token file. The default path is the old single tokens.json.
  const tokenPath = path.join(path.dirname(DEFAULT_TOKEN_PATH), credentials.tokenFileName);
  return createFileTokenStore(tokenPath);
}

function createActions(options: {
  db: DatabaseSync;
  outDir: string;
  credentials: TikTokCredentials;
  fetchFn: FetchFn;
  tokenStore: TokenStore | undefined;
  readVideoBytes: ResolveTickActionsOptions['readVideoBytes'];
}): TickActions {
  const {db, credentials, fetchFn} = options;
  const provider = createAccessTokenProvider(tokenStoreFor(credentials, options.tokenStore), (refreshToken) =>
    refreshAccessToken(
      {clientKey: credentials.clientKey, clientSecret: credentials.clientSecret, refreshToken},
      fetchFn,
    ),
  );
  const readVideo =
    options.readVideoBytes ?? ((episodeId: string) => readRenderBytes({db, outDir: options.outDir, episodeId}));

  return {
    checkPublishes: (nowMs) => checkWithToken({db, nowMs, provider, fetchFn}),
    sendEpisode: (request) => sendWithToken({db, request, provider, fetchFn, readVideo}),
  };
}

async function checkWithToken(options: {
  db: DatabaseSync;
  nowMs: number;
  provider: AccessTokenProvider;
  fetchFn: FetchFn;
}): Promise<CheckTikTokPublishesSummary> {
  const token = await options.provider.getAccessToken(options.nowMs);
  if (!token.ok) {
    return {sent: 0, failed: 0, stalled: 0, stillProcessing: 0, statusErrors: [token.error]};
  }
  const accessToken = token.value;
  return checkTikTokPublishes({
    db: options.db,
    nowMs: options.nowMs,
    fetchStatus: (publishId) => fetchPublishStatus({accessToken, publishId}, options.fetchFn),
  });
}

async function sendWithToken(options: {
  db: DatabaseSync;
  request: TickSendRequest;
  provider: AccessTokenProvider;
  fetchFn: FetchFn;
  readVideo: (episodeId: string) => Promise<ReadRenderBytesResult>;
}): Promise<SendEpisodeToTikTokResult> {
  const {db, request, provider, fetchFn, readVideo} = options;
  const video = await readVideo(request.episodeId);
  if (!video.ok) return uploadFailed({operation: 'read-render', code: 'no-render', detail: video.message});
  const token = await provider.getAccessToken(request.nowMs);
  if (!token.ok) return uploadFailed(token.error);
  return sendEpisodeToTikTok({
    db,
    episodeId: request.episodeId,
    videoBytes: video.videoBytes,
    accessToken: token.value,
    fetchFn,
    nowMs: request.nowMs,
    newId: request.newId,
  });
}

/**
 * Builds the tick's TikTok calls from the process environment.
 * Returns undefined when the client key and secret are missing, so the daemon can still start.
 * Nothing is read from the token file until a tick runs.
 */
export function resolveTickActions(options: ResolveTickActionsOptions): TickActions | undefined {
  const credentials = readTikTokCredentials(options.env);
  if (!credentials.ok) return undefined;
  return createActions({
    db: options.db,
    outDir: options.outDir,
    credentials: credentials.value,
    fetchFn: options.fetchFn ?? fetch,
    tokenStore: options.tokenStore,
    readVideoBytes: options.readVideoBytes,
  });
}
