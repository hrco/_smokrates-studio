export type TikTokEnvironment = 'sandbox' | 'production';

export type TikTokCredentials = {
  environment: TikTokEnvironment;
  clientKey: string;
  clientSecret: string;
  tokenFileName: string;
};

export type CredentialsResult = {ok: true; value: TikTokCredentials} | {ok: false; missingNames: string[]};

const CREDENTIAL_NAMES: Record<TikTokEnvironment, {key: string; secret: string}> = {
  sandbox: {key: 'TIKTOK_CLIENT_KEY_SANDBOX', secret: 'TIKTOK_CLIENT_SECRET_SANDBOX'},
  production: {key: 'TIKTOK_CLIENT_KEY', secret: 'TIKTOK_CLIENT_SECRET'},
};

function hasPair(env: NodeJS.ProcessEnv, environment: TikTokEnvironment): boolean {
  const names = CREDENTIAL_NAMES[environment];
  return Boolean(env[names.key]) && Boolean(env[names.secret]);
}

/**
 * Picks the TikTok client credentials. The sandbox pair wins when both of its variables are set,
 * because sandbox works before TikTok's app review and production keys do not.
 * Each environment keeps its own token file: a sandbox token is rejected by the production app.
 */
export function readTikTokCredentials(env: NodeJS.ProcessEnv): CredentialsResult {
  const environment: TikTokEnvironment = hasPair(env, 'sandbox') ? 'sandbox' : 'production';
  const names = CREDENTIAL_NAMES[environment];
  const clientKey = env[names.key];
  const clientSecret = env[names.secret];
  if (!clientKey || !clientSecret) {
    const missingNames = [names.key, names.secret].filter((name) => !env[name]);
    return {ok: false, missingNames};
  }
  return {ok: true, value: {environment, clientKey, clientSecret, tokenFileName: `tokens.${environment}.json`}};
}
