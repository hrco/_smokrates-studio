process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {existsSync} from 'node:fs';
import path from 'node:path';
import {readTikTokCredentials} from '../src/tiktok/credentials';
import {fetchPublishStatus} from '../src/tiktok/inboxUpload';
import {refreshAccessToken} from '../src/tiktok/oauth';
import {createFileTokenStore, DEFAULT_TOKEN_PATH, getValidAccessToken} from '../src/tiktok/tokenStore';

const USAGE = 'usage: tiktok-status <publish_id>';

function exitWithError(message: string): never {
  console.error(`tiktok-status: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const publishId = process.argv[2];
  if (!publishId || process.argv.length > 3) exitWithError(USAGE);

  if (existsSync('.env')) process.loadEnvFile('.env');
  const credentials = readTikTokCredentials(process.env);
  if (!credentials.ok) exitWithError(`missing env: ${credentials.missingNames.join(', ')} (see .env.example)`);
  const {clientKey, clientSecret, environment, tokenFileName} = credentials.value;
  console.log(`TikTok environment: ${environment}`);

  const tokenStore = createFileTokenStore(path.join(path.dirname(DEFAULT_TOKEN_PATH), tokenFileName));
  const token = await getValidAccessToken(
    tokenStore,
    (refreshToken) => refreshAccessToken({clientKey, clientSecret, refreshToken}, fetch),
    Date.now(),
  );
  if (!token.ok) exitWithError(`${token.error.operation}: ${token.error.code} ${token.error.detail}`);

  const status = await fetchPublishStatus({accessToken: token.value, publishId}, fetch);
  if (!status.ok) exitWithError(`${status.error.operation}: ${status.error.code} ${status.error.detail}`);
  console.log(`publish_id: ${publishId}`);
  console.log(`status: ${status.value.status}`);
}

await main();
