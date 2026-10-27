import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {TikTokTokens} from '../src/tiktok/oauth';
import {createAccessTokenProvider, createFileTokenStore, getValidAccessToken} from '../src/tiktok/tokenStore';

const NOW_MS = 1_000_000_000_000;
const MINUTE_MS = 60_000;

function tokensExpiringIn(accessMs: number, accessToken = 'access-old'): TikTokTokens {
  return {
    accessToken,
    refreshToken: 'refresh-old',
    accessExpiresAt: NOW_MS + accessMs,
    refreshExpiresAt: NOW_MS + 1000 * MINUTE_MS,
    openId: 'open-1',
    scope: 'video.upload',
  };
}

let tempDir: string;
let tokenPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'tiktok-tokens-'));
  tokenPath = path.join(tempDir, '.tiktok', 'tokens.json');
});

afterEach(async () => {
  await rm(tempDir, {recursive: true, force: true});
});

describe('createFileTokenStore', () => {
  it('returns undefined when no file exists', async () => {
    expect(await createFileTokenStore(tokenPath).load()).toBeUndefined();
  });

  it('round-trips tokens with private file and directory modes', async () => {
    const store = createFileTokenStore(tokenPath);
    await store.save(tokensExpiringIn(60 * MINUTE_MS));

    expect(await store.load()).toEqual(tokensExpiringIn(60 * MINUTE_MS));
    expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(tokenPath))).mode & 0o777).toBe(0o700);
  });

  it('throws on corrupt JSON instead of looking like a missing token file', async () => {
    await mkdir(path.dirname(tokenPath), {recursive: true});
    await writeFile(tokenPath, '{');

    await expect(createFileTokenStore(tokenPath).load()).rejects.toThrow(SyntaxError);
  });

  it('throws when the token file is not a token set', async () => {
    await mkdir(path.dirname(tokenPath), {recursive: true});
    await writeFile(tokenPath, '{"accessToken":"only-one"}\n');

    await expect(createFileTokenStore(tokenPath).load()).rejects.toThrow(/unexpected shape/);
  });
});

describe('getValidAccessToken', () => {
  it('reuses a token that is valid for more than five minutes', async () => {
    const store = createFileTokenStore(tokenPath);
    await store.save(tokensExpiringIn(10 * MINUTE_MS));
    const refreshFn = vi.fn();

    const result = await getValidAccessToken(store, refreshFn, NOW_MS);

    expect(result).toEqual({ok: true, value: 'access-old'});
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it('refreshes near expiry and saves the rotated refresh token', async () => {
    const store = createFileTokenStore(tokenPath);
    await store.save(tokensExpiringIn(2 * MINUTE_MS));
    const rotated: TikTokTokens = {...tokensExpiringIn(60 * MINUTE_MS, 'access-new'), refreshToken: 'refresh-new'};
    const refreshFn = vi.fn().mockResolvedValue({ok: true, value: rotated});

    const result = await getValidAccessToken(store, refreshFn, NOW_MS);

    expect(result).toEqual({ok: true, value: 'access-new'});
    expect(refreshFn).toHaveBeenCalledWith('refresh-old');
    expect(JSON.parse(await readFile(tokenPath, 'utf8'))).toMatchObject({refreshToken: 'refresh-new'});
    expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
  });

  it('returns the refresh error without overwriting saved tokens', async () => {
    const store = createFileTokenStore(tokenPath);
    await store.save(tokensExpiringIn(MINUTE_MS));
    const error = {operation: 'refresh-token', code: 'invalid_grant', detail: 'revoked'};

    const result = await getValidAccessToken(store, async () => ({ok: false, error}), NOW_MS);

    expect(result).toEqual({ok: false, error});
    expect((await store.load())?.refreshToken).toBe('refresh-old');
  });

  it('asks for authorization when no tokens exist', async () => {
    const result = await getValidAccessToken(createFileTokenStore(tokenPath), vi.fn(), NOW_MS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('no-tokens');
  });

  it('refreshes when the access token has exactly five minutes left', async () => {
    const store = createFileTokenStore(tokenPath);
    await store.save(tokensExpiringIn(5 * MINUTE_MS));
    const rotated = tokensExpiringIn(60 * MINUTE_MS, 'access-new');
    const refreshFn = vi.fn().mockResolvedValue({ok: true, value: rotated});

    const result = await getValidAccessToken(store, refreshFn, NOW_MS);

    expect(result).toEqual({ok: true, value: 'access-new'});
    expect(refreshFn).toHaveBeenCalledOnce();
  });

  it('reuses a token that is valid for just over five minutes', async () => {
    const store = createFileTokenStore(tokenPath);
    await store.save(tokensExpiringIn(5 * MINUTE_MS + 1));
    const refreshFn = vi.fn();

    const result = await getValidAccessToken(store, refreshFn, NOW_MS);

    expect(result).toEqual({ok: true, value: 'access-old'});
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it('refuses an expired refresh token without calling refresh or rewriting the file', async () => {
    const store = createFileTokenStore(tokenPath);
    const saved = {...tokensExpiringIn(MINUTE_MS), refreshExpiresAt: NOW_MS};
    await store.save(saved);
    const refreshFn = vi.fn();

    const result = await getValidAccessToken(store, refreshFn, NOW_MS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('refresh-token-expired');
    expect(refreshFn).not.toHaveBeenCalled();
    expect(await store.load()).toEqual(saved);
  });
});

describe('createAccessTokenProvider', () => {
  it('shares one refresh between concurrent callers', async () => {
    const store = createFileTokenStore(tokenPath);
    await store.save(tokensExpiringIn(MINUTE_MS));
    const rotated: TikTokTokens = {...tokensExpiringIn(60 * MINUTE_MS, 'access-new'), refreshToken: 'refresh-new'};
    const refreshFn = vi.fn().mockResolvedValue({ok: true, value: rotated});
    const provider = createAccessTokenProvider(store, refreshFn);

    const results = await Promise.all([provider.getAccessToken(NOW_MS), provider.getAccessToken(NOW_MS)]);

    expect(results).toEqual([
      {ok: true, value: 'access-new'},
      {ok: true, value: 'access-new'},
    ]);
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(await store.load()).toEqual(rotated);
  });

  it('does not refresh again once the new token is valid', async () => {
    const store = createFileTokenStore(tokenPath);
    await store.save(tokensExpiringIn(MINUTE_MS));
    const rotated = tokensExpiringIn(60 * MINUTE_MS, 'access-new');
    const refreshFn = vi.fn().mockResolvedValue({ok: true, value: rotated});
    const provider = createAccessTokenProvider(store, refreshFn);

    await provider.getAccessToken(NOW_MS);
    const later = await provider.getAccessToken(NOW_MS + MINUTE_MS);

    expect(later).toEqual({ok: true, value: 'access-new'});
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it('returns a failed refresh to both callers and tries again on the next call', async () => {
    const store = createFileTokenStore(tokenPath);
    await store.save(tokensExpiringIn(MINUTE_MS));
    const error = {operation: 'refresh-token', code: 'invalid_grant', detail: 'revoked'};
    const rotated = tokensExpiringIn(60 * MINUTE_MS, 'access-new');
    const refreshFn = vi
      .fn()
      .mockResolvedValueOnce({ok: false, error})
      .mockResolvedValueOnce({ok: true, value: rotated});
    const provider = createAccessTokenProvider(store, refreshFn);

    const failed = await Promise.all([provider.getAccessToken(NOW_MS), provider.getAccessToken(NOW_MS)]);
    const retried = await provider.getAccessToken(NOW_MS);

    expect(failed).toEqual([
      {ok: false, error},
      {ok: false, error},
    ]);
    expect(retried).toEqual({ok: true, value: 'access-new'});
    expect(refreshFn).toHaveBeenCalledTimes(2);
  });
});
