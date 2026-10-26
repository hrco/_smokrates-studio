import {createReadStream} from 'node:fs';
import {realpath, stat} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import type {DatabaseSync} from 'node:sqlite';
import {sendError} from './httpResponses';
import {readLatestRenderPath} from '../store/episodeRows';

export type ByteRange = {kind: 'whole'} | {kind: 'partial'; start: number; end: number} | {kind: 'unsatisfiable'};

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

/** Reads one byte range. A header with several ranges, or one that is not bytes, is ignored: the whole file is sent. */
export function parseByteRange(header: string | undefined, sizeBytes: number): ByteRange {
  const match = header === undefined ? null : RANGE_PATTERN.exec(header.trim());
  if (match === null) return {kind: 'whole'};
  const [firstText, lastText] = [match[1] ?? '', match[2] ?? ''];
  if (firstText === '' && lastText === '') return {kind: 'whole'};

  if (firstText === '') {
    const suffixLength = Number(lastText);
    if (suffixLength === 0) return {kind: 'unsatisfiable'};
    return {kind: 'partial', start: Math.max(sizeBytes - suffixLength, 0), end: sizeBytes - 1};
  }
  const start = Number(firstText);
  const end = lastText === '' ? sizeBytes - 1 : Math.min(Number(lastText), sizeBytes - 1);
  if (start >= sizeBytes || start > end) return {kind: 'unsatisfiable'};
  return {kind: 'partial', start, end};
}

async function resolveRenderFile(options: {storedPath: string; outDir: string}): Promise<string | undefined> {
  const {storedPath, outDir} = options;
  try {
    const realOutDir = await realpath(outDir);
    const realFile = await realpath(path.resolve(path.dirname(outDir), storedPath));
    if (!realFile.startsWith(realOutDir + path.sep)) return undefined;
    return (await stat(realFile)).isFile() ? realFile : undefined;
  } catch {
    return undefined;
  }
}

async function streamFile(options: {
  res: ServerResponse;
  realFile: string;
  sizeBytes: number;
  range: ByteRange;
}): Promise<void> {
  const {res, realFile, sizeBytes, range} = options;
  const headers = {'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store'};
  if (range.kind === 'partial') {
    res.writeHead(206, {
      ...headers,
      'Content-Length': range.end - range.start + 1,
      'Content-Range': `bytes ${range.start}-${range.end}/${sizeBytes}`,
    });
    await pipeline(createReadStream(realFile, {start: range.start, end: range.end}), res);
    return;
  }
  res.writeHead(200, {...headers, 'Content-Length': sizeBytes});
  await pipeline(createReadStream(realFile), res);
}

/**
 * Streams the newest render of an episode. The file must resolve, symlinks followed, to a place inside
 * outDir; anything else is a 404, so a bad row can never expose another file. Supports one byte range.
 */
export async function serveEpisodeMedia(options: {
  req: IncomingMessage;
  res: ServerResponse;
  db: DatabaseSync;
  outDir: string;
  episodeId: string;
}): Promise<void> {
  const {req, res, db, outDir, episodeId} = options;
  const storedPath = readLatestRenderPath(db, episodeId);
  const realFile = storedPath === undefined ? undefined : await resolveRenderFile({storedPath, outDir});
  if (realFile === undefined) {
    sendError(res, 404, {code: 'no_render', message: 'No render for this night yet.'});
    return;
  }
  const {size: sizeBytes} = await stat(realFile);
  const range = parseByteRange(req.headers.range, sizeBytes);
  if (range.kind === 'unsatisfiable') {
    res.writeHead(416, {'Content-Range': `bytes */${sizeBytes}`});
    res.end();
    return;
  }
  await streamFile({res, realFile, sizeBytes, range});
}
