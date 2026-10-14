import {createDraftRecord, type DraftRecord} from './draftRecord';
import {createReelContainer, fetchAccount, waitForContainer, type WaitOptions} from './reels';
import {toRemotePath, type StagedVideo} from './staging';
import {failure, type FetchFn, type InstagramResult} from './types';

export type DraftFlowDeps = {
  fetchFn: FetchFn;
  stageVideo: (input: {localPath: string}) => Promise<InstagramResult<StagedVideo>>;
  unstageVideo: (input: {remoteName: string}) => Promise<InstagramResult<null>>;
  checkUrlReachable: (input: {publicUrl: string; expectedSizeBytes: number}) => Promise<InstagramResult<null>>;
  readFileSizeBytes: (path: string) => Promise<number>;
  writeDraftRecord: (path: string, record: DraftRecord) => Promise<void>;
  nowMs: () => number;
  log: (message: string) => void;
  warn: (message: string) => void;
  waitOptions?: WaitOptions;
};

export type DraftFlowInput = {
  accessToken: string;
  videoPath: string;
  caption: string;
  recordPath: string;
};

export type DraftFlowSummary = {record: DraftRecord};

/**
 * Makes an Instagram Reel draft: stages the mp4 at a public URL, lets Meta download it into a
 * container, waits for FINISHED, writes the draft record. The staged file is always removed
 * once staging succeeded. A failed removal only warns, so it never hides the original error.
 */
export async function runDraftFlow(input: DraftFlowInput, deps: DraftFlowDeps): Promise<InstagramResult<DraftFlowSummary>> {
  const {accessToken, videoPath, caption, recordPath} = input;

  const account = await fetchAccount({accessToken}, deps.fetchFn);
  if (!account.ok) return account;
  const {userId, username} = account.value;

  const staged = await deps.stageVideo({localPath: videoPath});
  if (!staged.ok) return staged;

  try {
    return await createDraftFromStagedVideo({...input, userId, username, staged: staged.value}, deps);
  } finally {
    await removeStagedVideo(staged.value, deps);
  }
}

async function createDraftFromStagedVideo(
  input: DraftFlowInput & {userId: string; username: string; staged: StagedVideo},
  deps: DraftFlowDeps,
): Promise<InstagramResult<DraftFlowSummary>> {
  const {accessToken, caption, userId, username, staged} = input;

  const expectedSizeBytes = await deps.readFileSizeBytes(input.videoPath);
  const reachable = await deps.checkUrlReachable({publicUrl: staged.publicUrl, expectedSizeBytes});
  if (!reachable.ok) return reachable;

  deps.log(`video is public at ${staged.publicUrl} while Instagram processes it; it is removed afterwards`);
  const container = await createReelContainer({accessToken, userId, caption, videoUrl: staged.publicUrl}, deps.fetchFn);
  if (!container.ok) return container;
  const {containerId} = container.value;
  deps.log(`container: ${containerId}`);

  const ready = await waitForContainer({accessToken, containerId}, deps.fetchFn, deps.waitOptions);
  if (!ready.ok) return ready;

  const record = createDraftRecord({containerId, userId, username, nowMs: deps.nowMs()});
  await deps.writeDraftRecord(input.recordPath, record);
  return {ok: true, value: {record}};
}

async function removeStagedVideo(staged: StagedVideo, deps: DraftFlowDeps): Promise<void> {
  const removal = await deps.unstageVideo({remoteName: staged.remoteName}).catch((error: unknown) =>
    failure('unstage-video', 'unexpected-error', error instanceof Error ? error.message : 'unknown error'),
  );
  if (removal.ok) {
    deps.log('staged video removed');
    return;
  }
  deps.warn(
    `could not remove the staged video; delete it by hand: ${toRemotePath(staged.remoteName)} (${removal.error.code}: ${removal.error.detail})`,
  );
}
