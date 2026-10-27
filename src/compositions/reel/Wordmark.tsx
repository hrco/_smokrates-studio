import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {loadFont as loadAnton} from '@remotion/google-fonts/Anton';
import {loadFont as loadBebasNeue} from '@remotion/google-fonts/BebasNeue';
import {CREAM_TEXT, NAVY_GROUND} from '../smokratesTheme';
import {
  PUNCH_IN_FRAMES,
  REEL_WORDMARK_GLOW,
  SCRIM_HEIGHT_PX,
  SHORT_LINE_FONT_SIZE_PX,
  SHORT_LINE_GAP_PX,
  WORDMARK_FONT_SIZE_PX,
  WORDMARK_LEFT_PX,
  WORDMARK_TOP_PX,
} from './reelTheme';

const {fontFamily: brandFontFamily} = loadAnton('normal', {weights: ['400'], subsets: ['latin']});
const {fontFamily: lineFontFamily} = loadBebasNeue('normal', {weights: ['400'], subsets: ['latin']});

const SWEEP_START_FRAME = 24;
const SWEEP_FRAMES = 36;

export const TopScrim: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: SCRIM_HEIGHT_PX,
      background: `linear-gradient(to bottom, ${NAVY_GROUND}ee 0%, ${NAVY_GROUND}b3 45%, ${NAVY_GROUND}00 100%)`,
    }}
  />
);

const brandStyle: React.CSSProperties = {
  fontFamily: brandFontFamily,
  fontSize: WORDMARK_FONT_SIZE_PX,
  lineHeight: 1,
  letterSpacing: '0.01em',
  whiteSpace: 'nowrap',
};

/** Cream copy of the brand word with a bright band that crosses it once. Hidden from assistive tech: it repeats the real text. */
const LightSweep: React.FC = () => {
  const frame = useCurrentFrame();
  const bandCenterPercent = interpolate(frame, [SWEEP_START_FRAME, SWEEP_START_FRAME + SWEEP_FRAMES], [-30, 130], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      aria-hidden
      style={{
        ...brandStyle,
        position: 'absolute',
        left: 0,
        top: 0,
        color: 'transparent',
        textShadow: 'none',
        backgroundImage: `linear-gradient(105deg, transparent ${bandCenterPercent - 14}%, rgba(255,255,255,0.95) ${bandCenterPercent}%, transparent ${bandCenterPercent + 14}%)`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
      }}
    >
      SMOKRATES
    </div>
  );
};

export const Wordmark: React.FC<{shortLine: string}> = ({shortLine}) => {
  const frame = useCurrentFrame();
  const punchScale = interpolate(frame, [0, PUNCH_IN_FRAMES], [1.06, 1], {
    extrapolateRight: 'clamp',
    easing: (value) => 1 - Math.pow(1 - value, 3),
  });
  return (
    <AbsoluteFill>
      <TopScrim />
      <div
        style={{
          position: 'absolute',
          left: WORDMARK_LEFT_PX,
          top: WORDMARK_TOP_PX,
          transform: `scale(${punchScale})`,
          transformOrigin: 'left top',
          color: CREAM_TEXT,
          textShadow: REEL_WORDMARK_GLOW,
        }}
      >
        <div style={{...brandStyle, position: 'relative'}}>
          SMOKRATES
          <LightSweep />
        </div>
        <div
          style={{
            marginTop: SHORT_LINE_GAP_PX,
            marginLeft: 6,
            fontFamily: lineFontFamily,
            fontSize: SHORT_LINE_FONT_SIZE_PX,
            lineHeight: 1,
            letterSpacing: '0.16em',
            whiteSpace: 'nowrap',
          }}
        >
          {shortLine}
        </div>
      </div>
    </AbsoluteFill>
  );
};
