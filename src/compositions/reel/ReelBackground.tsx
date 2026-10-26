import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, Loop, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {NAVY_GROUND, VIDEO_HEIGHT_PX, VIDEO_WIDTH_PX} from '../smokratesTheme';
import {
  CLIP_PUSH_END_SCALE,
  CLIP_PUSH_RISE_PX,
  COVER_LETTERING_BOTTOM_FRACTION,
  COVER_LETTERING_RIGHT_FRACTION,
  COVER_LETTERING_TOP_FRACTION,
  COVER_SEAM_FADE_PX,
  COVER_SIZE_PX,
  PUSH_IN_END_SCALE,
  PUSH_IN_START_SCALE,
} from './reelTheme';
import {
  getLoopLayerFrames,
  planBackground,
  selectBackgroundKind,
  type BackgroundSources,
} from './reelTimeline';

export type ReelBackgroundProps = BackgroundSources & {
  coverFocusX: number;
  introClipFrames: number;
  loopClipFrames: number;
};

const COVER_PUSH_ORIGIN = '60% 70%';

function usePushInScale(): number {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  return interpolate(frame, [0, durationInFrames], [PUSH_IN_START_SCALE, PUSH_IN_END_SCALE]);
}

const ClipLayer: React.FC<{src: string}> = ({src}) => (
  <OffthreadVideo
    src={staticFile(src)}
    muted
    style={{width: VIDEO_WIDTH_PX, height: VIDEO_HEIGHT_PX, objectFit: 'cover'}}
  />
);

const LoopingClip: React.FC<{src: string; clipFrames: number}> = ({src, clipFrames}) => (
  <Loop durationInFrames={clipFrames}>
    <ClipLayer src={src} />
  </Loop>
);

/** Slow digital push-in with a slight rise over the whole reel, so a looping shot keeps moving. */
const ClipPushIn: React.FC<{children: React.ReactNode}> = ({children}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {easing: Easing.out(Easing.quad)});
  const scale = interpolate(progress, [0, 1], [PUSH_IN_START_SCALE, CLIP_PUSH_END_SCALE]);
  const risePx = interpolate(progress, [0, 1], [0, -CLIP_PUSH_RISE_PX]);
  return (
    <AbsoluteFill style={{transform: `translateY(${risePx}px) scale(${scale})`, transformOrigin: COVER_PUSH_ORIGIN}}>
      {children}
    </AbsoluteFill>
  );
};

const StillBackground: React.FC<{src: string}> = ({src}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const driftPx = interpolate(frame, [0, durationInFrames], [-14, 14]);
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Img
        src={staticFile(src)}
        style={{
          width: VIDEO_WIDTH_PX,
          height: VIDEO_HEIGHT_PX,
          objectFit: 'cover',
          transform: `translateX(${driftPx}px) scale(${usePushInScale()})`,
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Square cover scaled to 1500 px and anchored to the bottom, so the man sits below the wordmark.
 * The cover has its own lettering printed in the sky; a navy fade hides it so the wordmark shows once.
 */
const CoverBackground: React.FC<{src: string; focusX: number}> = ({src, focusX}) => {
  const offsetLeftPx = -(COVER_SIZE_PX - VIDEO_WIDTH_PX) * focusX;
  const topPx = VIDEO_HEIGHT_PX - COVER_SIZE_PX;
  const letteringRightPx = COVER_SIZE_PX * COVER_LETTERING_RIGHT_FRACTION + offsetLeftPx;
  const letteringTopPx = topPx + COVER_SIZE_PX * COVER_LETTERING_TOP_FRACTION;
  const letteringBottomPx = topPx + COVER_SIZE_PX * COVER_LETTERING_BOTTOM_FRACTION;
  const fadeMask = 'linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)';
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <div
        style={{
          width: VIDEO_WIDTH_PX,
          height: VIDEO_HEIGHT_PX,
          transform: `scale(${usePushInScale()})`,
          transformOrigin: COVER_PUSH_ORIGIN,
        }}
      >
        <Img
          src={staticFile(src)}
          style={{position: 'absolute', top: topPx, left: offsetLeftPx, width: COVER_SIZE_PX, height: COVER_SIZE_PX}}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: VIDEO_WIDTH_PX,
            height: topPx + COVER_SEAM_FADE_PX,
            background: `linear-gradient(to bottom, ${NAVY_GROUND} 0%, ${NAVY_GROUND} ${(topPx / (topPx + COVER_SEAM_FADE_PX)) * 100}%, ${NAVY_GROUND}00 100%)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: letteringTopPx - 40,
            width: letteringRightPx + 60,
            height: letteringBottomPx - letteringTopPx + 80,
            background: `linear-gradient(to right, ${NAVY_GROUND}fa 0%, ${NAVY_GROUND}f5 75%, ${NAVY_GROUND}00 100%)`,
            WebkitMaskImage: fadeMask,
            maskImage: fadeMask,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const IntroThenLoop: React.FC<ReelBackgroundProps & {introClipSrc: string; loopClipSrc: string}> = (props) => {
  const {durationInFrames} = useVideoConfig();
  const plan = planBackground({
    kind: 'intro-loop',
    totalFrames: durationInFrames,
    introClipFrames: props.introClipFrames,
    loopClipFrames: props.loopClipFrames,
  });
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={plan.introFrames}>
        <ClipLayer src={props.introClipSrc} />
      </Sequence>
      <Sequence from={plan.loopStartFrame} durationInFrames={getLoopLayerFrames(plan, durationInFrames)}>
        <FadeIn frames={plan.crossfadeFrames}>
          <LoopingClip src={props.loopClipSrc} clipFrames={plan.loopClipFrames} />
        </FadeIn>
      </Sequence>
    </AbsoluteFill>
  );
};

const FadeIn: React.FC<{frames: number; children: React.ReactNode}> = ({frames, children}) => {
  const frame = useCurrentFrame();
  const opacity = frames > 0 ? interpolate(frame, [0, frames], [0, 1], {extrapolateRight: 'clamp'}) : 1;
  return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
};

export const ReelBackground: React.FC<ReelBackgroundProps> = (props) => {
  const kind = selectBackgroundKind(props);
  return (
    <AbsoluteFill style={{backgroundColor: NAVY_GROUND}}>
      {kind === 'intro-loop' && props.introClipSrc && props.loopClipSrc ? (
        <IntroThenLoop {...props} introClipSrc={props.introClipSrc} loopClipSrc={props.loopClipSrc} />
      ) : null}
      {kind === 'loop' && props.loopClipSrc ? (
        <ClipPushIn>
          <LoopingClip src={props.loopClipSrc} clipFrames={props.loopClipFrames} />
        </ClipPushIn>
      ) : null}
      {kind === 'intro' && props.introClipSrc ? (
        <LoopingClip src={props.introClipSrc} clipFrames={props.introClipFrames} />
      ) : null}
      {kind === 'still' && props.stillSrc ? <StillBackground src={props.stillSrc} /> : null}
      {kind === 'cover' ? <CoverBackground src={props.coverSrc} focusX={props.coverFocusX} /> : null}
    </AbsoluteFill>
  );
};
