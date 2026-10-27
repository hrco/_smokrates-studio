import type {IncomingMessage, Server, ServerResponse} from 'node:http';
import {handleAuthCallback, type ExchangeCodeFn} from './authCallback';
import type {TikTokTokens} from './oauth';
import type {TokenStore} from './tokenStore';

export type AuthRequestSession = {
  server: Server;
  timeout: NodeJS.Timeout;
  redirectUrl: URL;
  expectedState: string;
  clientSecret: string;
  exchangeCode: ExchangeCodeFn;
  tokenStore: TokenStore;
  hasSettled: boolean;
  /** Called only after the browser page has been flushed, or when there is no page left to send. */
  onFinished: (exitCode: number) => void;
};

type PageOutcome = {
  statusCode: number;
  body: string;
  exitCode: number;
};

/**
 * Prints a fixed line for an unhandled rejection. The reason can quote an
 * authorization code or token, so only a node error code such as EADDRINUSE is included.
 */
export function reportUnhandledAuthRejection(
  reason: unknown,
  server: Server | undefined,
  setExitCode: (exitCode: number) => void,
): void {
  const errorCode = readSystemErrorCode(reason);
  console.error(errorCode ? `tiktok-auth: ${errorCode}` : 'tiktok-auth: authorization failed');
  server?.close();
  setExitCode(1);
}

function readSystemErrorCode(reason: unknown): string | undefined {
  if (typeof reason !== 'object' || reason === null || !('code' in reason)) return undefined;
  return typeof reason.code === 'string' ? reason.code : undefined;
}

/**
 * One OAuth redirect answer. A wrong path does not consume the callback.
 * A second hit on the callback path is refused so the code is exchanged once.
 */
export function receiveAuthRequest(session: AuthRequestSession, request: IncomingMessage, response: ServerResponse): void {
  const requestUrl = new URL(request.url ?? '/', session.redirectUrl);
  if (requestUrl.pathname !== session.redirectUrl.pathname) {
    replyWithText(response, 404, 'Not found.');
    return;
  }
  if (session.hasSettled) {
    replyWithText(response, 400, 'Authorization already finished.');
    return;
  }
  session.hasSettled = true;
  void finishCallback(session, requestUrl, response);
}

function replyWithText(response: ServerResponse, statusCode: number, text: string): void {
  response.writeHead(statusCode, {'Content-Type': 'text/plain; charset=utf-8'});
  response.end(text);
}

function replyThenClose(session: AuthRequestSession, response: ServerResponse, outcome: PageOutcome): void {
  response.writeHead(outcome.statusCode, {'Content-Type': 'text/plain; charset=utf-8'});
  // Close only after the body is flushed. Ending the process before that drops the page.
  response.end(outcome.body, () => {
    clearTimeout(session.timeout);
    session.server.close();
    session.onFinished(outcome.exitCode);
  });
}

async function saveAuthorizedTokens(store: TokenStore, tokens: TikTokTokens): Promise<boolean> {
  try {
    await store.save(tokens);
    return true;
  } catch {
    // The error text can quote the token file. The terminal gets a fixed line.
    console.error('tiktok-auth: could not save the token file');
    return false;
  }
}

async function writeCallbackResult(session: AuthRequestSession, requestUrl: URL, response: ServerResponse): Promise<void> {
  const result = await handleAuthCallback(requestUrl, {
    expectedState: session.expectedState,
    exchangeCode: session.exchangeCode,
    redactValues: [session.clientSecret],
  });
  if (!result.ok) {
    if (result.terminalMessage) console.error(`tiktok-auth: ${result.terminalMessage}`);
    replyThenClose(session, response, {statusCode: result.status, body: result.message, exitCode: 1});
    return;
  }
  const didSave = await saveAuthorizedTokens(session.tokenStore, result.tokens);
  if (!didSave) {
    replyThenClose(session, response, {statusCode: 500, body: 'Could not save the token file. See the terminal.', exitCode: 1});
    return;
  }
  console.log(result.logMessage);
  replyThenClose(session, response, {statusCode: 200, body: 'Authorized. You can close this tab.', exitCode: 0});
}

async function finishCallback(session: AuthRequestSession, requestUrl: URL, response: ServerResponse): Promise<void> {
  clearTimeout(session.timeout);
  try {
    await writeCallbackResult(session, requestUrl, response);
  } catch {
    // A rejection can quote the code or client secret. Keep the terminal line fixed.
    console.error('tiktok-auth: authorization failed');
    closeAfterFailure(session, response);
  }
}

function closeAfterFailure(session: AuthRequestSession, response: ServerResponse): void {
  if (!response.writableEnded) {
    replyThenClose(session, response, {statusCode: 500, body: 'Authorization failed. See the terminal.', exitCode: 1});
    return;
  }
  session.server.close();
  session.onFinished(1);
}
