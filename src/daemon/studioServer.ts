import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {handleApiRequest, type StudioDeps} from './apiRoutes';
import {sendError, setSecurityHeaders} from './httpResponses';
import {isLoopbackHost, isSameLoopbackOrigin} from './requestGuards';
import {serveEpisodeMedia} from './serveMedia';
import {lookUpStaticFile, serveStaticFile} from './serveStatic';

export type StudioServerOptions = StudioDeps & {
  logError?: (message: string, error: unknown) => void;
};

const MEDIA_PATH_PATTERN = /^\/media\/([A-Za-z0-9_-]{1,64})\.mp4$/;
const STATE_CHANGING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function readRawPath(req: IncomingMessage): string {
  return (req.url ?? '/').split('?')[0] ?? '/';
}

function isForeignOrigin(req: IncomingMessage, port: number): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  return !isSameLoopbackOrigin(origin, port);
}

async function serveGetRequest(options: {
  options: StudioServerOptions;
  req: IncomingMessage;
  res: ServerResponse;
  rawPath: string;
}): Promise<void> {
  const {options: deps, req, res, rawPath} = options;
  const mediaMatch = MEDIA_PATH_PATTERN.exec(rawPath);
  if (mediaMatch?.[1] !== undefined) {
    return serveEpisodeMedia({req, res, db: deps.db, outDir: deps.outDir, episodeId: mediaMatch[1]});
  }
  const lookup = lookUpStaticFile(rawPath, deps.webDir);
  if (lookup.kind === 'bad-path') return sendError(res, 400, {code: 'bad_path', message: 'That path is not allowed.'});
  if (lookup.kind === 'not-static') return sendError(res, 404, {code: 'not_found', message: 'Nothing here.'});
  await serveStaticFile(res, lookup);
}

async function routeRequest(options: StudioServerOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const port = req.socket.localPort ?? 0;
  if (!isLoopbackHost(req.headers.host, port)) {
    return sendError(res, 421, {code: 'wrong_host', message: 'Open this page at http://127.0.0.1.'});
  }
  const method = req.method ?? 'GET';
  if (STATE_CHANGING_METHODS.has(method) && isForeignOrigin(req, port)) {
    return sendError(res, 403, {code: 'foreign_origin', message: 'That request came from another site.'});
  }
  const rawPath = readRawPath(req);
  if (rawPath.startsWith('/api/')) return handleApiRequest({deps: options, req, res, pathname: rawPath});
  if (method === 'GET') return serveGetRequest({options, req, res, rawPath});
  sendError(res, 405, {code: 'method_not_allowed', message: 'That method is not allowed here.'});
}

function isClientAbort(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ERR_STREAM_PREMATURE_CLOSE';
}

/**
 * Builds the studio HTTP server without listening. The router is thin: guard the request, validate,
 * call the store, map the result to a status and JSON. A failure is logged here and answered with a
 * generic message; a stack trace never reaches the client.
 */
export function createStudioServer(options: StudioServerOptions): Server {
  const logError = options.logError ?? ((message, error) => console.error(message, error));
  return createServer((req, res) => {
    setSecurityHeaders(res);
    routeRequest(options, req, res).catch((error: unknown) => {
      if (isClientAbort(error)) return res.destroy();
      logError(`${req.method} ${readRawPath(req)} failed`, error);
      if (res.headersSent) return res.destroy();
      sendError(res, 500, {code: 'internal', message: 'Something went wrong in the studio. Try again.'});
    });
  });
}
