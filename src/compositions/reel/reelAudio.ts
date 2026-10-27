import {BAR_COUNT, BARS_ATTACK_RATE, BARS_DECAY_RATE, BARS_CONTRAST_POWER} from './reelTheme';

const MIN_REFERENCE_ENERGY = 1e-6;
const REFERENCE_PERCENTILE = 0.9;
const USABLE_SPECTRUM_FRACTION = 0.6;

/**
 * Raw energy per bar. Bars are spaced on a log scale from the lowest bin to 60% of the
 * spectrum, so the bass, mids and highs each get a share of the row.
 */
export function spectrumToBandEnergies(spectrum: readonly number[], barCount: number = BAR_COUNT): number[] {
  const usableBins = Math.max(barCount, Math.floor(spectrum.length * USABLE_SPECTRUM_FRACTION));
  const energies: number[] = [];
  for (let barIndex = 0; barIndex < barCount; barIndex += 1) {
    const startBin = Math.floor(Math.pow(usableBins, barIndex / barCount));
    const endBin = Math.max(startBin + 1, Math.floor(Math.pow(usableBins, (barIndex + 1) / barCount)));
    let sum = 0;
    for (let bin = startBin; bin < endBin; bin += 1) sum += spectrum[bin] ?? 0;
    energies.push(sum / (endBin - startBin));
  }
  return energies;
}

/** The loud level of each band over many moments of the track, so quiet highs get the same swing as loud bass. */
export function calculateBandReferences(energiesPerMoment: readonly (readonly number[])[]): number[] {
  const [firstMoment] = energiesPerMoment;
  if (!firstMoment) return [];
  return firstMoment.map((_, barIndex) => {
    const sorted = energiesPerMoment.map((energies) => energies[barIndex] ?? 0).sort((a, b) => a - b);
    const percentileIndex = Math.min(sorted.length - 1, Math.floor(sorted.length * REFERENCE_PERCENTILE));
    return Math.max(MIN_REFERENCE_ENERGY, sorted[percentileIndex] ?? 0);
  });
}

/** Each band against its own reference, 0..1, with a contrast curve so quiet moments stay low. */
export function normalizeBandEnergies(energies: readonly number[], references: readonly number[]): number[] {
  return energies.map((energy, barIndex) => {
    const ratio = energy / (references[barIndex] ?? MIN_REFERENCE_ENERGY);
    return Math.pow(Math.min(1, Math.max(0, ratio)), BARS_CONTRAST_POWER);
  });
}

/** Fast attack, slower decay. Takes the levels of the last frames, oldest first. */
export function smoothBarLevels(framesOldestFirst: readonly (readonly number[])[]): number[] {
  const [firstFrame] = framesOldestFirst;
  if (!firstFrame) return [];
  const smoothed = firstFrame.map((level) => level);
  for (const levels of framesOldestFirst.slice(1)) {
    levels.forEach((level, barIndex) => {
      const previous = smoothed[barIndex] ?? 0;
      const rate = level > previous ? BARS_ATTACK_RATE : BARS_DECAY_RATE;
      smoothed[barIndex] = previous + (level - previous) * rate;
    });
  }
  return smoothed;
}

export function calculateBassLevel(spectrum: readonly number[], bassReference: number): number {
  const bassBins = spectrum.slice(0, 4);
  if (bassBins.length === 0) return 0;
  const average = bassBins.reduce((total, value) => total + value, 0) / bassBins.length;
  return Math.min(1, average / Math.max(MIN_REFERENCE_ENERGY, bassReference));
}
