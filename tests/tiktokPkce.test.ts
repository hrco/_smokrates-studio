import {describe, expect, it} from 'vitest';
import {createCodeVerifier, toCodeChallenge} from '../src/tiktok/pkce';

describe('createCodeVerifier', () => {
  it('returns 64 unreserved characters', () => {
    const verifier = createCodeVerifier();
    expect(verifier).toHaveLength(64);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
  });

  it('returns a different value each call', () => {
    expect(createCodeVerifier()).not.toBe(createCodeVerifier());
  });
});

describe('toCodeChallenge', () => {
  it('returns the SHA-256 hex digest', () => {
    expect(toCodeChallenge('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
