import {readFile, writeFile} from 'node:fs/promises';
import {isNonEmptyString, isRecord} from './types';

export const CONTAINER_LIFETIME_MS = 24 * 60 * 60 * 1000;

export type DraftRecord = {
  containerId: string;
  userId: string;
  username: string;
  createdAt: string;
  expiresAt: string;
  publishedMediaId?: string;
  permalink?: string;
};

export type Decision = {isAllowed: true} | {isAllowed: false; reason: string};

export function draftRecordPath(videoPath: string): string {
  return videoPath.replace(/\.mp4$/i, '.instagram.json');
}

export function createDraftRecord(input: {
  containerId: string;
  userId: string;
  username: string;
  nowMs: number;
}): DraftRecord {
  return {
    containerId: input.containerId,
    userId: input.userId,
    username: input.username,
    createdAt: new Date(input.nowMs).toISOString(),
    expiresAt: new Date(input.nowMs + CONTAINER_LIFETIME_MS).toISOString(),
  };
}

export function markPublished(record: DraftRecord, published: {mediaId: string; permalink: string}): DraftRecord {
  return {...record, publishedMediaId: published.mediaId, permalink: published.permalink};
}

function isPublished(record: DraftRecord): boolean {
  return record.publishedMediaId !== undefined;
}

function isExpired(record: DraftRecord, nowMs: number): boolean {
  return Date.parse(record.expiresAt) <= nowMs;
}

function describePublished(record: DraftRecord): string {
  return `already published as ${record.permalink ?? record.publishedMediaId}; never post twice`;
}

export function canPublish(record: DraftRecord, nowMs: number): Decision {
  if (isPublished(record)) return {isAllowed: false, reason: describePublished(record)};
  if (isExpired(record, nowMs)) return {isAllowed: false, reason: 'container expired; run instagram:draft again'};
  return {isAllowed: true};
}

/** A new draft is allowed only when no record exists or the old unpublished container has expired. */
export function canCreateDraft(record: DraftRecord | undefined, nowMs: number): Decision {
  if (!record) return {isAllowed: true};
  if (isPublished(record)) return {isAllowed: false, reason: describePublished(record)};
  if (isExpired(record, nowMs)) return {isAllowed: true};
  return {
    isAllowed: false,
    reason: `an unpublished draft exists (container ${record.containerId}, expires ${record.expiresAt}); run npm run instagram:publish to post it`,
  };
}

function isDraftRecord(value: unknown): value is DraftRecord {
  return (
    isRecord(value) &&
    isNonEmptyString(value.containerId) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.username) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.expiresAt) &&
    (value.publishedMediaId === undefined || isNonEmptyString(value.publishedMediaId)) &&
    (value.permalink === undefined || isNonEmptyString(value.permalink))
  );
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function readDraftRecord(recordPath: string): Promise<DraftRecord | undefined> {
  let rawText: string;
  try {
    rawText = await readFile(recordPath, 'utf8');
  } catch (error) {
    if (isFileMissing(error)) return undefined;
    throw error;
  }
  const parsed: unknown = JSON.parse(rawText);
  if (!isDraftRecord(parsed)) throw new Error(`draft record ${recordPath} has an unexpected shape`);
  return parsed;
}

export async function writeDraftRecord(recordPath: string, record: DraftRecord): Promise<void> {
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
}
