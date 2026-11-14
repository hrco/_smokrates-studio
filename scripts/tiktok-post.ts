process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {existsSync} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {readTikTokCredentials} from '../src/tiktok/credentials';
import {DEFAULT_PRIVACY, directPostVideo} from '../src/tiktok/directPost';
import {fetchPublishStatus} from '../src/tiktok/inboxUpload';
import {refreshAccessToken} from '../src/tiktok/oauth';
import {createFileTokenStore, DEFAULT_TOKEN_PATH, getValidAccessToken} from '../src/tiktok/tokenStore';
import type {TikTokError} from '../src/tiktok/types';

const USAGE = `usage: tiktok-post <path-to-mp4> --caption <text> [--privacy ${DEFAULT_PRIVACY}]`;
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 61;

function exitWithError(message: string): never {
  console.error(`tiktok-post: ${message}`);
  process.exit(1);
}

function exitWithTikTokError(error: TikTokError): never {
  return exitWithError(`${error.operation}: ${error.code} ${error.detail}`);
}

async function readArgs(): Promise<{videoPath: string; caption: string; privacyLevel: string}> {
  const {values, positionals} = parseArgs({
    allowPositionals: true,
    options: {caption: {type: 'string'}, privacy: {type: 'string'}},
  });
  const [videoPath] = positionals;
  if (!videoPath || positionals.length > 1 || !values.caption) exitWithError(USAGE);
  if (path.extname(videoPath).toLowerCase() !== '.mp4') exitWithError(`not an .mp4 file: ${videoPath}\n${USAGE}`);
  const isFile = await stat(videoPath).then((info) => info.isFile(), () => false);
  if (!isFile) exitWithError(`file not found: ${videoPath}`);
  return {videoPath, caption: values.caption, privacyLevel: values.privacy ?? DEFAULT_PRIVACY};
}

function readClientCredentials(): {clientKey: string; clientSecret: string; tokenPath: string; environment: string} {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const credentials = readTikTokCredentials(process.env);
  if (!credentials.ok) exitWithError(`missing env: ${credentials.missingNames.join(', ')} (see .env.example)`);
  const {clientKey, clientSecret, environment, tokenFileName} = credentials.value;
  return {clientKey, clientSecret, environment, tokenPath: path.join(path.dirname(DEFAULT_TOKEN_PATH), tokenFileName)};
}

function sleepForMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const {videoPath, caption, privacyLevel} = await readArgs();
  const {clientKey, clientSecret, tokenPath, environment} = readClientCredentials();
  console.log(`TikTok environment: ${environment}, privacy: ${privacyLevel}`);

  const tokenResult = await getValidAccessToken(
    createFileTokenStore(tokenPath),
    (refreshToken) => refreshAccessToken({clientKey, clientSecret, refreshToken}, fetch),
    Date.now(),
  );
  if (!tokenResult.ok) return exitWithTikTokError(tokenResult.error);
  const accessToken = tokenResult.value;

  const videoBytes = await readFile(videoPath);
  const posted = await directPostVideo({accessToken, videoBytes, caption, privacyLevel}, fetch);
  if (!posted.ok) return exitWithTikTokError(posted.error);
  const {publishId} = posted.value;
  console.log(`publish_id: ${publishId}`);

  for (let poll = 1; poll <= MAX_POLLS; poll += 1) {
    const report = await fetchPublishStatus({accessToken, publishId}, fetch);
    if (!report.ok) return exitWithTikTokError(report.error);
    const {status, failReason} = report.value;
    console.log(`status: ${status}`);
    if (status === 'PUBLISH_COMPLETE') return;
    if (status === 'FAILED') return exitWithError(`publish failed: ${failReason ?? 'no fail_reason given'}`);
    await sleepForMs(POLL_INTERVAL_MS);
  }
  exitWithError(`no PUBLISH_COMPLETE within ${(MAX_POLLS * POLL_INTERVAL_MS) / 1000} s; check with npm run tiktok:status`);
}

await main();
