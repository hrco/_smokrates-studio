process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {existsSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {canPublish, draftRecordPath, markPublished, readDraftRecord, writeDraftRecord} from '../src/instagram/draftRecord';
import {fetchPermalink, publishContainer} from '../src/instagram/reels';
import {createFileTokenStore, resolveAccessToken} from '../src/instagram/token';
import type {InstagramError} from '../src/instagram/types';

const USAGE = 'usage: instagram-publish <path-to-mp4>';
const AI_LABEL_NOTE =
  "Meta's API has no AI-label flag. Set the label by hand now: open the Reel > Edit > Advanced settings > AI label.";

function exitWithError(message: string): never {
  console.error(`instagram-publish: ${message}`);
  process.exit(1);
}

function exitWithInstagramError(error: InstagramError): never {
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

async function main(): Promise<void> {
  const videoPath = await readVideoPathArg();
  if (existsSync('.env')) process.loadEnvFile('.env');

  const recordPath = draftRecordPath(videoPath);
  const record = await readDraftRecord(recordPath);
  if (!record) return exitWithError(`no draft record ${recordPath}; run npm run instagram:draft -- ${videoPath}`);
  const decision = canPublish(record, Date.now());
  if (!decision.isAllowed) return exitWithError(decision.reason);

  const tokenResult = await resolveAccessToken(createFileTokenStore(), process.env, Date.now());
  if (!tokenResult.ok) return exitWithInstagramError(tokenResult.error);
  const {accessToken, isExpiringSoon, expiresAt} = tokenResult.value;
  if (isExpiringSoon) console.warn(`warning: token expires ${expiresAt}; run npm run instagram:refresh`);

  const published = await publishContainer({accessToken, userId: record.userId, containerId: record.containerId}, fetch);
  if (!published.ok) return exitWithInstagramError(published.error);
  const {mediaId} = published.value;
  console.log(`media id: ${mediaId}`);

  const permalinkResult = await fetchPermalink({accessToken, mediaId}, fetch);
  if (!permalinkResult.ok) {
    await writeDraftRecord(recordPath, {...record, publishedMediaId: mediaId});
    return exitWithInstagramError(permalinkResult.error);
  }
  const {permalink} = permalinkResult.value;
  await writeDraftRecord(recordPath, markPublished(record, {mediaId, permalink}));
  console.log(`published: ${permalink}`);
  console.log(`\n${AI_LABEL_NOTE}`);
}

await main();
