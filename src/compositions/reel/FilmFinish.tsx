import React, {useMemo} from 'react';
import {AbsoluteFill, interpolate, random, useCurrentFrame} from 'remotion';
import {NAVY_GROUND, NEON_CYAN, NEON_PURPLE, VIDEO_HEIGHT_PX, VIDEO_WIDTH_PX} from '../smokratesTheme';
import {GRAIN_OPACITY, GRAIN_TILE_PX} from './reelTheme';

const SWEEP_PERIOD_FRAMES = 180;
const GRAIN_SHIFT_RANGE_PX = 240;

function createGrainTileUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = GRAIN_TILE_PX;
  canvas.height = GRAIN_TILE_PX;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('FilmFinish: 2d canvas is not available for the grain tile');
  const image = context.createImageData(GRAIN_TILE_PX, GRAIN_TILE_PX);
  for (let pixelIndex = 0; pixelIndex < GRAIN_TILE_PX * GRAIN_TILE_PX; pixelIndex += 1) {
    const grey = Math.floor(random(`grain-${pixelIndex}`) * 255);
    image.data.set([grey, grey, grey, 255], pixelIndex * 4);
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse 85% 70% at 50% 46%, transparent 55%, ${NAVY_GROUND}99 100%)`,
    }}
  />
);

/** Small noise tile jumped to a new offset every other frame: cheap, reads as film grain. */
const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const tileUrl = useMemo(createGrainTileUrl, []);
  const stepIndex = Math.floor(frame / 2);
  const shiftLeftPx = Math.floor(random(`grain-x-${stepIndex}`) * GRAIN_SHIFT_RANGE_PX);
  const shiftTopPx = Math.floor(random(`grain-y-${stepIndex}`) * GRAIN_SHIFT_RANGE_PX);
  return (
    <div
      style={{
        position: 'absolute',
        left: -GRAIN_SHIFT_RANGE_PX,
        top: -GRAIN_SHIFT_RANGE_PX,
        width: VIDEO_WIDTH_PX + 2 * GRAIN_SHIFT_RANGE_PX,
        height: VIDEO_HEIGHT_PX + 2 * GRAIN_SHIFT_RANGE_PX,
        backgroundImage: `url(${tileUrl})`,
        backgroundSize: `${GRAIN_TILE_PX}px ${GRAIN_TILE_PX}px`,
        backgroundPosition: `${shiftLeftPx}px ${shiftTopPx}px`,
        mixBlendMode: 'overlay',
        opacity: GRAIN_OPACITY,
      }}
    />
  );
};

/** A soft cyan-to-purple diagonal band that drifts across the frame every few seconds. */
const LightSweep: React.FC = () => {
  const frame = useCurrentFrame();
  const phase = (frame % SWEEP_PERIOD_FRAMES) / SWEEP_PERIOD_FRAMES;
  const centerPercent = interpolate(phase, [0, 1], [-40, 140]);
  return (
    <AbsoluteFill
      style={{
        mixBlendMode: 'screen',
        opacity: 0.16,
        background: `linear-gradient(115deg, transparent ${centerPercent - 22}%, ${NEON_CYAN} ${centerPercent - 6}%, ${NEON_PURPLE} ${centerPercent + 6}%, transparent ${centerPercent + 22}%)`,
      }}
    />
  );
};

export const FilmFinish: React.FC = () => (
  <>
    <LightSweep />
    <Vignette />
    <Grain />
  </>
);
