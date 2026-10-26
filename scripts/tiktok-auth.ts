process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createServer, type Server, type ServerResponse} from 'node:http';
import path from 'node:path';
import {readTikTokCredentials} from '../src/tiktok/credentials';
import {buildAuthorizeUrl, exchangeCode} from '../src/tiktok/oauth';
import {createCodeVerifier, toCodeChallenge} from '../src/tiktok/pkce';
import {createFileTokenStore, DEFAULT_TOKEN_PATH} from '../src/tiktok/tokenStore';

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:8723/callback/';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

function exitWithError(message: string): never {
  console.error(`tiktok-auth: ${message}`);
  process.exit(1);
}

function readEnv(): {clientKey: string; clientSecret: string; redirectUri: string; tokenPath: string; environment: string} {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const credentials = readTikTokCredentials(process.env);
  if (!credentials.ok) exitWithError(`missing env: ${credentials.missingNames.join(', ')} (see .env.example)`);
  const {clientKey, clientSecret, environment, tokenFileName} = credentials.value;
  const tokenPath = path.join(path.dirname(DEFAULT_TOKEN_PATH), tokenFileName);
  return {clientKey, clientSecret, environment, tokenPath, redirectUri: process.env.TIKTOK_REDIRECT_URI || DEFAULT_REDIRECT_URI};
}

function replyWithText(response: ServerResponse, statusCode: number, text: string): void {
  response.writeHead(statusCode, {'Content-Type': 'text/plain; charset=utf-8'});
  response.end(text);
}

function listen(server: Server, redirectUrl: URL): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(redirectUrl.port), redirectUrl.hostname, resolve);
  });
}

async function main(): Promise<void> {
  const {clientKey, clientSecret, redirectUri, tokenPath, environment} = readEnv();
  console.log(`TikTok environment: ${environment}`);
  const redirectUrl = new URL(redirectUri);
  const state = randomBytes(16).toString('hex');
  const codeVerifier = createCodeVerifier();
  const tokenStore = createFileTokenStore(tokenPath);

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', redirectUrl);
    if (requestUrl.pathname !== redirectUrl.pathname) return replyWithText(response, 404, 'Not found.');

    void handleCallback(requestUrl, response);
  });

  async function handleCallback(requestUrl: URL, response: ServerResponse): Promise<void> {
    if (requestUrl.searchParams.get('state') !== state) {
      return replyWithText(response, 400, 'State mismatch. Request rejected.');
    }
    const errorParam = requestUrl.searchParams.get('error');
    if (errorParam) {
      replyWithText(response, 400, `Authorization failed: ${errorParam}`);
      return exitWithError(`authorization denied: ${errorParam} ${requestUrl.searchParams.get('error_description') ?? ''}`);
    }
    const code = requestUrl.searchParams.get('code');
    if (!code) return replyWithText(response, 400, 'Missing code.');

    const exchanged = await exchangeCode({clientKey, clientSecret, code, redirectUri, codeVerifier}, fetch);
    if (!exchanged.ok) {
      replyWithText(response, 500, 'Token exchange failed. See the terminal.');
      const {operation, code: errorCode, detail} = exchanged.error;
      return exitWithError(`${operation}: ${errorCode} ${detail}`);
    }
    await tokenStore.save(exchanged.value);
    replyWithText(response, 200, 'Authorized. You can close this tab.');
    console.log(`Authorized for scopes: ${exchanged.value.scope}`);
    server.close();
    process.exit(0);
  }

  await listen(server, redirectUrl);
  setTimeout(() => exitWithError('timed out after 5 minutes without a callback'), AUTH_TIMEOUT_MS).unref();

  const authorizeUrl = buildAuthorizeUrl({
    clientKey,
    redirectUri,
    state,
    codeChallenge: toCodeChallenge(codeVerifier),
  });
  console.log(`Open this URL in your browser:\n${authorizeUrl}`);
  // The default browser may not hold the creator's TikTok session; TIKTOK_AUTH_BROWSER picks the app (e.g. Safari).
  const browserApp = process.env.TIKTOK_AUTH_BROWSER;
  const openArgs = browserApp ? ['-a', browserApp, authorizeUrl] : [authorizeUrl];
  execFile('open', openArgs, (error) => {
    if (error) console.error('tiktok-auth: could not open the browser; use the URL above.');
  });
}

await main();
