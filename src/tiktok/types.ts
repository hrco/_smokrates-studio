export type FetchFn = typeof fetch;

export type TikTokError = {
  operation: string;
  code: string;
  detail: string;
};

export type TikTokResult<Value> =
  | {ok: true; value: Value}
  | {ok: false; error: TikTokError};

export const REQUEST_TIMEOUT_MS = 15_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function failure(operation: string, code: string, detail: string): {ok: false; error: TikTokError} {
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
