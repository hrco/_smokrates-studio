const FILLER_WORDS = ['GROOVE', 'TRACK', 'MIX', 'REMIX', 'VERSION'];
const COVER_PROMPT_SHORT_LINE = /Short line:\s*([^.\n]+?)\s*\.?\s*$/i;

function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readCoverPromptShortLine(art: unknown): string | undefined {
  if (typeof art !== 'object' || art === null) return undefined;
  const coverPrompt = readText((art as Record<string, unknown>).cover);
  return coverPrompt?.match(COVER_PROMPT_SHORT_LINE)?.[1]?.toUpperCase();
}

/** Uppercases the title and drops filler words ("Golden Hour Groove" becomes "GOLDEN HOUR"). Keeps the title if nothing is left. */
export function deriveShortLineFromTitle(title: string): string {
  const words = title.trim().toUpperCase().split(/\s+/);
  const keptWords = words.filter((word) => !FILLER_WORDS.includes(word));
  return (keptWords.length > 0 ? keptWords : words).join(' ');
}

/**
 * The short line under the SMOKRATES wordmark. Order:
 * 1. song.json "shortLine" (or "short_line")
 * 2. the "Short line: X." sentence of song.json art.cover, which is the line printed on the cover
 * 3. the title, uppercased, without filler words (Groove, Track, Mix, Remix, Version)
 */
export function pickShortLine(song: unknown, title: string): string {
  if (typeof song === 'object' && song !== null) {
    const fields = song as Record<string, unknown>;
    const explicitLine = readText(fields.shortLine) ?? readText(fields.short_line);
    if (explicitLine) return explicitLine.toUpperCase();
    const coverLine = readCoverPromptShortLine(fields.art);
    if (coverLine) return coverLine;
  }
  return deriveShortLineFromTitle(title);
}
