export const DEFAULT_HASHTAGS = ['#smokrates', '#chilldub', '#psydub', '#aimusic'] as const;

const MAX_SHORT_LINE_LENGTH = 60;

export type PublishSidecar = {
  slug: string;
  title: string;
  caption: string;
  hashtags: string[];
  aiGenerated: true;
};

/**
 * First sentence of the theme, fitted to a short on-screen line.
 * Prefers the last clause boundary (comma, semicolon, colon) that fits, so the line never ends mid-phrase;
 * falls back to a word boundary.
 */
export function toShortLine(theme: string): string {
  const firstSentence = (theme.split(/[.!?](?:\s|$)/)[0] ?? theme).trim();
  if (firstSentence.length <= MAX_SHORT_LINE_LENGTH) return firstSentence;

  const clipped = firstSentence.slice(0, MAX_SHORT_LINE_LENGTH);
  const lastClauseIndex = Math.max(clipped.lastIndexOf(','), clipped.lastIndexOf(';'), clipped.lastIndexOf(':'));
  if (lastClauseIndex > 0) return clipped.slice(0, lastClauseIndex).trim();

  const lastSpaceIndex = clipped.lastIndexOf(' ');
  const wordSafe = lastSpaceIndex > 0 ? clipped.slice(0, lastSpaceIndex) : clipped;
  return wordSafe.replace(/[\s,;:-]+$/, '');
}

export function buildPublishSidecar(input: {slug: string; title: string; theme: string}): PublishSidecar {
  const hashtags = [...DEFAULT_HASHTAGS];
  const firstLine = `${input.title} - ${toShortLine(input.theme)}`;
  return {
    slug: input.slug,
    title: input.title,
    caption: `${firstLine}\n\n${hashtags.join(' ')}`,
    hashtags,
    aiGenerated: true,
  };
}
