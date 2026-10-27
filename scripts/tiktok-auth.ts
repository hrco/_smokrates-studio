import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createServer, type Server} from 'node:http';
import path from 'node:path';
import {type AuthRequestSession, receiveAuthRequest, reportUnhandledAuthRejection} from '../src/tiktok/authRequest';
import {readTikTokCredentials} from '../src/tiktok/credentials';
import {buildAuthorizeUrl, exchangeCode} from '../src/tiktok/oauth';
import {createCodeVerifier, toCodeChallenge} from '../src/tiktok/pkce';
import {createFileTokenStore, DEFAULT_TOKEN_PATH} from '../src/tiktok/tokenStore';

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:8723/callback/';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

type AuthEnv = {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  tokenPath: string;
  environment: string;
};

type CallbackSession = AuthRequestSession & {
  codeVerifier: string;
  clientKey: string;
  redirectUri: string;
};

let listeningServer: Server | undefined;

process.on('unhandledRejection', (reason) => {
  reportUnhandledAuthRejection(reason, listeningServer, (exitCode) => {
    process.exitCode = exitCode;
  });
});

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
  const codeVerifier = createCodeVerifier();
  const holder: {session?: CallbackSession} = {};
  const server = createServer((request, response) => {
    const session = holder.session;
    if (!session) return;
    receiveAuthRequest(session, request, response);
  });
  const timeout = armAuthTimeout(server);
  const session: CallbackSession = {
    server,
    timeout,
    redirectUrl,
    expectedState: randomBytes(16).toString('hex'),
    codeVerifier,
    tokenStore: createFileTokenStore(env.tokenPath),
    clientKey: env.clientKey,
    clientSecret: env.clientSecret,
    redirectUri: env.redirectUri,
    hasSettled: false,
    exchangeCode: (code) =>
      exchangeCode(
        {
          clientKey: env.clientKey,
          clientSecret: env.clientSecret,
          code,
          redirectUri: env.redirectUri,
          codeVerifier,
        },
        fetch,
      ),
    onFinished(exitCode) {
      process.exitCode = exitCode;
    },
  };
  holder.session = session;
  return session;
}

function openAuthorizePage(session: CallbackSession): void {
  const authorizeUrl = buildAuthorizeUrl({
    clientKey: session.clientKey,
    redirectUri: session.redirectUri,
    state: session.expectedState,
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
