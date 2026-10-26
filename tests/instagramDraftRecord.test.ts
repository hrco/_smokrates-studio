import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  canCreateDraft,
  canPublish,
  createDraftRecord,
  draftRecordPath,
  markPublished,
  readDraftRecord,
  writeDraftRecord,
} from '../src/instagram/draftRecord';

const createdAtMs = Date.parse('2026-10-14T10:00:00.000Z');
const record = createDraftRecord({containerId: 'c1', userId: '178', username: 'smokrates', nowMs: createdAtMs});
const hourMs = 60 * 60 * 1000;

describe('createDraftRecord', () => {
  it('expires 24 hours after creation', () => {
    expect(record.createdAt).toBe('2026-10-14T10:00:00.000Z');
    expect(record.expiresAt).toBe('2026-10-15T10:00:00.000Z');
  });
});

describe('draftRecordPath', () => {
  it('sits next to the video', () => {
    expect(draftRecordPath('out/2026-10-14-night.mp4')).toBe('out/2026-10-14-night.instagram.json');
  });

  it('matches an uppercase extension', () => {
    expect(draftRecordPath('out/Night.MP4')).toBe('out/Night.instagram.json');
  });
});

describe('canPublish', () => {
  it('allows a fresh unpublished record', () => {
    expect(canPublish(record, createdAtMs + hourMs)).toEqual({isAllowed: true});
  });

  it('refuses an expired record', () => {
    expect(canPublish(record, createdAtMs + 25 * hourMs)).toEqual({
      isAllowed: false,
      reason: 'container expired; run instagram:draft again',
    });
  });

  it('refuses a published record and names the permalink', () => {
    const published = markPublished(record, {mediaId: 'm1', permalink: 'https://www.instagram.com/reel/abc/'});
    expect(canPublish(published, createdAtMs + hourMs)).toEqual({
      isAllowed: false,
      reason: 'already published as https://www.instagram.com/reel/abc/; never post twice',
    });
  });

  it('refuses a published record even after it expired', () => {
    const published = markPublished(record, {mediaId: 'm1', permalink: 'https://www.instagram.com/reel/abc/'});
    const decision = canPublish(published, createdAtMs + 48 * hourMs);
    expect(!decision.isAllowed && decision.reason).toContain('never post twice');
  });

  // The publish script writes publishedMediaId before the permalink fetch. A failed fetch must still block a second post.
  it('refuses a record that only has a media id and names that id', () => {
    const published = {...record, publishedMediaId: 'm1'};
    expect(canPublish(published, createdAtMs + hourMs)).toEqual({
      isAllowed: false,
      reason: 'already published as m1; never post twice',
    });
  });

  it('allows one millisecond before expiry and refuses at the expiry instant', () => {
    const expiresAtMs = Date.parse(record.expiresAt);
    expect(canPublish(record, expiresAtMs - 1)).toEqual({isAllowed: true});
    expect(canPublish(record, expiresAtMs)).toEqual({
      isAllowed: false,
      reason: 'container expired; run instagram:draft again',
    });
  });
});

describe('canCreateDraft', () => {
  it('allows when no record exists', () => {
    expect(canCreateDraft(undefined, createdAtMs)).toEqual({isAllowed: true});
  });

  it('refuses while an unpublished record is alive', () => {
    const decision = canCreateDraft(record, createdAtMs + hourMs);
    expect(!decision.isAllowed && decision.reason).toContain('instagram:publish');
  });

  it('allows when the old record expired unpublished', () => {
    expect(canCreateDraft(record, createdAtMs + 25 * hourMs)).toEqual({isAllowed: true});
  });

  it('refuses when already published', () => {
    const published = markPublished(record, {mediaId: 'm1', permalink: 'https://www.instagram.com/reel/abc/'});
    const decision = canCreateDraft(published, createdAtMs + 48 * hourMs);
    expect(!decision.isAllowed && decision.reason).toContain('never post twice');
  });

  it('refuses a media-id-only record even after the container would have expired', () => {
    const published = {...record, publishedMediaId: 'm1'};
    const decision = canCreateDraft(published, createdAtMs + 48 * hourMs);
    expect(decision).toEqual({isAllowed: false, reason: 'already published as m1; never post twice'});
  });

  it('allows a new draft at the exact expiry instant and refuses one millisecond earlier', () => {
    const expiresAtMs = Date.parse(record.expiresAt);
    expect(canCreateDraft(record, expiresAtMs - 1).isAllowed).toBe(false);
    expect(canCreateDraft(record, expiresAtMs)).toEqual({isAllowed: true});
  });
});

describe('record file', () => {
  it('round-trips, and reads undefined when missing', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'ig-record-'));
    try {
      const recordPath = path.join(folder, 'night.instagram.json');
      expect(await readDraftRecord(recordPath)).toBeUndefined();
      await writeDraftRecord(recordPath, record);
      expect(await readDraftRecord(recordPath)).toEqual(record);
    } finally {
      await rm(folder, {recursive: true});
    }
  });

  it('round-trips a published record that has a media id and no permalink', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'ig-record-'));
    try {
      const recordPath = path.join(folder, 'night.instagram.json');
      const published = {...record, publishedMediaId: 'm1'};
      await writeDraftRecord(recordPath, published);
      const loaded = await readDraftRecord(recordPath);
      expect(loaded).toEqual(published);
      expect(loaded && canPublish(loaded, createdAtMs + hourMs)).toEqual({
        isAllowed: false,
        reason: 'already published as m1; never post twice',
      });
    } finally {
      await rm(folder, {recursive: true});
    }
  });

  it('rejects invalid JSON and records that are not the expected shape', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'ig-record-'));
    try {
      const invalidJson = path.join(folder, 'bad.instagram.json');
      await writeFile(invalidJson, '{');
      await expect(readDraftRecord(invalidJson)).rejects.toThrow(SyntaxError);

      const empty = path.join(folder, 'empty.instagram.json');
      await writeFile(empty, '{}\n');
      await expect(readDraftRecord(empty)).rejects.toThrow(/unexpected shape/);

      const blankMediaId = path.join(folder, 'blank.instagram.json');
      await writeFile(blankMediaId, `${JSON.stringify({...record, publishedMediaId: ''})}\n`);
      await expect(readDraftRecord(blankMediaId)).rejects.toThrow(/unexpected shape/);

      await expect(readDraftRecord(folder)).rejects.toThrow();
    } finally {
      await rm(folder, {recursive: true});
    }
  });
});
