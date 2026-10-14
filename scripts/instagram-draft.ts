process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {existsSync} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {canCreateDraft, createDraftRecord, draftRecordPath, readDraftRecord, writeDraftRecord} from '../src/instagram/draftRecord';
import {createReelContainer, fetchAccount, uploadReelBytes, waitForContainer} from '../src/instagram/reels';
import {createFileTokenStore, resolveAccessToken} from '../src/instagram/token';
import {isRecord, type InstagramError} from '../src/instagram/types';

const USAGE = 'usage: instagram-draft <path-to-mp4>';
const AI_LABEL_NOTE =
  "Meta's API has no AI-label flag. After publishing, set the label by hand: open the Reel > Edit > Advanced settings > AI label.";

function exitWithError(message: string): never {
  console.error(`instagram-draft: ${message}`);
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

async function readCaption(videoPath: string): Promise<string> {
  const sidecarPath = videoPath.replace(/\.mp4$/i, '.json');
  const sidecar: unknown = await readFile(sidecarPath, 'utf8').then(
    (text) => JSON.parse(text),
    () => undefined,
  );
  if (!isRecord(sidecar) || typeof sidecar.caption !== 'string' || sidecar.caption.length === 0) {
    return exitWithError(`no caption in ${sidecarPath}; Instagram needs the caption when the container is created`);
  }
  return sidecar.caption;
}

async function main(): Promise<void> {
  const videoPath = await readVideoPathArg();
  if (existsSync('.env')) process.loadEnvFile('.env');

  const recordPath = draftRecordPath(videoPath);
  const existing = await readDraftRecord(recordPath);
  const decision = canCreateDraft(existing, Date.now());
  if (!decision.isAllowed) return exitWithError(`${decision.reason}\nnext: npm run instagram:publish -- ${videoPath}`);

  const caption = await readCaption(videoPath);
  const tokenResult = await resolveAccessToken(createFileTokenStore(), process.env, Date.now());
  if (!tokenResult.ok) return exitWithInstagramError(tokenResult.error);
  const {accessToken, isExpiringSoon, expiresAt} = tokenResult.value;
  if (isExpiringSoon) console.warn(`warning: token expires ${expiresAt}; run npm run instagram:refresh`);

  const account = await fetchAccount({accessToken}, fetch);
  if (!account.ok) return exitWithInstagramError(account.error);
  const {userId, username} = account.value;

  const container = await createReelContainer({accessToken, userId, caption}, fetch);
  if (!container.ok) return exitWithInstagramError(container.error);
  const {containerId, uploadUri} = container.value;
  console.log(`container: ${containerId}`);

  const videoBytes = await readFile(videoPath);
  const uploaded = await uploadReelBytes({accessToken, uploadUri, videoBytes, containerId}, fetch);
  if (!uploaded.ok) return exitWithInstagramError(uploaded.error);

  const ready = await waitForContainer({accessToken, containerId}, fetch);
  if (!ready.ok) return exitWithInstagramError(ready.error);

  const record = createDraftRecord({containerId, userId, username, nowMs: Date.now()});
  await writeDraftRecord(recordPath, record);
  console.log(`account: @${username}`);
  console.log(`container: ${containerId} (FINISHED)`);
  console.log(`expires: ${record.expiresAt}`);
  console.log(`\nnext: npm run instagram:publish -- ${videoPath}`);
  console.log(`\n${AI_LABEL_NOTE}`);
}

await main();
