import React from 'react';
import {AbsoluteFill} from 'remotion';
import {getUnsafeRects} from './reelSafeZone';

/** Review aid for stills only: tints the strips the platform interface covers. Never part of the video. */
export const SafeZoneOverlay: React.FC = () => (
  <AbsoluteFill>
    {getUnsafeRects().map((rect) => (
      <div
        key={`${rect.leftPx}-${rect.topPx}`}
        style={{
          position: 'absolute',
          left: rect.leftPx,
          top: rect.topPx,
          width: rect.widthPx,
          height: rect.heightPx,
          backgroundColor: 'rgba(255, 40, 80, 0.32)',
          outline: '2px dashed rgba(255, 255, 255, 0.8)',
        }}
      />
    ))}
  </AbsoluteFill>
);
