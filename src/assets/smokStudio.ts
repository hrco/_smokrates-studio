import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';

export type Track = {
  artist: string;
  title: string;
  slug: string;
  theme: string;
  trackDir: string;
  coverPath: string;
  audioPath: string;
};

export type LoadTrackErrorCode =
  | 'missing-song-json'
  | 'invalid-song-json'
  | 'missing-audio'
  | 'ambiguous-audio'
  | 'missing-cover';

export type LoadTrackError = {
  code: LoadTrackErrorCode;
  trackDir: string;
  detail: string;
};

export type LoadTrackResult =
  | {ok: true; track: Track}
  | {ok: false; error: LoadTrackError};

type SongFields = Pick<Track, 'artist' | 'title' | 'slug' | 'theme'>;

type ReadSongResult =
  | {ok: true; song: SongFields}
  | {ok: false; error: LoadTrackError};

const PREFERRED_AUDIO_FILE_NAME = 'track.mp3';
const AUDIO_EXTENSIONS = ['.mp3', '.wav'];
const COVER_FILE_NAME = 'cover.png';
const SONG_FILE_NAME = 'song.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseSongFields(value: unknown): SongFields | string {
  if (!isRecord(value)) {
    return 'song.json must be a JSON object';
  }
  const {artist, title, slug, theme} = value;
  if (!isNonEmptyString(artist)) return 'field "artist" must be a non-empty string';
  if (!isNonEmptyString(title)) return 'field "title" must be a non-empty string';
  if (!isNonEmptyString(slug)) return 'field "slug" must be a non-empty string';
  if (!isNonEmptyString(theme)) return 'field "theme" must be a non-empty string';
  return {artist, title, slug, theme};
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readSong(trackDir: string): Promise<ReadSongResult> {
  const songPath = path.join(trackDir, SONG_FILE_NAME);
  let rawText: string;
  try {
    rawText = await readFile(songPath, 'utf8');
  } catch (error) {
    if (!isFileMissing(error)) throw error;
    return {ok: false, error: {code: 'missing-song-json', trackDir, detail: songPath}};
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return {ok: false, error: {code: 'invalid-song-json', trackDir, detail: `${songPath} is not valid JSON`}};
  }

  const fields = parseSongFields(parsedJson);
  if (typeof fields === 'string') {
    return {ok: false, error: {code: 'invalid-song-json', trackDir, detail: `${songPath}: ${fields}`}};
  }
  return {ok: true, song: fields};
}

async function isFilePresent(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (isFileMissing(error)) return false;
    throw error;
  }
}

function hasAudioExtension(fileName: string): boolean {
  return AUDIO_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

type FindAudioResult =
  | {ok: true; audioPath: string}
  | {ok: false; error: LoadTrackError};

async function findAudio(trackDir: string): Promise<FindAudioResult> {
  const preferredPath = path.join(trackDir, PREFERRED_AUDIO_FILE_NAME);
  if (await isFilePresent(preferredPath)) return {ok: true, audioPath: preferredPath};

  const entries = await readdir(trackDir, {withFileTypes: true});
  const audioFileNames = entries
    .filter((entry) => entry.isFile() && hasAudioExtension(entry.name))
    .map((entry) => entry.name)
    .sort();

  const [onlyAudioFileName, ...otherAudioFileNames] = audioFileNames;
  if (onlyAudioFileName === undefined) {
    return {ok: false, error: {code: 'missing-audio', trackDir, detail: 'no .mp3 or .wav file found'}};
  }
  if (otherAudioFileNames.length > 0) {
    return {
      ok: false,
      error: {code: 'ambiguous-audio', trackDir, detail: `several audio files: ${audioFileNames.join(', ')}`},
    };
  }
  return {ok: true, audioPath: path.join(trackDir, onlyAudioFileName)};
}

/**
 * Reads one smok-studio track directory. Never throws for expected problems;
 * returns a coded error instead. Only unexpected I/O failures throw.
 */
export async function loadTrack(trackDir: string): Promise<LoadTrackResult> {
  const songResult = await readSong(trackDir);
  if (!songResult.ok) return songResult;

  const audioResult = await findAudio(trackDir);
  if (!audioResult.ok) return audioResult;

  const coverPath = path.join(trackDir, COVER_FILE_NAME);
  if (!(await isFilePresent(coverPath))) {
    return {ok: false, error: {code: 'missing-cover', trackDir, detail: coverPath}};
  }

  return {
    ok: true,
    track: {...songResult.song, trackDir, coverPath, audioPath: audioResult.audioPath},
  };
}

/** Returns the directory of the track whose song.json slug matches, or undefined. */
export async function findTrackDirBySlug(rootDir: string, slug: string): Promise<string | undefined> {
  const entries = await readdir(rootDir, {withFileTypes: true});
  const directoryNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const directoryName of directoryNames) {
    const trackDir = path.join(rootDir, directoryName);
    const songResult = await readSong(trackDir);
    if (songResult.ok && songResult.song.slug === slug) return trackDir;
  }
  return undefined;
}
