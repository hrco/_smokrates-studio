import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import path from 'node:path';
import {handleAuthCallback} from '../src/tiktok/authCallback';
import {readTikTokCredentials} from '../src/tiktok/credentials';
import {buildAuthorizeUrl, exchangeCode, type TikTokTokens} from '../src/tiktok/oauth';
import {createCodeVerifier, toCodeChallenge} from '../src/tiktok/pkce';
import {createFileTokenStore, DEFAULT_TOKEN_PATH, type TokenStore} from '../src/tiktok/tokenStore';

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:8723/callback/';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

type AuthEnv = {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  tokenPath: string;
  environment: string;
};

type CallbackSession = {
  server: Server;
  timeout: NodeJS.Timeout;
  redirectUrl: URL;
  state: string;
  codeVerifier: string;
  tokenStore: TokenStore;
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  hasSettled: boolean;
};

type PageOutcome = {
  statusCode: number;
  body: string;
  exitCode: number;
};

let listeningServer: Server | undefined;

process.on('unhandledRejection', (reason) => {
  // The reason can quote a code or token. Print only a node error code, such as EADDRINUSE.
  const errorCode = readSystemErrorCode(reason);
  console.error(errorCode ? `tiktok-auth: ${errorCode}` : 'tiktok-auth: authorization failed');
  listeningServer?.close();
  process.exitCode = 1;
});

function readSystemErrorCode(reason: unknown): string | undefined {
  if (typeof reason !== 'object' || reason === null || !('code' in reason)) return undefined;
  return typeof reason.code === 'string' ? reason.code : undefined;
}

function exitWithError(message: string): never {
  console.error(`tiktok-auth: ${message}`);
  process.exit(1);
}

function readEnv(): AuthEnv {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const credentials = readTikTokCredentials(process.env);
  if (!credentials.ok) exitWithError(`missing env: ${credentials.missingNames.join(', ')} (see .env.example)`);
  const {clientKey, clientSecret, environment, tokenFileName} = credentials.value;
  const tokenPath = path.join(path.dirname(DEFAULT_TOKEN_PATH), tokenFileName);
  return {clientKey, clientSecret, environment, tokenPath, redirectUri: process.env.TIKTOK_REDIRECT_URI || DEFAULT_REDIRECT_URI};
}

function listen(server: Server, redirectUrl: URL): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(redirectUrl.port), redirectUrl.hostname, resolve);
  });
}

function armAuthTimeout(server: Server): NodeJS.Timeout {
  const timeout = setTimeout(() => {
    console.error('tiktok-auth: timed out after 5 minutes without a callback');
    server.close();
    process.exitCode = 1;
  }, AUTH_TIMEOUT_MS);
  timeout.unref();
  return timeout;
}

function createSession(env: AuthEnv): CallbackSession {
  const redirectUrl = new URL(env.redirectUri);
  const holder: {session?: CallbackSession} = {};
  const server = createServer((request, response) => {
    const session = holder.session;
    if (!session) return;
    receiveRequest(session, request, response);
  });
  const timeout = armAuthTimeout(server);
  const session: CallbackSession = {
    server,
    timeout,
    redirectUrl,
    state: randomBytes(16).toString('hex'),
    codeVerifier: createCodeVerifier(),
    tokenStore: createFileTokenStore(env.tokenPath),
    clientKey: env.clientKey,
    clientSecret: env.clientSecret,
    redirectUri: env.redirectUri,
    hasSettled: false,
  };
  holder.session = session;
  return session;
}

function receiveRequest(session: CallbackSession, request: IncomingMessage, response: ServerResponse): void {
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

function replyThenClose(session: CallbackSession, response: ServerResponse, outcome: PageOutcome): void {
  response.writeHead(outcome.statusCode, {'Content-Type': 'text/plain; charset=utf-8'});
  // Close only after the body is flushed. Ending the process before that drops the page.
  response.end(outcome.body, () => {
    clearTimeout(session.timeout);
    session.server.close();
    process.exitCode = outcome.exitCode;
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

function exchangeAuthCode(session: CallbackSession, code: string): ReturnType<typeof exchangeCode> {
  return exchangeCode(
    {
      clientKey: session.clientKey,
      clientSecret: session.clientSecret,
      code,
      redirectUri: session.redirectUri,
      codeVerifier: session.codeVerifier,
    },
    fetch,
  );
}

async function writeCallbackResult(session: CallbackSession, requestUrl: URL, response: ServerResponse): Promise<void> {
  const result = await handleAuthCallback(requestUrl, {
    expectedState: session.state,
    exchangeCode: (code) => exchangeAuthCode(session, code),
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

async function finishCallback(session: CallbackSession, requestUrl: URL, response: ServerResponse): Promise<void> {
  clearTimeout(session.timeout);
  try {
    await writeCallbackResult(session, requestUrl, response);
  } catch {
    // A rejection can quote the code or client secret. Keep the terminal line fixed.
    console.error('tiktok-auth: authorization failed');
    closeAfterFailure(session, response);
  }
}

function closeAfterFailure(session: CallbackSession, response: ServerResponse): void {
  if (!response.writableEnded) {
    replyThenClose(session, response, {statusCode: 500, body: 'Authorization failed. See the terminal.', exitCode: 1});
    return;
  }
  session.server.close();
  process.exitCode = 1;
}

function openAuthorizePage(session: CallbackSession): void {
  const authorizeUrl = buildAuthorizeUrl({
    clientKey: session.clientKey,
    redirectUri: session.redirectUri,
    state: session.state,
    codeChallenge: toCodeChallenge(session.codeVerifier),
  });
  console.log(`Open this URL in your browser:\n${authorizeUrl}`);
  // The default browser may not hold the creator's TikTok session; TIKTOK_AUTH_BROWSER picks the app (e.g. Safari).
  const browserApp = process.env.TIKTOK_AUTH_BROWSER;
  const openArgs = browserApp ? ['-a', browserApp, authorizeUrl] : [authorizeUrl];
  execFile('open', openArgs, (error) => {
    if (error) console.error('tiktok-auth: could not open the browser; use the URL above.');
  });
}

async function main(): Promise<void> {
  const env = readEnv();
  console.log(`TikTok environment: ${env.environment}`);
  const session = createSession(env);
  listeningServer = session.server;
  await listen(session.server, session.redirectUrl);
  openAuthorizePage(session);
}

await main();
