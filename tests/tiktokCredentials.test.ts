import {describe, expect, it} from 'vitest';
import {readTikTokCredentials} from '../src/tiktok/credentials';

describe('readTikTokCredentials', () => {
  it('prefers the sandbox pair when both sandbox variables are set', () => {
    const result = readTikTokCredentials({
      TIKTOK_CLIENT_KEY: 'prod-key',
      TIKTOK_CLIENT_SECRET: 'prod-secret',
      TIKTOK_CLIENT_KEY_SANDBOX: 'sb-key',
      TIKTOK_CLIENT_SECRET_SANDBOX: 'sb-secret',
    });
    expect(result).toEqual({
      ok: true,
      value: {environment: 'sandbox', clientKey: 'sb-key', clientSecret: 'sb-secret', tokenFileName: 'tokens.sandbox.json'},
    });
  });

  it('falls back to production when the sandbox pair is incomplete', () => {
    const result = readTikTokCredentials({
      TIKTOK_CLIENT_KEY: 'prod-key',
      TIKTOK_CLIENT_SECRET: 'prod-secret',
      TIKTOK_CLIENT_KEY_SANDBOX: 'sb-key',
    });
    expect(result.ok && result.value.environment).toBe('production');
    expect(result.ok && result.value.tokenFileName).toBe('tokens.production.json');
  });

  it('reports only the missing production names when nothing usable is set', () => {
    expect(readTikTokCredentials({TIKTOK_CLIENT_KEY: 'prod-key'})).toEqual({
      ok: false,
      missingNames: ['TIKTOK_CLIENT_SECRET'],
    });
  });
});
