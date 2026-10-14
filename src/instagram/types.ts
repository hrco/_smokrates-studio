export type FetchFn = typeof fetch;

export type InstagramError = {
  operation: string;
  code: string;
  detail: string;
};

export type InstagramResult<Value> =
  | {ok: true; value: Value}
  | {ok: false; error: InstagramError};

export const GRAPH_API_VERSION = 'v23.0';
export const GRAPH_HOST = 'https://graph.instagram.com';
export const REQUEST_TIMEOUT_MS = 15_000;

export function graphUrl(pathAndQuery: string): string {
  return `${GRAPH_HOST}/${GRAPH_API_VERSION}/${pathAndQuery}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function failure(operation: string, code: string, detail: string): {ok: false; error: InstagramError} {
  return {ok: false, error: {operation, code, detail}};
}

/** Reads a response body as JSON; returns undefined when the body is not valid JSON. */
export async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Maps a Graph `{error: {...}}` body to an error; returns undefined when the body has no error field. */
export function readGraphError(operation: string, body: Record<string, unknown>): InstagramError | undefined {
  const {error} = body;
  if (!isRecord(error)) return undefined;
  const code = error.code === undefined ? 'unknown' : String(error.code);
  const message = typeof error.message === 'string' ? error.message : '';
  const traceId = typeof error.fbtrace_id === 'string' ? error.fbtrace_id : '';
  return {operation, code, detail: `${message} (fbtrace_id ${traceId})`};
}

/** Reads a Graph response into a JSON object, or a failure for non-JSON bodies and Graph errors. */
export async function readGraphBody(
  operation: string,
  response: Response,
): Promise<InstagramResult<Record<string, unknown>>> {
  const body = await readJsonBody(response);
  if (!isRecord(body)) return failure(operation, 'invalid-response', `HTTP ${response.status} with a non-JSON body`);
  const graphError = readGraphError(operation, body);
  if (graphError) return {ok: false, error: graphError};
  if (!response.ok) return failure(operation, 'http-error', `HTTP ${response.status} without an error field`);
  return {ok: true, value: body};
}
