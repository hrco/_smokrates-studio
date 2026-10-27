import type {TikTokTokens} from './oauth';
import type {TikTokError, TikTokResult} from './types';

export type ExchangeCodeFn = (code: string) => Promise<TikTokResult<TikTokTokens>>;

export type HandleAuthCallbackOptions = {
  expectedState: string;
  exchangeCode: ExchangeCodeFn;
  /** Extra values that must not appear in any message. The authorization code is always removed. */
  redactValues?: readonly string[];
};

export type CallbackSuccess = {
  ok: true;
  tokens: TikTokTokens;
  logMessage: string;
};

export type CallbackFailure = {
  ok: false;
  status: number;
  message: string;
  terminalMessage?: string;
};

export type CallbackResult = CallbackSuccess | CallbackFailure;

const STATE_MISMATCH = 'State mismatch. Request rejected.';
const MISSING_CODE = 'Missing code.';
const EXCHANGE_FAILED_PAGE = 'Token exchange failed. See the terminal.';

/**
 * Reads one OAuth redirect and exchanges the code when the state matches.
 * Returns a browser page and a message that is safe to print.
 * Does not write the token file, does not call process.exit, and does not throw
 * for a rejected redirect, a missing code, or a failed exchange.
 */
export async function handleAuthCallback(requestUrl: URL, options: HandleAuthCallbackOptions): Promise<CallbackResult> {
  const code = requestUrl.searchParams.get('code') ?? '';
  const secrets = secretsToHide(code, options.redactValues);
  if (requestUrl.searchParams.get('state') !== options.expectedState) return pageFailure(400, STATE_MISMATCH, secrets);

  const errorParam = requestUrl.searchParams.get('error');
  if (errorParam) return denied(errorParam, requestUrl.searchParams.get('error_description') ?? '', secrets);
  if (!code) return pageFailure(400, MISSING_CODE, secrets);
  return completeExchange(options.exchangeCode, code, secrets);
}

function secretsToHide(code: string, redactValues: readonly string[] | undefined): string[] {
  return [code, ...(redactValues ?? [])].filter((secret) => secret.length > 0);
}

function pageFailure(status: number, message: string, secrets: readonly string[]): CallbackFailure {
  const safeMessage = redact(message, secrets);
  return {ok: false, status, message: safeMessage, terminalMessage: safeMessage};
}

function denied(errorParam: string, description: string, secrets: readonly string[]): CallbackFailure {
  return {
    ok: false,
    status: 400,
    message: redact(`Authorization failed: ${errorParam}`, secrets),
    terminalMessage: redact(`authorization denied: ${errorParam} ${description}`, secrets),
  };
}

async function completeExchange(
  exchangeCode: ExchangeCodeFn,
  code: string,
  secrets: readonly string[],
): Promise<CallbackResult> {
  try {
    const exchanged = await exchangeCode(code);
    if (!exchanged.ok) return exchangeFailure(exchanged.error, secrets);
    return authorized(exchanged.value, secrets);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'token exchange failed';
    return exchangeFailure({operation: 'exchange-code', code: 'failed', detail}, secrets);
  }
}

function exchangeFailure(error: TikTokError, secrets: readonly string[]): CallbackFailure {
  return {
    ok: false,
    status: 500,
    message: redact(EXCHANGE_FAILED_PAGE, secrets),
    terminalMessage: redact(`${error.operation}: ${error.code} ${error.detail}`, secrets),
  };
}

function authorized(tokens: TikTokTokens, secrets: readonly string[]): CallbackSuccess {
  const hidden = [...secrets, tokens.accessToken, tokens.refreshToken];
  return {ok: true, tokens, logMessage: redact(`Authorized for scopes: ${tokens.scope}`, hidden)};
}

function redact(text: string, secrets: readonly string[]): string {
  const ordered = [...new Set(secrets.filter((secret) => secret.length > 0))];
  ordered.sort((left, right) => right.length - left.length);
  let redacted = text;
  for (const secret of ordered) redacted = redacted.split(secret).join('[redacted]');
  return redacted;
}
