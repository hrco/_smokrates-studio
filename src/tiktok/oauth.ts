import {
  REQUEST_TIMEOUT_MS,
  failure,
  isNonEmptyString,
  isRecord,
  readJsonBody,
  type FetchFn,
  type TikTokResult,
} from './types';

export const TIKTOK_SCOPES = ['video.upload'] as const;

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';

export type TikTokTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  openId: string;
  scope: string;
};

export type AuthorizeUrlInput = {
  clientKey: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
};

export type ExchangeCodeInput = {
  clientKey: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
};

export type RefreshTokenInput = {
  clientKey: string;
  clientSecret: string;
  refreshToken: string;
};

export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_key', input.clientKey);
  url.searchParams.set('scope', TIKTOK_SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function parseTokens(body: Record<string, unknown>, nowMs: number): TikTokTokens | undefined {
  const {access_token, refresh_token, expires_in, refresh_expires_in, open_id, scope} = body;
  if (!isNonEmptyString(access_token) || !isNonEmptyString(refresh_token)) return undefined;
  if (typeof expires_in !== 'number' || typeof refresh_expires_in !== 'number') return undefined;
  if (!isNonEmptyString(open_id) || typeof scope !== 'string') return undefined;
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    accessExpiresAt: nowMs + expires_in * 1000,
    refreshExpiresAt: nowMs + refresh_expires_in * 1000,
    openId: open_id,
    scope,
  };
}

async function postTokenRequest(
  operation: string,
  form: Record<string, string>,
  fetchFn: FetchFn,
): Promise<TikTokResult<TikTokTokens>> {
  const response = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache'},
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await readJsonBody(response);
  if (!isRecord(body)) return failure(operation, 'invalid-response', `HTTP ${response.status} with a non-JSON body`);

  if (isNonEmptyString(body.error)) {
    const description = typeof body.error_description === 'string' ? body.error_description : '';
    return failure(operation, body.error, description);
  }
  const tokens = parseTokens(body, Date.now());
  if (!tokens) return failure(operation, 'invalid-response', `HTTP ${response.status} without the expected token fields`);
  return {ok: true, value: tokens};
}

export function exchangeCode(input: ExchangeCodeInput, fetchFn: FetchFn): Promise<TikTokResult<TikTokTokens>> {
  return postTokenRequest(
    'exchange-code',
    {
      client_key: input.clientKey,
      client_secret: input.clientSecret,
      code: input.code,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    },
    fetchFn,
  );
}

export function refreshAccessToken(input: RefreshTokenInput, fetchFn: FetchFn): Promise<TikTokResult<TikTokTokens>> {
  return postTokenRequest(
    'refresh-token',
    {
      client_key: input.clientKey,
      client_secret: input.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    },
    fetchFn,
  );
}
