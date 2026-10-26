import {describe, expect, it} from 'vitest';
import {getSafeRect, getUnsafeRects} from '../src/compositions/reel/reelSafeZone';
import {
  calculateBandReferences,
  normalizeBandEnergies,
  smoothBarLevels,
  spectrumToBandEnergies,
} from '../src/compositions/reel/reelAudio';
import {
  BARS_BAND_BOTTOM_PX,
  BARS_BAND_TOP_PX,
  SHORT_LINE_FONT_SIZE_PX,
  SHORT_LINE_GAP_PX,
  WORDMARK_FONT_SIZE_PX,
  WORDMARK_LEFT_PX,
  WORDMARK_TOP_PX,
} from '../src/compositions/reel/reelTheme';

describe('safe zone', () => {
  it('keeps the top 250 px, bottom 640 px and right 130 px free', () => {
    expect(getUnsafeRects()).toEqual([
      {leftPx: 0, topPx: 0, widthPx: 1080, heightPx: 250},
      {leftPx: 0, topPx: 1280, widthPx: 1080, heightPx: 640},
      {leftPx: 950, topPx: 250, widthPx: 130, heightPx: 1030},
    ]);
    expect(getSafeRect()).toEqual({leftPx: 0, topPx: 250, widthPx: 950, heightPx: 1030});
  });

  it('places the wordmark block in the top third, below the top strip', () => {
    const safe = getSafeRect();
    const blockBottomPx = WORDMARK_TOP_PX + WORDMARK_FONT_SIZE_PX + SHORT_LINE_GAP_PX + SHORT_LINE_FONT_SIZE_PX;
    expect(WORDMARK_TOP_PX).toBeGreaterThanOrEqual(safe.topPx);
    expect(WORDMARK_LEFT_PX).toBe(80);
    expect(blockBottomPx).toBeLessThanOrEqual(1920 / 3);
  });

  it('keeps the bars band where the artist video has it', () => {
    expect(BARS_BAND_TOP_PX).toBe(1520);
    expect(BARS_BAND_BOTTOM_PX).toBe(1740);
  });
});

describe('audio bars', () => {
  it('spreads a spectrum over 40 log-spaced bands', () => {
    const spectrum = Array.from({length: 512}, (_, bin) => 1 / (bin + 1));
    const energies = spectrumToBandEnergies(spectrum);
    expect(energies).toHaveLength(40);
    expect(energies.every((energy) => energy > 0)).toBe(true);
  });

  it('gives a quiet high band the same swing as a loud bass band', () => {
    const references = calculateBandReferences([[1, 0.01], [0.5, 0.005], [1, 0.01]]);
    const loud = normalizeBandEnergies([1, 0.01], references);
    expect(loud[0]).toBeCloseTo(loud[1] ?? -1);
    expect(loud[0]).toBe(1);
  });

  it('shows silence as zero', () => {
    expect(normalizeBandEnergies([0, 0], [1, 1])).toEqual([0, 0]);
  });

  it('rises faster than it falls', () => {
    const rising = smoothBarLevels([[0], [1]])[0] ?? 0;
    const falling = smoothBarLevels([[1], [0]])[0] ?? 1;
    expect(rising).toBeGreaterThan(1 - falling);
  });
});
