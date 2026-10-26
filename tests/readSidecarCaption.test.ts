import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {readSidecarCaption} from '../src/publish/readSidecarCaption';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'sidecar-caption-'));
});

afterEach(async () => {
  await rm(tempDir, {recursive: true, force: true});
});

describe('readSidecarCaption', () => {
  it('returns the caption from the sidecar next to the mp4', async () => {
    const videoPath = path.join(tempDir, '2026-10-14-golden-hour.mp4');
    await writeFile(videoPath.replace(/\.mp4$/, '.json'), JSON.stringify({caption: 'Golden Hour\n\n#smokrates'}));

    expect(await readSidecarCaption(videoPath)).toBe('Golden Hour\n\n#smokrates');
  });

  it('matches a sidecar when the video extension is uppercase', async () => {
    const videoPath = path.join(tempDir, 'clip.MP4');
    await writeFile(path.join(tempDir, 'clip.json'), JSON.stringify({caption: 'paste me'}));

    expect(await readSidecarCaption(videoPath)).toBe('paste me');
  });

  it('returns undefined when the sidecar is missing', async () => {
    expect(await readSidecarCaption(path.join(tempDir, 'missing.mp4'))).toBeUndefined();
  });

  it('returns undefined when caption is not a string', async () => {
    const videoPath = path.join(tempDir, 'clip.mp4');
    await writeFile(path.join(tempDir, 'clip.json'), JSON.stringify({caption: 12}));
    expect(await readSidecarCaption(videoPath)).toBeUndefined();
  });

  it('returns undefined for a JSON array', async () => {
    const videoPath = path.join(tempDir, 'clip.mp4');
    await writeFile(path.join(tempDir, 'clip.json'), '[]');
    expect(await readSidecarCaption(videoPath)).toBeUndefined();
  });

  it('rejects invalid JSON instead of looking like a missing caption', async () => {
    const videoPath = path.join(tempDir, 'clip.mp4');
    await writeFile(path.join(tempDir, 'clip.json'), '{not json');
    await expect(readSidecarCaption(videoPath)).rejects.toThrow(SyntaxError);
  });
});
