import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {receiveAuthRequest, reportUnhandledAuthRejection, type AuthRequestSession} from '../src/tiktok/authRequest';
import type {ExchangeCodeFn} from '../src/tiktok/authCallback';
import type {TikTokTokens} from '../src/tiktok/oauth';
import type {TokenStore} from '../src/tiktok/tokenStore';

const EXPECTED_STATE = 'state-expected';
const AUTH_CODE = 'auth-code-secret';
const CLIENT_SECRET = 'client-secret-value';
const ACCESS_TOKEN = 'access-token-secret';

const fakeTokens: TikTokTokens = {
  accessToken: ACCESS_TOKEN,
  refreshToken: 'refresh-token-secret',
  accessExpiresAt: 1_700_000_000_000,
  refreshExpiresAt: 1_800_000_000_000,
  openId: 'open-1',
  scope: 'video.upload',
};

afterEach(() => {
  vi.restoreAllMocks();
});

function callbackPath(params: Record<string, string>): string {
  return `/callback/?${new URLSearchParams(params).toString()}`;
}

async function getText(port: number, urlPath: string): Promise<{status: number; body: string; contentType: string | null}> {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  return {status: response.status, body: await response.text(), contentType: response.headers.get('content-type')};
}

async function closeIfListening(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
  });
}

async function withCallbackServer(
  options: {
    exchangeCode: ExchangeCodeFn;
    save?: TokenStore['save'];
    onFinished: (exitCode: number) => void;
  },
  run: (port: number, session: AuthRequestSession) => Promise<void>,
): Promise<void> {
  const timeout = setTimeout(() => undefined, 60_000);
  timeout.unref();
  let session: AuthRequestSession | undefined;
  const server = createServer((request, response) => {
    if (!session) return;
    receiveAuthRequest(session, request, response);
  });
  const save = options.save ?? (async () => undefined);
  session = {
    server,
    timeout,
    redirectUrl: new URL('http://127.0.0.1/callback/'),
    expectedState: EXPECTED_STATE,
    clientSecret: CLIENT_SECRET,
    exchangeCode: options.exchangeCode,
    tokenStore: {async load() { return undefined; }, save},
    hasSettled: false,
    onFinished: options.onFinished,
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a TCP port');
    await run(address.port, session);
  } finally {
    clearTimeout(timeout);
    await closeIfListening(server);
  }
}

type FlushResponse = {
  response: ServerResponse;
  end: ReturnType<typeof vi.fn>;
  flush: () => void;
};

function flushResponse(): FlushResponse {
  let flushCallback: (() => void) | undefined;
  const end = vi.fn((...args: unknown[]) => {
    const callback = args.find((arg) => typeof arg === 'function');
    if (typeof callback === 'function') flushCallback = callback as () => void;
  });
  const response = {writeHead: vi.fn(), end, writableEnded: false} as unknown as ServerResponse;
  return {
    response,
    end,
    flush() {
      flushCallback?.();
    },
  };
}

async function settleCallbacks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('receiveAuthRequest', () => {
  it('answers a wrong path without consuming the callback, then returns the authorized page', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>().mockResolvedValue({ok: true, value: fakeTokens});
    const save = vi.fn(async () => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let exitCode = -1;

    await withCallbackServer({exchangeCode, save, onFinished: (code) => { exitCode = code; }}, async (port, session) => {
      const missed = await getText(port, '/favicon.ico');
      expect(missed).toMatchObject({status: 404, body: 'Not found.'});
      expect(session.hasSettled).toBe(false);
      expect(exchangeCode).not.toHaveBeenCalled();

      const page = await getText(port, callbackPath({state: EXPECTED_STATE, code: AUTH_CODE}));
      expect(page.status).toBe(200);
      expect(page.body).toBe('Authorized. You can close this tab.');
      expect(page.contentType).toBe('text/plain; charset=utf-8');
      expect(page.body).not.toContain(AUTH_CODE);
      expect(page.body).not.toContain(ACCESS_TOKEN);
      expect(exchangeCode).toHaveBeenCalledOnce();
      expect(exchangeCode).toHaveBeenCalledWith(AUTH_CODE);
      expect(save).toHaveBeenCalledWith(fakeTokens);
      expect(logSpy).toHaveBeenCalledWith('Authorized for scopes: video.upload');
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(ACCESS_TOKEN);
      await vi.waitFor(() => expect(exitCode).toBe(0));
    });
  });

  it('refuses a second callback while the first exchange is still in flight', async () => {
    let resolveExchange: (value: Awaited<ReturnType<ExchangeCodeFn>>) => void = () => undefined;
    const exchangeCode = vi.fn<ExchangeCodeFn>(
      () =>
        new Promise((resolve) => {
          resolveExchange = resolve;
        }),
    );
    let exitCode = -1;

    await withCallbackServer({exchangeCode, onFinished: (code) => { exitCode = code; }}, async (port) => {
      const first = getText(port, callbackPath({state: EXPECTED_STATE, code: AUTH_CODE}));
      await vi.waitFor(() => expect(exchangeCode).toHaveBeenCalledOnce());

      const second = await getText(port, callbackPath({state: EXPECTED_STATE, code: AUTH_CODE}));
      expect(second).toMatchObject({status: 400, body: 'Authorization already finished.'});
      expect(exchangeCode).toHaveBeenCalledOnce();

      resolveExchange({ok: true, value: fakeTokens});
      const completed = await first;
      expect(completed).toMatchObject({status: 200, body: 'Authorized. You can close this tab.'});
      await vi.waitFor(() => expect(exitCode).toBe(0));
    });
  });

  it('returns the failure page for a state mismatch and does not save tokens', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>();
    const save = vi.fn(async () => undefined);
    let exitCode = -1;

    await withCallbackServer({exchangeCode, save, onFinished: (code) => { exitCode = code; }}, async (port) => {
      const page = await getText(port, callbackPath({state: 'wrong', code: AUTH_CODE}));
      expect(page.status).toBe(400);
      expect(page.body).toBe('State mismatch. Request rejected.');
      expect(page.body).not.toContain(AUTH_CODE);
      expect(exchangeCode).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(exitCode).toBe(1));
    });
  });

  it('returns a fixed failure page when the token file cannot be saved', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>().mockResolvedValue({ok: true, value: fakeTokens});
    const save = vi.fn(async () => {
      throw new Error(`EACCES /tmp/${ACCESS_TOKEN}.json`);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let exitCode = -1;

    await withCallbackServer({exchangeCode, save, onFinished: (code) => { exitCode = code; }}, async (port) => {
      const page = await getText(port, callbackPath({state: EXPECTED_STATE, code: AUTH_CODE}));
      expect(page).toMatchObject({status: 500, body: 'Could not save the token file. See the terminal.'});
      expect(page.body).not.toContain(ACCESS_TOKEN);
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy).toHaveBeenCalledWith('tiktok-auth: could not save the token file');
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(ACCESS_TOKEN);
      await vi.waitFor(() => expect(exitCode).toBe(1));
    });
  });

  it('closes the server and reports the exit code only after the page is flushed', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>().mockResolvedValue({ok: true, value: fakeTokens});
    const onFinished = vi.fn();
    const close = vi.fn();
    const timeout = setTimeout(() => undefined, 60_000);
    timeout.unref();
    const page = flushResponse();
    const session: AuthRequestSession = {
      server: {close} as unknown as Server,
      timeout,
      redirectUrl: new URL('http://127.0.0.1/callback/'),
      expectedState: EXPECTED_STATE,
      clientSecret: CLIENT_SECRET,
      exchangeCode,
      tokenStore: {async load() { return undefined; }, async save() { return undefined; }},
      hasSettled: false,
      onFinished,
    };

    try {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      receiveAuthRequest(session, {url: callbackPath({state: EXPECTED_STATE, code: AUTH_CODE})} as IncomingMessage, page.response);
      await settleCallbacks();

      expect(page.end).toHaveBeenCalledWith('Authorized. You can close this tab.', expect.any(Function));
      expect(close).not.toHaveBeenCalled();
      expect(onFinished).not.toHaveBeenCalled();

      page.flush();
      expect(close).toHaveBeenCalledOnce();
      expect(onFinished).toHaveBeenCalledWith(0);
      const closeOrder = close.mock.invocationCallOrder[0];
      const finishedOrder = onFinished.mock.invocationCallOrder[0];
      expect(closeOrder).toBeLessThan(finishedOrder ?? 0);
    } finally {
      clearTimeout(timeout);
    }
  });

  it('still sends a page when the success log throws, without printing the thrown secret', async () => {
    const exchangeCode = vi.fn<ExchangeCodeFn>().mockResolvedValue({ok: true, value: fakeTokens});
    vi.spyOn(console, 'log').mockImplementation(() => {
      throw new Error(`disk full ${ACCESS_TOKEN}`);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onFinished = vi.fn();
    const close = vi.fn();
    const timeout = setTimeout(() => undefined, 60_000);
    timeout.unref();
    const page = flushResponse();
    const session: AuthRequestSession = {
      server: {close} as unknown as Server,
      timeout,
      redirectUrl: new URL('http://127.0.0.1/callback/'),
      expectedState: EXPECTED_STATE,
      clientSecret: CLIENT_SECRET,
      exchangeCode,
      tokenStore: {async load() { return undefined; }, async save() { return undefined; }},
      hasSettled: false,
      onFinished,
    };

    try {
      receiveAuthRequest(session, {url: callbackPath({state: EXPECTED_STATE, code: AUTH_CODE})} as IncomingMessage, page.response);
      await settleCallbacks();

      expect(errorSpy).toHaveBeenCalledWith('tiktok-auth: authorization failed');
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(ACCESS_TOKEN);
      expect(page.end).toHaveBeenCalledWith('Authorization failed. See the terminal.', expect.any(Function));
      expect(onFinished).not.toHaveBeenCalled();

      page.flush();
      expect(close).toHaveBeenCalledOnce();
      expect(onFinished).toHaveBeenCalledWith(1);
    } finally {
      clearTimeout(timeout);
    }
  });
});

describe('reportUnhandledAuthRejection', () => {
  const token = 'access-token-secret';

  it('prints a node error code and not the rejection text', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const close = vi.fn();
    const setExitCode = vi.fn();

    reportUnhandledAuthRejection(Object.assign(new Error(`listen ${token}`), {code: 'EADDRINUSE'}), {close} as unknown as Server, setExitCode);

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith('tiktok-auth: EADDRINUSE');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
    expect(close).toHaveBeenCalledOnce();
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it.each([
    ['a string', `down ${token}`],
    ['an Error message', new Error(`down ${token}`)],
    ['a numeric code', {code: 1, detail: token}],
    ['null', null],
  ])('hides %s', (_label, reason) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const setExitCode = vi.fn();

    reportUnhandledAuthRejection(reason, undefined, setExitCode);

    expect(errorSpy).toHaveBeenCalledWith('tiktok-auth: authorization failed');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
    expect(setExitCode).toHaveBeenCalledWith(1);
  });
});
