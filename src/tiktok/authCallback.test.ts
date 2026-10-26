import {describe, it, expect} from 'vitest';
import {handleAuthCallback} from './authCallback';
import type {ExchangeCodeFn} from './authCallback';
import type {TikTokTokens} from './oauth';

const EXPECTED_STATE = 'abc123';

function makeUrl(params: Record<string, string>): URL {
  const url = new URL('http://127.0.0.1:8723/callback/');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

const fakeTokens: TikTokTokens = {
  accessToken: 'tok_access',
  refreshToken: 'tok_refresh',
  accessExpiresAt: Date.now() + 86400_000,
  refreshExpiresAt: Date.now() + 86400_000 * 30,
  openId: 'open123',
  scope: 'video.upload',
};

const successExchange: ExchangeCodeFn = async (_code) => ({ok: true, value: fakeTokens});

const failExchange: ExchangeCodeFn = async (_code) => ({
  ok: false,
  error: {operation: 'exchange-code', code: 'invalid_grant', detail: 'code expired'},
});

describe('handleAuthCallback', () => {
  it('returns 400 on state mismatch without throwing', async () => {
    const url = makeUrl({state: 'wrong', code: 'somecode'});
    const result = await handleAuthCallback(url, {expectedState: EXPECTED_STATE, exchangeCode: successExchange});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toBe('State mismatch. Request rejected.');
    }
  });

  it('returns 400 on TikTok error param without throwing', async () => {
    const url = makeUrl({state: EXPECTED_STATE, error: 'access_denied', error_description: 'user cancelled'});
    const result = await handleAuthCallback(url, {expectedState: EXPECTED_STATE, exchangeCode: successExchange});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toBe('Authorization failed: access_denied');
      expect(result.terminalMessage).toContain('authorization denied');
      expect(result.terminalMessage).toContain('user cancelled');
    }
  });

  it('returns 400 on missing code without throwing', async () => {
    const url = makeUrl({state: EXPECTED_STATE});
    const result = await handleAuthCallback(url, {expectedState: EXPECTED_STATE, exchangeCode: successExchange});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toBe('Missing code.');
    }
  });

  it('returns 500 on exchange failure without throwing', async () => {
    const url = makeUrl({state: EXPECTED_STATE, code: 'somecode'});
    const result = await handleAuthCallback(url, {expectedState: EXPECTED_STATE, exchangeCode: failExchange});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.message).toBe('Token exchange failed. See the terminal.');
      expect(result.terminalMessage).toBe('exchange-code: invalid_grant code expired');
    }
  });

  it('returns success with tokens and log message without throwing', async () => {
    const url = makeUrl({state: EXPECTED_STATE, code: 'goodcode'});
    const result = await handleAuthCallback(url, {expectedState: EXPECTED_STATE, exchangeCode: successExchange});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens).toEqual(fakeTokens);
      expect(result.logMessage).toBe('Authorized for scopes: video.upload');
      // logMessage must not contain the raw access or refresh token
      expect(result.logMessage).not.toContain('tok_access');
      expect(result.logMessage).not.toContain('tok_refresh');
    }
  });

  it('never exposes the authorization code in any result field', async () => {
    const secretCode = 'super_secret_auth_code';
    const url = makeUrl({state: EXPECTED_STATE, code: secretCode});
    const result = await handleAuthCallback(url, {expectedState: EXPECTED_STATE, exchangeCode: successExchange});
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretCode);
  });
});
