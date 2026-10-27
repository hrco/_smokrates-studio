import {describe, expect, it, vi} from 'vitest';
import {buildAuthorizeUrl, exchangeCode, refreshAccessToken} from '../src/tiktok/oauth';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

const tokenBody = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 86400,
  refresh_expires_in: 31536000,
  open_id: 'open-1',
  scope: 'video.upload',
  token_type: 'Bearer',
};

describe('buildAuthorizeUrl', () => {
  it('sets every authorize parameter', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientKey: 'key',
        redirectUri: 'http://127.0.0.1:8723/callback/',
        state: 'state-1',
        codeChallenge: 'challenge-1',
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_key: 'key',
      scope: 'video.upload',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:8723/callback/',
      state: 'state-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
    });
  });
});

describe('exchangeCode', () => {
  const input = {clientKey: 'key', clientSecret: 'secret', code: 'code-1', redirectUri: 'http://x/cb/', codeVerifier: 'v'};

  it('posts a form body and parses the tokens', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(tokenBody));
    const before = Date.now();

    const result = await exchangeCode(input, fetchFn);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({accessToken: 'access-1', refreshToken: 'refresh-1', openId: 'open-1', scope: 'video.upload'});
    expect(result.value.accessExpiresAt).toBeGreaterThanOrEqual(before + 86400 * 1000);

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://open.tiktokapis.com/v2/oauth/token/');
    expect(init.method).toBe('POST');
    const form = new URLSearchParams(init.body as string);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_key')).toBe('key');
    expect(form.get('client_secret')).toBe('secret');
    expect(form.get('code')).toBe('code-1');
    expect(form.get('redirect_uri')).toBe('http://x/cb/');
    expect(form.get('code_verifier')).toBe('v');
  });

  it('rejects a token lifetime that is not a number', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({...tokenBody, expires_in: '86400'}));

    const result = await exchangeCode(input, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-response');
  });

  it('maps a TikTok error body to an error result', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({error: 'invalid_grant', error_description: 'Code expired'}, 400));

    const result = await exchangeCode(input, fetchFn);

    expect(result).toEqual({ok: false, error: {operation: 'exchange-code', code: 'invalid_grant', detail: 'Code expired'}});
  });

  it('reports a body without token fields as invalid', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({hello: 'world'}));

    const result = await exchangeCode(input, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-response');
  });

  it('rejects a blank access token', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({...tokenBody, access_token: ''}));

    const result = await exchangeCode(input, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-response');
  });

  it('reports a non-JSON token response as invalid', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', {status: 502}));

    const result = await exchangeCode(input, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.operation).toBe('exchange-code');
      expect(result.error.code).toBe('invalid-response');
      expect(result.error.detail).toContain('HTTP 502');
    }
  });
});

describe('refreshAccessToken', () => {
  it('uses the refresh_token grant', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(tokenBody));

    const result = await refreshAccessToken({clientKey: 'key', clientSecret: 'secret', refreshToken: 'old'}, fetchFn);

    expect(result.ok).toBe(true);
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const form = new URLSearchParams(init.body as string);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('client_key')).toBe('key');
    expect(form.get('client_secret')).toBe('secret');
    expect(form.get('refresh_token')).toBe('old');
  });

  it('maps a TikTok error body on refresh', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({error: 'invalid_grant', error_description: 'Refresh expired'}, 401));

    const result = await refreshAccessToken({clientKey: 'key', clientSecret: 'secret', refreshToken: 'old'}, fetchFn);

    expect(result).toEqual({
      ok: false,
      error: {operation: 'refresh-token', code: 'invalid_grant', detail: 'Refresh expired'},
    });
  });
});
