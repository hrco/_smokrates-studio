import {describe, expect, it, vi} from 'vitest';
import {handleAuthCallback, type CallbackResult, type ExchangeCodeFn} from '../src/tiktok/authCallback';
import type {TikTokTokens} from '../src/tiktok/oauth';

const EXPECTED_STATE = 'state-expected';
const AUTH_CODE = 'auth-code-secret';
const CLIENT_SECRET = 'client-secret-value';
const ACCESS_TOKEN = 'access-token-secret';
const REFRESH_TOKEN = 'refresh-token-secret';

const fakeTokens: TikTokTokens = {
  accessToken: ACCESS_TOKEN,
  refreshToken: REFRESH_TOKEN,
  accessExpiresAt: 1_700_000_000_000,
  refreshExpiresAt: 1_800_000_000_000,
  openId: 'open-1',
  scope: 'video.upload',
};

function callbackUrl(params: Record<string, string>): URL {
  const url = new URL('http://127.0.0.1:8723/callback/');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

function assertMessagesHide(result: CallbackResult, secrets: readonly string[]): void {
  const messages = result.ok
    ? [result.logMessage]
    : [result.message, result.terminalMessage ?? ''];
  const serialized = JSON.stringify(messages);
  for (const secret of secrets) expect(serialized).not.toContain(secret);
}

describe('handleAuthCallback', () => {
  it('rejects a state mismatch without throwing or exchanging', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>();
    const result = await handleAuthCallback(callbackUrl({state: 'wrong', code: AUTH_CODE}), {
      expectedState: EXPECTED_STATE,
      exchangeCode,
      redactValues: [CLIENT_SECRET],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.message).toBe('State mismatch. Request rejected.');
    assertMessagesHide(result, [AUTH_CODE, CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN]);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects a missing code without throwing or exchanging', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>();
    const result = await handleAuthCallback(callbackUrl({state: EXPECTED_STATE}), {
      expectedState: EXPECTED_STATE,
      exchangeCode,
      redactValues: [CLIENT_SECRET],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.message).toBe('Missing code.');
    assertMessagesHide(result, [CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN]);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects a TikTok error param and hides the code and client secret', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>();
    const result = await handleAuthCallback(
      callbackUrl({
        state: EXPECTED_STATE,
        error: 'access_denied',
        error_description: `user cancelled ${AUTH_CODE} ${CLIENT_SECRET}`,
        code: AUTH_CODE,
      }),
      {expectedState: EXPECTED_STATE, exchangeCode, redactValues: [CLIENT_SECRET]},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.message).toBe('Authorization failed: access_denied');
    expect(result.terminalMessage).toContain('authorization denied');
    expect(result.terminalMessage).toContain('user cancelled');
    assertMessagesHide(result, [AUTH_CODE, CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN]);
    expect(JSON.stringify(result)).not.toContain(AUTH_CODE);
    expect(JSON.stringify(result)).not.toContain(CLIENT_SECRET);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('keeps a normal exchange error detail', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>().mockResolvedValue({
      ok: false,
      error: {operation: 'exchange-code', code: 'invalid_grant', detail: 'code expired'},
    });
    const result = await handleAuthCallback(callbackUrl({state: EXPECTED_STATE, code: AUTH_CODE}), {
      expectedState: EXPECTED_STATE,
      exchangeCode,
      redactValues: [CLIENT_SECRET],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);
    expect(result.message).toBe('Token exchange failed. See the terminal.');
    expect(result.terminalMessage).toBe('exchange-code: invalid_grant code expired');
    assertMessagesHide(result, [AUTH_CODE, CLIENT_SECRET]);
  });

  it('returns a safe message when exchange fails', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>().mockResolvedValue({
      ok: false,
      error: {
        operation: 'exchange-code',
        code: 'invalid_grant',
        detail: `rejected ${AUTH_CODE} ${CLIENT_SECRET} ${ACCESS_TOKEN} ${REFRESH_TOKEN}`,
      },
    });
    const result = await handleAuthCallback(callbackUrl({state: EXPECTED_STATE, code: AUTH_CODE}), {
      expectedState: EXPECTED_STATE,
      exchangeCode,
      redactValues: [CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);
    expect(result.message).toBe('Token exchange failed. See the terminal.');
    expect(result.terminalMessage).toContain('exchange-code: invalid_grant');
    assertMessagesHide(result, [AUTH_CODE, CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN]);
    expect(JSON.stringify(result)).not.toContain(AUTH_CODE);
    expect(JSON.stringify(result)).not.toContain(CLIENT_SECRET);
  });

  it('returns a safe failure when exchange throws', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>().mockRejectedValue(
      new Error(`socket hang up ${AUTH_CODE} ${CLIENT_SECRET} ${ACCESS_TOKEN}`),
    );
    const result = await handleAuthCallback(callbackUrl({state: EXPECTED_STATE, code: AUTH_CODE}), {
      expectedState: EXPECTED_STATE,
      exchangeCode,
      redactValues: [CLIENT_SECRET, ACCESS_TOKEN],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);
    expect(result.message).toBe('Token exchange failed. See the terminal.');
    assertMessagesHide(result, [AUTH_CODE, CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN]);
  });

  it('returns tokens on success and keeps them out of the log line', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>().mockResolvedValue({ok: true, value: fakeTokens});
    const result = await handleAuthCallback(callbackUrl({state: EXPECTED_STATE, code: AUTH_CODE}), {
      expectedState: EXPECTED_STATE,
      exchangeCode,
      redactValues: [CLIENT_SECRET],
    });

    expect(exchangeCode).toHaveBeenCalledOnce();
    expect(exchangeCode).toHaveBeenCalledWith(AUTH_CODE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toEqual(fakeTokens);
    expect(result.logMessage).toBe('Authorized for scopes: video.upload');
    assertMessagesHide(result, [AUTH_CODE, CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN]);
    expect(JSON.stringify(result)).not.toContain(AUTH_CODE);
    expect(JSON.stringify(result)).not.toContain(CLIENT_SECRET);
  });

  it('redacts a longer secret before a shorter prefix so no token tail remains', async () => {
    const code = 'auth-code-secret';
    const exchangeCode = vi.fn<ExchangeCodeFn>().mockResolvedValue({
      ok: false,
      error: {operation: 'exchange-code', code: 'invalid_grant', detail: `rejected ${code}`},
    });
    const result = await handleAuthCallback(callbackUrl({state: EXPECTED_STATE, code}), {
      expectedState: EXPECTED_STATE,
      exchangeCode,
      redactValues: ['auth-code', CLIENT_SECRET],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.terminalMessage).toBe('exchange-code: invalid_grant rejected [redacted]');
    assertMessagesHide(result, [code, 'auth-code', CLIENT_SECRET]);
  });

  it('does not echo a non-Error rejection', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>().mockRejectedValue(`boom ${AUTH_CODE} ${CLIENT_SECRET}`);
    const result = await handleAuthCallback(callbackUrl({state: EXPECTED_STATE, code: AUTH_CODE}), {
      expectedState: EXPECTED_STATE,
      exchangeCode,
      redactValues: [CLIENT_SECRET],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);
    expect(result.terminalMessage).toBe('exchange-code: failed token exchange failed');
    assertMessagesHide(result, [AUTH_CODE, CLIENT_SECRET]);
  });

  it('strips tokens that appear inside the scope log line', async () => {
    const tokens: TikTokTokens = {...fakeTokens, scope: `video.upload ${ACCESS_TOKEN} ${REFRESH_TOKEN}`};
    const exchangeCode = vi.fn<ExchangeCodeFn>().mockResolvedValue({ok: true, value: tokens});
    const result = await handleAuthCallback(callbackUrl({state: EXPECTED_STATE, code: AUTH_CODE}), {
      expectedState: EXPECTED_STATE,
      exchangeCode,
      redactValues: [CLIENT_SECRET],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toEqual(tokens);
    expect(result.logMessage).toContain('video.upload');
    assertMessagesHide(result, [AUTH_CODE, CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN]);
  });
});
