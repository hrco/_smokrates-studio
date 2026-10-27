const HEALTH_CLAIM_WORDS = ['health', 'sleep', 'anxiety', 'focus', 'cure', 'heal', 'therapy', 'stress relief'] as const;

const HEALTH_CLAIM_PATTERN = new RegExp(`\\b(?:${HEALTH_CLAIM_WORDS.join('|').replace(' ', '\\s+')})\\w*`, 'i');

/**
 * True when the text makes a health claim: it holds one of the words above, or a word that starts with
 * one of them (healing, sleepy, focused). Music for sleep or focus is a claim TikTok may take down.
 */
export function hasHealthClaim(text: string): boolean {
  return HEALTH_CLAIM_PATTERN.test(text);
}
