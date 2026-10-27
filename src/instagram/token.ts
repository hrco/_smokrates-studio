import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  REQUEST_TIMEOUT_MS,
  failure,
  isNonEmptyString,
  isRecord,
  readGraphBody,
  type FetchFn,
  type InstagramResult,
} from './types';

export const DEFAULT_TOKEN_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.instagram/token.json',
);

const REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';
const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

export type StoredToken = {accessToken: string; expiresAt: string};

export type TokenStore = {
  load(): Promise<StoredToken | undefined>;
  save(token: StoredToken): Promise<void>;
};

export type ResolvedToken = {
  accessToken: string;
  source: 'file' | 'env';
  expiresAt?: string;
  isExpiringSoon: boolean;
};

function isStoredToken(value: unknown): value is StoredToken {
  return (
    isRecord(value) &&
    isNonEmptyString(value.accessToken) &&
    isNonEmptyString(value.expiresAt) &&
    !Number.isNaN(Date.parse(value.expiresAt))
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
      if (!isStoredToken(parsed)) throw new Error(`token file ${tokenPath} has an unexpected shape`);
      return parsed;
    },
    async save(token) {
      await mkdir(path.dirname(tokenPath), {recursive: true, mode: 0o700});
      await writeFile(tokenPath, `${JSON.stringify(token, null, 2)}\n`, {mode: 0o600});
      await chmod(tokenPath, 0o600);
    },
  };
}

/**
 * Picks the access token: the saved file wins over INSTAGRAM_ACCESS_TOKEN.
 * `isExpiringSoon` is true when the saved expiry is under 7 days away or already past.
 * An env token has no known expiry, so it is never flagged.
 */
export async function resolveAccessToken(
  store: TokenStore,
  env: NodeJS.ProcessEnv,
  nowMs: number,
): Promise<InstagramResult<ResolvedToken>> {
  const stored = await store.load();
  if (stored) {
    const isExpiringSoon = Date.parse(stored.expiresAt) - nowMs < EXPIRY_WARNING_MS;
    return {ok: true, value: {accessToken: stored.accessToken, source: 'file', expiresAt: stored.expiresAt, isExpiringSoon}};
  }
  const envToken = env.INSTAGRAM_ACCESS_TOKEN;
  if (isNonEmptyString(envToken)) {
    return {ok: true, value: {accessToken: envToken, source: 'env', isExpiringSoon: false}};
  }
  return failure('resolve-access-token', 'no-token', 'no .instagram/token.json and no INSTAGRAM_ACCESS_TOKEN (see docs/meta-setup.md)');
}

/** Exchanges a long-lived token for a fresh one (valid about 60 days). The token is never logged. */
export async function refreshAccessToken(
  input: {accessToken: string; nowMs: number},
  fetchFn: FetchFn,
): Promise<InstagramResult<StoredToken>> {
  const operation = 'refresh-access-token';
  const query = new URLSearchParams({grant_type: 'ig_refresh_token', access_token: input.accessToken});
  const response = await fetchFn(`${REFRESH_URL}?${query.toString()}`, {signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
  const body = await readGraphBody(operation, response);
  if (!body.ok) return body;

  const {access_token: accessToken, expires_in: expiresInSeconds} = body.value;
  if (!isNonEmptyString(accessToken) || typeof expiresInSeconds !== 'number') {
    return failure(operation, 'invalid-response', 'refresh succeeded without access_token and expires_in');
  }
  const expiresAt = new Date(input.nowMs + expiresInSeconds * 1000).toISOString();
  return {ok: true, value: {accessToken, expiresAt}};
}

/** Refreshes the resolved token and saves it to the store. */
export async function refreshAndSaveToken(
  input: {store: TokenStore; env: NodeJS.ProcessEnv; nowMs: number},
  fetchFn: FetchFn,
): Promise<InstagramResult<StoredToken>> {
  const resolved = await resolveAccessToken(input.store, input.env, input.nowMs);
  if (!resolved.ok) return resolved;
  const refreshed = await refreshAccessToken({accessToken: resolved.value.accessToken, nowMs: input.nowMs}, fetchFn);
  if (!refreshed.ok) return refreshed;
  await input.store.save(refreshed.value);
  return refreshed;
}
