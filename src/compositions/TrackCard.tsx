import React from 'react';
import {
  AbsoluteFill,
  Html5Audio,
  Img,
  interpolate,
  OffthreadVideo,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  AUDIO_FADE_OUT_SECONDS,
  CREAM_TEXT,
  NAVY_GROUND,
  NEON_TEXT_SHADOW,
  TEXT_INSET_LEFT_PX,
  TEXT_INSET_TOP_PX,
  TEXT_MAX_WIDTH_PX,
} from './smokratesTheme';

export type TrackCardProps = {
  title: string;
  theme: string;
  coverSrc: string;
  audioSrc: string;
  audioStartSeconds?: number;
  backgroundVideoSrc?: string;
};

const COVER_SIZE_PX = 760;
const COVER_TOP_PX = 720;

const KineticHeadline: React.FC<{title: string}> = ({title}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const settle = spring({frame, fps, config: {damping: 14, stiffness: 120}});
  const brandScale = interpolate(settle, [0, 1], [1.15, 1]);
  const brandLetterSpacingEm = interpolate(settle, [0, 1], [0.12, 0.04]);
  const titleOffsetPx = interpolate(settle, [0, 1], [-40, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: TEXT_INSET_LEFT_PX,
        top: TEXT_INSET_TOP_PX,
        width: TEXT_MAX_WIDTH_PX,
        color: CREAM_TEXT,
        textShadow: NEON_TEXT_SHADOW,
        fontFamily: 'Impact, "Arial Black", sans-serif',
        textTransform: 'uppercase',
      }}
    >
      <div
        style={{
          fontSize: 118,
          lineHeight: 1,
          letterSpacing: `${brandLetterSpacingEm}em`,
          transform: `scale(${brandScale})`,
          transformOrigin: 'left top',
          whiteSpace: 'nowrap',
        }}
      >
        SMOKRATES
      </div>
      <div
        style={{
          marginTop: 28,
          fontSize: 72,
          lineHeight: 1.05,
          transform: `translateX(${titleOffsetPx}px)`,
        }}
      >
        {title}
      </div>
    </div>
  );
};

const ThemeLine: React.FC<{theme: string}> = ({theme}) => (
  <div
    style={{
      position: 'absolute',
      left: TEXT_INSET_LEFT_PX,
      top: 520,
      width: TEXT_MAX_WIDTH_PX,
      color: CREAM_TEXT,
      opacity: 0.9,
      fontSize: 38,
      lineHeight: 1.25,
      fontFamily: '"Helvetica Neue", Arial, sans-serif',
      textShadow: NEON_TEXT_SHADOW,
    }}
  >
    {theme}
  </div>
);

const KenBurnsCover: React.FC<{coverSrc: string}> = ({coverSrc}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1]);
  const zoom = interpolate(progress, [0, 1], [1.05, 1.22]);
  const panXPx = interpolate(progress, [0, 1], [-18, 22]);
  const panYPx = interpolate(progress, [0, 1], [14, -16]);

  return (
    <div
      style={{
        position: 'absolute',
        left: (1080 - COVER_SIZE_PX) / 2,
        top: COVER_TOP_PX,
        width: COVER_SIZE_PX,
        height: COVER_SIZE_PX,
        overflow: 'hidden',
        borderRadius: 24,
        boxShadow: '0 0 60px rgba(166, 77, 255, 0.55)',
      }}
    >
      <Img
        src={staticFile(coverSrc)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `translate(${panXPx}px, ${panYPx}px) scale(${zoom})`,
        }}
      />
    </div>
  );
};

const MovingBackground: React.FC<{backgroundVideoSrc: string}> = ({backgroundVideoSrc}) => (
  <AbsoluteFill>
    <OffthreadVideo
      src={staticFile(backgroundVideoSrc)}
      muted
      style={{width: '100%', height: '100%', objectFit: 'cover'}}
    />
    <AbsoluteFill style={{backgroundColor: NAVY_GROUND, opacity: 0.35}} />
  </AbsoluteFill>
);

export const TrackCard: React.FC<TrackCardProps> = ({
  title,
  theme,
  coverSrc,
  audioSrc,
  audioStartSeconds = 0,
  backgroundVideoSrc,
}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const fadeOutFrames = AUDIO_FADE_OUT_SECONDS * fps;
  const audioVolume = (frame: number): number =>
    interpolate(frame, [durationInFrames - fadeOutFrames, durationInFrames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

  return (
    <AbsoluteFill style={{backgroundColor: NAVY_GROUND}}>
      {backgroundVideoSrc ? (
        <MovingBackground backgroundVideoSrc={backgroundVideoSrc} />
      ) : (
        <KenBurnsCover coverSrc={coverSrc} />
      )}
      <KineticHeadline title={title} />
      <ThemeLine theme={theme} />
      <Html5Audio
        src={staticFile(audioSrc)}
        trimBefore={Math.round(audioStartSeconds * fps)}
        volume={audioVolume}
      />
    </AbsoluteFill>
  );
};
