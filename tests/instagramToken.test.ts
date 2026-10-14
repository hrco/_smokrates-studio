import {mkdtemp, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {
  createFileTokenStore,
  refreshAccessToken,
  refreshAndSaveToken,
  resolveAccessToken,
  type StoredToken,
  type TokenStore,
} from '../src/instagram/token';

const nowMs = Date.parse('2026-10-14T10:00:00.000Z');
const dayMs = 24 * 60 * 60 * 1000;

function memoryStore(initial?: StoredToken): TokenStore & {saved: StoredToken[]} {
  let current = initial;
  const saved: StoredToken[] = [];
  return {
    saved,
    async load() {
      return current;
    },
    async save(token) {
      current = token;
      saved.push(token);
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

describe('resolveAccessToken', () => {
  it('prefers the file over the env variable', async () => {
    const store = memoryStore({accessToken: 'file-tok', expiresAt: new Date(nowMs + 30 * dayMs).toISOString()});
    const result = await resolveAccessToken(store, {INSTAGRAM_ACCESS_TOKEN: 'env-tok'}, nowMs);
    expect(result).toEqual({
      ok: true,
      value: {accessToken: 'file-tok', source: 'file', expiresAt: new Date(nowMs + 30 * dayMs).toISOString(), isExpiringSoon: false},
    });
  });

  it('flags a file token that expires within 7 days', async () => {
    const store = memoryStore({accessToken: 'file-tok', expiresAt: new Date(nowMs + 6 * dayMs).toISOString()});
    const result = await resolveAccessToken(store, {}, nowMs);
    expect(result.ok && result.value.isExpiringSoon).toBe(true);
  });

  it('falls back to the env variable', async () => {
    const result = await resolveAccessToken(memoryStore(), {INSTAGRAM_ACCESS_TOKEN: 'env-tok'}, nowMs);
    expect(result).toEqual({ok: true, value: {accessToken: 'env-tok', source: 'env', isExpiringSoon: false}});
  });

  it('fails when neither source has a token', async () => {
    const result = await resolveAccessToken(memoryStore(), {INSTAGRAM_ACCESS_TOKEN: ''}, nowMs);
    expect(!result.ok && result.error.code).toBe('no-token');
  });
});

describe('refreshAccessToken', () => {
  it('calls the refresh endpoint and computes expiresAt from expires_in', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({access_token: 'new-tok', token_type: 'bearer', expires_in: 5184000}));
    const result = await refreshAccessToken({accessToken: 'old-tok', nowMs}, fetchFn);
    expect(result).toEqual({ok: true, value: {accessToken: 'new-tok', expiresAt: new Date(nowMs + 5184000 * 1000).toISOString()}});
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe(
      'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=old-tok',
    );
  });

  it('maps a Graph error without leaking the token', async () => {
    const body = {error: {message: 'Session expired', type: 'OAuthException', code: 190, fbtrace_id: 'trace-9'}};
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(body, 400));
    const result = await refreshAccessToken({accessToken: 'old-tok', nowMs}, fetchFn);
    expect(result).toEqual({
      ok: false,
      error: {operation: 'refresh-access-token', code: '190', detail: 'Session expired (fbtrace_id trace-9)'},
    });
  });

  it('fails on a response without expires_in', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({access_token: 'new-tok'}));
    const result = await refreshAccessToken({accessToken: 'old-tok', nowMs}, fetchFn);
    expect(!result.ok && result.error.code).toBe('invalid-response');
  });
});

describe('refreshAndSaveToken', () => {
  it('saves the new token with the new expiry', async () => {
    const store = memoryStore({accessToken: 'old-tok', expiresAt: new Date(nowMs + dayMs).toISOString()});
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({access_token: 'new-tok', expires_in: 3600}));
    const result = await refreshAndSaveToken({store, env: {}, nowMs}, fetchFn);
    expect(result.ok).toBe(true);
    expect(store.saved).toEqual([{accessToken: 'new-tok', expiresAt: new Date(nowMs + 3600 * 1000).toISOString()}]);
  });

  it('refreshes the env token when no file exists', async () => {
    const store = memoryStore();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({access_token: 'new-tok', expires_in: 3600}));
    await refreshAndSaveToken({store, env: {INSTAGRAM_ACCESS_TOKEN: 'env-tok'}, nowMs}, fetchFn);
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('access_token=env-tok');
    expect(store.saved).toHaveLength(1);
  });

  it('saves nothing when the refresh fails', async () => {
    const store = memoryStore({accessToken: 'old-tok', expiresAt: new Date(nowMs + dayMs).toISOString()});
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({error: {message: 'no', code: 190}}, 400));
    const result = await refreshAndSaveToken({store, env: {}, nowMs}, fetchFn);
    expect(result.ok).toBe(false);
    expect(store.saved).toEqual([]);
  });

  it('fails without calling fetch when there is no token', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const result = await refreshAndSaveToken({store: memoryStore(), env: {}, nowMs}, fetchFn);
    expect(!result.ok && result.error.code).toBe('no-token');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('createFileTokenStore', () => {
  it('saves with mode 600 and loads back', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'ig-token-'));
    try {
      const tokenPath = path.join(folder, 'nested', 'token.json');
      const store = createFileTokenStore(tokenPath);
      expect(await store.load()).toBeUndefined();
      const token = {accessToken: 'tok', expiresAt: '2026-12-01T00:00:00.000Z'};
      await store.save(token);
      expect(await store.load()).toEqual(token);
      expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(folder, {recursive: true});
    }
  });
});
