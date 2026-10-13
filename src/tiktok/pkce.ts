import {createHash, randomBytes} from 'node:crypto';

const VERIFIER_LENGTH = 64;
const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
// Largest multiple of the alphabet size that fits in a byte; bytes above it are dropped to avoid modulo bias.
const MAX_UNBIASED_BYTE = Math.floor(256 / VERIFIER_ALPHABET.length) * VERIFIER_ALPHABET.length;

export function createCodeVerifier(): string {
  let verifier = '';
  while (verifier.length < VERIFIER_LENGTH) {
    for (const byte of randomBytes(VERIFIER_LENGTH)) {
      if (byte < MAX_UNBIASED_BYTE && verifier.length < VERIFIER_LENGTH) {
        verifier += VERIFIER_ALPHABET.charAt(byte % VERIFIER_ALPHABET.length);
      }
    }
  }
  return verifier;
}

/**
 * TikTok's desktop flow deviates from RFC 7636: the S256 challenge is the SHA-256 digest
 * as lowercase hex, not base64url.
 */
export function toCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('hex');
}
