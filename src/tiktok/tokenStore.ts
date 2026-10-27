import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {TikTokTokens} from './oauth';
import {failure, isNonEmptyString, isRecord, type TikTokResult} from './types';

export const DEFAULT_TOKEN_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.tiktok/tokens.json',
);

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type TokenStore = {
  load(): Promise<TikTokTokens | undefined>;
  save(tokens: TikTokTokens): Promise<void>;
};

export type RefreshFn = (refreshToken: string) => Promise<TikTokResult<TikTokTokens>>;

function isTikTokTokens(value: unknown): value is TikTokTokens {
  return (
    isRecord(value) &&
    isNonEmptyString(value.accessToken) &&
    isNonEmptyString(value.refreshToken) &&
    typeof value.accessExpiresAt === 'number' &&
    typeof value.refreshExpiresAt === 'number' &&
    isNonEmptyString(value.openId) &&
    typeof value.scope === 'string'
  );
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function createFileTokenStore(tokenPath: string = DEFAULT_TOKEN_PATH): TokenStore {
  return {
    async load() {
      let rawText: string;
      try {
        rawText = await readFile(tokenPath, 'utf8');
      } catch (error) {
        if (isFileMissing(error)) return undefined;
        throw error;
      }
      const parsed: unknown = JSON.parse(rawText);
      if (!isTikTokTokens(parsed)) throw new Error(`token file ${tokenPath} has an unexpected shape`);
      return parsed;
    },
    async save(tokens) {
      await mkdir(path.dirname(tokenPath), {recursive: true, mode: 0o700});
      await writeFile(tokenPath, `${JSON.stringify(tokens, null, 2)}\n`, {mode: 0o600});
      await chmod(tokenPath, 0o600);
    },
  };
}

/**
 * Returns an access token that stays valid for at least five more minutes.
 * Refreshes when needed and saves the new token set, because TikTok may rotate the refresh token.
 */
export async function getValidAccessToken(
  store: TokenStore,
  refreshFn: RefreshFn,
  nowMs: number,
): Promise<TikTokResult<string>> {
  const tokens = await store.load();
  if (!tokens) return failure('get-access-token', 'no-tokens', 'no saved tokens: run npm run tiktok:auth');
  if (tokens.accessExpiresAt - nowMs > REFRESH_MARGIN_MS) return {ok: true, value: tokens.accessToken};

  if (tokens.refreshExpiresAt <= nowMs) {
    return failure('get-access-token', 'refresh-token-expired', 'run npm run tiktok:auth again');
  }
  const refreshed = await refreshFn(tokens.refreshToken);
  if (!refreshed.ok) return refreshed;
  await store.save(refreshed.value);
  return {ok: true, value: refreshed.value.accessToken};
}

export type AccessTokenProvider = {
  getAccessToken(nowMs: number): Promise<TikTokResult<string>>;
};

/**
 * Builds the one access-token source for a process. Callers that overlap share a single in-flight
 * refresh, so TikTok's rotated refresh token is never spent twice.
 * The daemon owns the only provider; scripts keep using getValidAccessToken.
 */
export function createAccessTokenProvider(store: TokenStore, refreshFn: RefreshFn): AccessTokenProvider {
  let inFlightLookup: Promise<TikTokResult<string>> | undefined;

  return {
    getAccessToken(nowMs) {
      if (inFlightLookup) return inFlightLookup;
      const lookup = getValidAccessToken(store, refreshFn, nowMs).finally(() => {
        inFlightLookup = undefined;
      });
      inFlightLookup = lookup;
      return lookup;
    },
  };
}
