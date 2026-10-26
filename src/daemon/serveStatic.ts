import {createReadStream} from 'node:fs';
import {realpath, stat} from 'node:fs/promises';
import type {ServerResponse} from 'node:http';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {sendError} from './httpResponses';

const STATIC_FOLDERS: ReadonlyArray<{urlPrefix: string; folder: string}> = [
  {urlPrefix: '/vendor/dnp-xiii/', folder: 'vendor/dnp-xiii'},
  {urlPrefix: '/review/', folder: 'review'},
];

const PAGE_FILES: Readonly<Record<string, string>> = {
  '/': 'review/index.html',
  '/review.js': 'review/review.js',
  '/review.css': 'review/review.css',
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export type StaticLookup =
  | {kind: 'file'; relativePath: string; rootDir: string}
  | {kind: 'bad-path'}
  | {kind: 'not-static'};

/** Splits a folder path into safe segments. A dot segment, an empty one or a separator inside one is refused. */
function toSafeSegments(rawRest: string): string[] | undefined {
  const segments: string[] = [];
  for (const rawSegment of rawRest.split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return undefined;
    }
    const isUnsafe = segment === '' || segment === '.' || segment === '..' || /[\\/\0]/.test(segment);
    if (isUnsafe) return undefined;
    segments.push(segment);
  }
  return segments;
}

/** Maps a raw request path to a file under webDir, or says it is not a static path or is unsafe. */
export function lookUpStaticFile(rawPath: string, webDir: string): StaticLookup {
  const pageFile = PAGE_FILES[rawPath];
  if (pageFile !== undefined) return {kind: 'file', relativePath: pageFile, rootDir: webDir};
  const staticFolder = STATIC_FOLDERS.find(({urlPrefix}) => rawPath.startsWith(urlPrefix));
  if (staticFolder === undefined) return {kind: 'not-static'};

  const segments = toSafeSegments(rawPath.slice(staticFolder.urlPrefix.length));
  if (segments === undefined) return {kind: 'bad-path'};
  return {kind: 'file', relativePath: path.join(staticFolder.folder, ...segments), rootDir: webDir};
}

function isInside(parentDir: string, candidate: string): boolean {
  return candidate.startsWith(parentDir + path.sep);
}

async function resolveInsideRoot(lookup: {relativePath: string; rootDir: string}): Promise<string | undefined> {
  try {
    const realRoot = await realpath(lookup.rootDir);
    const realFile = await realpath(path.join(realRoot, lookup.relativePath));
    if (!isInside(realRoot, realFile)) return undefined;
    return (await stat(realFile)).isFile() ? realFile : undefined;
  } catch {
    return undefined;
  }
}

/** Serves one static file with a fixed content type. Answers 404 for a missing file or an unknown type. */
export async function serveStaticFile(
  res: ServerResponse,
  lookup: {relativePath: string; rootDir: string},
): Promise<void> {
  const contentType = CONTENT_TYPES[path.extname(lookup.relativePath).toLowerCase()];
  const realFile = contentType === undefined ? undefined : await resolveInsideRoot(lookup);
  if (contentType === undefined || realFile === undefined) {
    sendError(res, 404, {code: 'not_found', message: 'Nothing here.'});
    return;
  }
  const {size} = await stat(realFile);
  res.writeHead(200, {'Content-Type': contentType, 'Content-Length': size, 'Cache-Control': 'no-cache'});
  await pipeline(createReadStream(realFile), res);
}
