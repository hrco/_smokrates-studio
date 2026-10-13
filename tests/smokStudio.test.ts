import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {findTrackDirBySlug, loadTrack} from '../src/assets/smokStudio';

const validSong = {
  artist: 'Smokrates',
  number: 1,
  title: 'Golden Hour Groove',
  slug: 'golden-hour-groove',
  theme: 'Warm golden-hour funky dub.',
  status: 'done',
};

let rootDir: string;

async function createTrackDir(name: string, files: Record<string, string | object>): Promise<string> {
  const trackDir = path.join(rootDir, name);
  await mkdir(trackDir, {recursive: true});
  for (const [fileName, content] of Object.entries(files)) {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    await writeFile(path.join(trackDir, fileName), text);
  }
  return trackDir;
}

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'smok-studio-'));
});

afterEach(async () => {
  await rm(rootDir, {recursive: true, force: true});
});

describe('loadTrack', () => {
  it('loads a valid track with a single named mp3', async () => {
    const trackDir = await createTrackDir('t01', {
      'song.json': validSong,
      'cover.png': '',
      'Golden Hour Groove.mp3': '',
      'clip.mp4': '',
    });
    const result = await loadTrack(trackDir);
    expect(result).toEqual({
      ok: true,
      track: {
        artist: 'Smokrates',
        title: 'Golden Hour Groove',
        slug: 'golden-hour-groove',
        theme: 'Warm golden-hour funky dub.',
        trackDir,
        coverPath: path.join(trackDir, 'cover.png'),
        audioPath: path.join(trackDir, 'Golden Hour Groove.mp3'),
      },
    });
  });

  it('prefers track.mp3 over other audio files', async () => {
    const trackDir = await createTrackDir('t01', {
      'song.json': validSong,
      'cover.png': '',
      'track.mp3': '',
      'Other.mp3': '',
    });
    const result = await loadTrack(trackDir);
    expect(result.ok && result.track.audioPath).toBe(path.join(trackDir, 'track.mp3'));
  });

  it('reports missing song.json', async () => {
    const trackDir = await createTrackDir('t01', {'cover.png': '', 'track.mp3': ''});
    const result = await loadTrack(trackDir);
    expect(!result.ok && result.error.code).toBe('missing-song-json');
  });

  it('reports invalid JSON', async () => {
    const trackDir = await createTrackDir('t01', {'song.json': '{not json', 'cover.png': '', 'track.mp3': ''});
    const result = await loadTrack(trackDir);
    expect(!result.ok && result.error.code).toBe('invalid-song-json');
  });

  it('reports a missing required field', async () => {
    const {theme: _theme, ...songWithoutTheme} = validSong;
    const trackDir = await createTrackDir('t01', {
      'song.json': songWithoutTheme,
      'cover.png': '',
      'track.mp3': '',
    });
    const result = await loadTrack(trackDir);
    expect(!result.ok && result.error.code).toBe('invalid-song-json');
    expect(!result.ok && result.error.detail).toContain('theme');
  });

  it('reports missing audio', async () => {
    const trackDir = await createTrackDir('t01', {'song.json': validSong, 'cover.png': '', 'clip.mp4': ''});
    const result = await loadTrack(trackDir);
    expect(!result.ok && result.error.code).toBe('missing-audio');
  });

  it('reports ambiguous audio', async () => {
    const trackDir = await createTrackDir('t01', {
      'song.json': validSong,
      'cover.png': '',
      'a.mp3': '',
      'b.wav': '',
    });
    const result = await loadTrack(trackDir);
    expect(!result.ok && result.error.code).toBe('ambiguous-audio');
  });

  it('reports missing cover', async () => {
    const trackDir = await createTrackDir('t01', {'song.json': validSong, 'track.mp3': ''});
    const result = await loadTrack(trackDir);
    expect(!result.ok && result.error.code).toBe('missing-cover');
  });
});

describe('findTrackDirBySlug', () => {
  it('finds the directory whose song.json slug matches', async () => {
    await createTrackDir('t00-broken', {'song.json': '{oops'});
    const wantedDir = await createTrackDir('t01', {'song.json': validSong});
    await createTrackDir('t02', {'song.json': {...validSong, slug: 'other'}});
    expect(await findTrackDirBySlug(rootDir, 'golden-hour-groove')).toBe(wantedDir);
  });

  it('returns undefined when no slug matches', async () => {
    await createTrackDir('t01', {'song.json': validSong});
    expect(await findTrackDirBySlug(rootDir, 'nope')).toBeUndefined();
  });
});
