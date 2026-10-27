import React, {useMemo} from 'react';
import {staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {useAudioData, visualizeAudio} from '@remotion/media-utils';
import {VIDEO_WIDTH_PX} from '../smokratesTheme';
import {
  calculateBandReferences,
  calculateBassLevel,
  normalizeBandEnergies,
  smoothBarLevels,
  spectrumToBandEnergies,
} from './reelAudio';
import {
  AUDIO_SAMPLE_COUNT,
  BAR_COUNT,
  BARS_BAND_BOTTOM_PX,
  BARS_GLOW,
  BARS_WIDTH_FRACTION,
  REFERENCE_MOMENT_COUNT,
  BARS_BAND_TOP_PX,
  BARS_MIN_HEIGHT_PX,
  BARS_OPACITY,
  BARS_SIDE_INSET_PX,
  BARS_SMOOTHING_FRAMES,
  REEL_BAR_BOTTOM_COLOR,
  REEL_BAR_TOP_COLOR,
} from './reelTheme';

export type AudioReaction = {barLevels: number[]; bassLevel: number};

const SILENT_REACTION: AudioReaction = {barLevels: new Array<number>(BAR_COUNT).fill(0), bassLevel: 0};

type AudioDataValue = NonNullable<ReturnType<typeof useAudioData>>;

function readSpectrum(audioData: AudioDataValue, fps: number, frame: number): number[] {
  return visualizeAudio({
    audioData,
    fps,
    frame: Math.max(0, frame),
    numberOfSamples: AUDIO_SAMPLE_COUNT,
    optimizeFor: 'speed',
  });
}

type BandReferences = {bands: number[]; bass: number};

/** Samples the played part of the track once, to learn how loud each band gets. */
function measureReferences(audioData: AudioDataValue, fps: number, startFrame: number, totalFrames: number): BandReferences {
  const moments = Array.from({length: REFERENCE_MOMENT_COUNT}, (_, index) =>
    readSpectrum(audioData, fps, startFrame + Math.floor((index / REFERENCE_MOMENT_COUNT) * totalFrames)),
  );
  const bassEnergies = moments.map((spectrum) => spectrum.slice(0, 4).reduce((total, value) => total + value, 0) / 4);
  return {
    bands: calculateBandReferences(moments.map((spectrum) => spectrumToBandEnergies(spectrum))),
    bass: calculateBandReferences(bassEnergies.map((energy) => [energy]))[0] ?? 0,
  };
}

/** Spectrum of the trimmed audio at the current frame: log-spaced bands, each scaled to its own loudness, smoothed. */
export function useAudioReaction(audioSrc: string, audioStartSeconds: number): AudioReaction {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const audioData = useAudioData(staticFile(audioSrc));
  const startFrame = Math.round(audioStartSeconds * fps);
  const references = useMemo(
    () => (audioData ? measureReferences(audioData, fps, startFrame, durationInFrames) : undefined),
    [audioData, fps, startFrame, durationInFrames],
  );
  if (!audioData || !references) return SILENT_REACTION;

  const recentFrames = Array.from({length: BARS_SMOOTHING_FRAMES}, (_, step) => frame - (BARS_SMOOTHING_FRAMES - 1 - step));
  const recentLevels = recentFrames.map((recentFrame) =>
    normalizeBandEnergies(spectrumToBandEnergies(readSpectrum(audioData, fps, startFrame + recentFrame)), references.bands),
  );
  return {
    barLevels: smoothBarLevels(recentLevels),
    bassLevel: calculateBassLevel(readSpectrum(audioData, fps, startFrame + frame), references.bass),
  };
}

export const AudioBars: React.FC<{barLevels: number[]}> = ({barLevels}) => {
  const bandHeightPx = BARS_BAND_BOTTOM_PX - BARS_BAND_TOP_PX;
  const slotWidthPx = (VIDEO_WIDTH_PX - 2 * BARS_SIDE_INSET_PX) / BAR_COUNT;
  const barWidthPx = slotWidthPx * BARS_WIDTH_FRACTION;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: BARS_SIDE_INSET_PX,
        top: BARS_BAND_TOP_PX,
        width: VIDEO_WIDTH_PX - 2 * BARS_SIDE_INSET_PX,
        height: bandHeightPx,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-around',
        opacity: BARS_OPACITY,
        filter: BARS_GLOW,
      }}
    >
      {barLevels.map((level, barIndex) => (
        <div
          key={barIndex}
          style={{
            width: barWidthPx,
            height: BARS_MIN_HEIGHT_PX + level * (bandHeightPx - BARS_MIN_HEIGHT_PX),
            borderRadius: barWidthPx / 2,
            background: `linear-gradient(to bottom, ${REEL_BAR_TOP_COLOR}, ${REEL_BAR_BOTTOM_COLOR})`,
          }}
        />
      ))}
    </div>
  );
};
