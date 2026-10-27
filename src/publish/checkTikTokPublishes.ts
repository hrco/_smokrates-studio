import type {DatabaseSync} from 'node:sqlite';
import type {PublishStatusReport} from '../tiktok/inboxUpload';
import type {TikTokError, TikTokResult} from '../tiktok/types';
import {
  STALLED_AFTER_MS,
  listProcessingTikTokPublishes,
  markTikTokPublish,
  type ProcessingTikTokPublish,
} from './tiktokPublishLedger';

export type CheckTikTokPublishesOptions = {
  db: DatabaseSync;
  nowMs: number;
  fetchStatus: (publishId: string) => Promise<TikTokResult<PublishStatusReport>>;
};

export type CheckTikTokPublishesSummary = {
  sent: number;
  failed: number;
  stalled: number;
  stillProcessing: number;
  statusErrors: TikTokError[];
};

type Outcome = 'sent' | 'failed' | 'stalled' | 'stillProcessing';

function decideWhenUndelivered(publish: ProcessingTikTokPublish, nowMs: number): Outcome {
  return nowMs - publish.createdAtMs > STALLED_AFTER_MS ? 'stalled' : 'stillProcessing';
}

/**
 * Settles every processing TikTok publish row with at most one status fetch per row. Never re-inits a share.
 * A row older than 30 minutes that is not delivered becomes stalled and is never retried.
 */
export async function checkTikTokPublishes(options: CheckTikTokPublishesOptions): Promise<CheckTikTokPublishesSummary> {
  const {db, nowMs, fetchStatus} = options;
  const summary: CheckTikTokPublishesSummary = {sent: 0, failed: 0, stalled: 0, stillProcessing: 0, statusErrors: []};

  for (const publish of listProcessingTikTokPublishes(db)) {
    const outcome = await decideOutcome(publish, options, summary.statusErrors);
    if (outcome !== 'stillProcessing') {
      markTikTokPublish(db, {publishRowId: publish.publishRowId, status: outcome, nowMs});
    }
    summary[outcome] += 1;
  }
  return summary;
}

async function decideOutcome(
  publish: ProcessingTikTokPublish,
  options: CheckTikTokPublishesOptions,
  statusErrors: TikTokError[],
): Promise<Outcome> {
  if (publish.publishId === null) return decideWhenUndelivered(publish, options.nowMs);

  let report: TikTokResult<PublishStatusReport>;
  try {
    report = await options.fetchStatus(publish.publishId);
  } catch (error) {
    report = {
      ok: false,
      error: {
        operation: 'fetch-publish-status',
        code: 'fetch-threw',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
  if (!report.ok) {
    statusErrors.push(report.error);
    return decideWhenUndelivered(publish, options.nowMs);
  }
  const {status} = report.value;
  if (status === 'SEND_TO_USER_INBOX' || status === 'PUBLISH_COMPLETE') return 'sent';
  if (status === 'FAILED') return 'failed';
  return decideWhenUndelivered(publish, options.nowMs);
}
