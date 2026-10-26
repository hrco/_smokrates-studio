import type {TikTokTokens} from './oauth';
import type {TikTokResult} from './types';

export type ExchangeCodeFn = (code: string) => Promise<TikTokResult<TikTokTokens>>;

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

/**
 * Pure, testable handler for the OAuth callback URL.
 *
 * Does not write a response, does not call process.exit, and does not throw
 * for any of the expected error conditions. Inject `exchangeCode` so tests
 * can supply a fake without network access.
 */
export async function handleAuthCallback(
  requestUrl: URL,
  opts: {expectedState: string; exchangeCode: ExchangeCodeFn},
): Promise<CallbackResult> {
  const params = requestUrl.searchParams;

  if (params.get('state') !== opts.expectedState) {
    return {ok: false, status: 400, message: 'State mismatch. Request rejected.'};
  }

  const errorParam = params.get('error');
  if (errorParam) {
    const errorDescription = params.get('error_description') ?? '';
    return {
      ok: false,
      status: 400,
      message: `Authorization failed: ${errorParam}`,
      terminalMessage: `authorization denied: ${errorParam} ${errorDescription}`,
    };
  }

  const code = params.get('code');
  if (!code) {
    return {ok: false, status: 400, message: 'Missing code.'};
  }

  const exchanged = await opts.exchangeCode(code);
  if (!exchanged.ok) {
    const {operation, code: errorCode, detail} = exchanged.error;
    return {
      ok: false,
      status: 500,
      message: 'Token exchange failed. See the terminal.',
      terminalMessage: `${operation}: ${errorCode} ${detail}`,
    };
  }

  return {
    ok: true,
    tokens: exchanged.value,
    logMessage: `Authorized for scopes: ${exchanged.value.scope}`,
  };
}
