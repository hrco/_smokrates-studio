process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {existsSync} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {readTikTokCredentials} from '../src/tiktok/credentials';
import {refreshAccessToken} from '../src/tiktok/oauth';
import {fetchPublishStatus, uploadVideoToInbox, waitForInboxDelivery} from '../src/tiktok/inboxUpload';
import {createFileTokenStore, DEFAULT_TOKEN_PATH, getValidAccessToken} from '../src/tiktok/tokenStore';
import {isRecord, type TikTokError} from '../src/tiktok/types';

const USAGE = 'usage: tiktok-upload-draft <path-to-mp4>';
const CAPTION_HINT =
  'Inbox drafts take no caption: open TikTok > Inbox notification > edit, paste this caption, turn on AI-generated content, then Post.';

function exitWithError(message: string): never {
  console.error(`tiktok-upload-draft: ${message}`);
  process.exit(1);
}

function exitWithTikTokError(error: TikTokError): never {
  return exitWithError(`${error.operation}: ${error.code} ${error.detail}`);
}

async function readVideoPathArg(): Promise<string> {
  const videoPath = process.argv[2];
  if (!videoPath || process.argv.length > 3) exitWithError(USAGE);
  if (path.extname(videoPath).toLowerCase() !== '.mp4') exitWithError(`not an .mp4 file: ${videoPath}\n${USAGE}`);
  const isFile = await stat(videoPath).then((info) => info.isFile(), () => false);
  if (!isFile) exitWithError(`file not found: ${videoPath}`);
  return videoPath;
}

function readClientCredentials(): {clientKey: string; clientSecret: string; tokenPath: string; environment: string} {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const credentials = readTikTokCredentials(process.env);
  if (!credentials.ok) exitWithError(`missing env: ${credentials.missingNames.join(', ')} (see .env.example)`);
  const {clientKey, clientSecret, environment, tokenFileName} = credentials.value;
  return {clientKey, clientSecret, environment, tokenPath: path.join(path.dirname(DEFAULT_TOKEN_PATH), tokenFileName)};
}

async function readCaption(videoPath: string): Promise<string | undefined> {
  const sidecarPath = videoPath.replace(/\.mp4$/i, '.json');
  const sidecar: unknown = await readFile(sidecarPath, 'utf8').then(
    (text) => JSON.parse(text),
    () => undefined,
  );
  if (!isRecord(sidecar) || typeof sidecar.caption !== 'string') return undefined;
  return sidecar.caption;
}

async function main(): Promise<void> {
  const videoPath = await readVideoPathArg();
  const {clientKey, clientSecret, tokenPath, environment} = readClientCredentials();
  console.log(`TikTok environment: ${environment}`);

  const tokenResult = await getValidAccessToken(
    createFileTokenStore(tokenPath),
    (refreshToken) => refreshAccessToken({clientKey, clientSecret, refreshToken}, fetch),
    Date.now(),
  );
  if (!tokenResult.ok) return exitWithTikTokError(tokenResult.error);
  const accessToken = tokenResult.value;

  const videoBytes = await readFile(videoPath);
  const uploaded = await uploadVideoToInbox({accessToken, videoBytes}, fetch);
  if (!uploaded.ok) return exitWithTikTokError(uploaded.error);
  const {publishId} = uploaded.value;
  console.log(`publish_id: ${publishId}`);

  const delivered = await waitForInboxDelivery({accessToken, publishId}, fetch);
  if (!delivered.ok) {
    const lastStatus = await fetchPublishStatus({accessToken, publishId}, fetch);
    if (lastStatus.ok) console.error(`last status: ${lastStatus.value.status}`);
    return exitWithTikTokError(delivered.error);
  }
  console.log(`status: ${delivered.value.status}`);

  const caption = await readCaption(videoPath);
  if (caption === undefined) return console.log('No caption found in the sidecar JSON next to the video.');
  console.log(`\n${CAPTION_HINT}\n\n${caption}`);
}

await main();
