import type {DatabaseSync} from 'node:sqlite';
import type {CheckTikTokPublishesSummary} from './checkTikTokPublishes';
import type {SendEpisodeToTikTokResult} from './sendEpisodeToTikTok';
import {beginSendJob, finishSendJob} from './tickSelection';

export type RunTickOptions = {
  db: DatabaseSync;
  nowMs: number;
  newId: () => string;
  /** Settles processing TikTok rows before any new send. The daemon wires this to checkTikTokPublishes. */
  checkPublishes: () => Promise<CheckTikTokPublishesSummary>;
  /** Sends one episode. The daemon wires this to sendEpisodeToTikTok. Tests pass a fake. */
  sendEpisode: (episodeId: string) => Promise<SendEpisodeToTikTokResult>;
};

export type RunTickResult =
  | {kind: 'sent'; jobId: string; episodeId: string; publishId: string}
  | {kind: 'failed'; jobId: string; episodeId: string; message: string}
  | {kind: 'share-cap-reached'; jobId: string; episodeId: string; inFlightShares: number}
  | {kind: 'busy'}
  | {kind: 'idle'; reason: 'nothing-due' | 'already-sent-today'};

type ReadySend = {db: DatabaseSync; nowMs: number; jobId: string; episodeId: string};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureMessage(result: Exclude<SendEpisodeToTikTokResult, {kind: 'sent-to-tiktok'}>): string {
  if (result.kind === 'share-cap-reached') return `TikTok already has ${result.inFlightShares} shares in flight.`;
  if (result.kind === 'already-claimed') return `This night is already ${result.status} with TikTok.`;
  return `TikTok upload failed (${result.error.operation} ${result.error.code}).`;
}

function recordSendResult(ready: ReadySend, sent: SendEpisodeToTikTokResult): RunTickResult {
  const {db, nowMs, jobId, episodeId} = ready;
  if (sent.kind === 'sent-to-tiktok') {
    finishSendJob(db, {jobId, status: 'succeeded', message: null, nowMs});
    return {kind: 'sent', jobId, episodeId, publishId: sent.publishId};
  }
  const message = failureMessage(sent);
  finishSendJob(db, {jobId, status: 'failed', message, nowMs});
  if (sent.kind === 'share-cap-reached') {
    return {kind: 'share-cap-reached', jobId, episodeId, inFlightShares: sent.inFlightShares};
  }
  return {kind: 'failed', jobId, episodeId, message};
}

async function completeSend(ready: ReadySend, sendEpisode: RunTickOptions['sendEpisode']): Promise<RunTickResult> {
  try {
    return recordSendResult(ready, await sendEpisode(ready.episodeId));
  } catch (error) {
    const message = describeError(error);
    finishSendJob(ready.db, {jobId: ready.jobId, status: 'failed', message, nowMs: ready.nowMs});
    return {kind: 'failed', jobId: ready.jobId, episodeId: ready.episodeId, message};
  }
}

/**
 * One launchd tick. Checks processing publishes first, then sends at most one approved episode
 * whose time has come, whose plan is approved, that has a render and no publish row.
 * At most one new publish row per Europe/Ljubljana day. A share cap or a failed upload is a result,
 * the job is marked failed, and no other episode is sent. The next tick tries again.
 */
export async function runTick(options: RunTickOptions): Promise<RunTickResult> {
  await options.checkPublishes();
  const begun = beginSendJob(options.db, {nowMs: options.nowMs, newId: options.newId});
  if (begun.kind !== 'ready') return begun;
  return completeSend(
    {db: options.db, nowMs: options.nowMs, jobId: begun.jobId, episodeId: begun.episodeId},
    options.sendEpisode,
  );
}
