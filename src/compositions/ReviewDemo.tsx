import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, Series, staticFile} from 'remotion';
import {
  END_CARD_SECONDS,
  REVIEW_DEMO_FPS,
  STEP_CARD_SECONDS,
  TITLE_CARD_SECONDS,
  toFrameCount,
} from '../demo/reviewDemoTimeline';
import {CREAM_TEXT, NAVY_GROUND, NEON_CYAN, NEON_TEXT_SHADOW} from './smokratesTheme';

export type ReviewDemoProps = {
  macClipSrc: string;
  macClipFrames: number;
  phoneClipSrc?: string;
  phoneClipFrames?: number;
};

export const REVIEW_DEMO_WIDTH_PX = 1920;
export const REVIEW_DEMO_HEIGHT_PX = 1080;
export const REVIEW_DEMO_LOGO_SRC = 'brand/nopanicpost-logo.png';
const SITE_URL = 'nopanicpost.donotpanic.space';
const TITLE_LINES = [
  `Website: ${SITE_URL}`,
  'Login Kit: user.info.basic, video.upload',
  'Content Posting API: upload to inbox (draft)',
  'Environment: Sandbox',
];
const BODY_FONT = '"Helvetica Neue", Arial, sans-serif';
const HEADLINE_FONT = 'Impact, "Arial Black", sans-serif';

const CardFrame: React.FC<{children: React.ReactNode}> = ({children}) => (
  <AbsoluteFill
    style={{
      backgroundColor: NAVY_GROUND,
      color: CREAM_TEXT,
      fontFamily: BODY_FONT,
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '0 160px',
    }}
  >
    {children}
  </AbsoluteFill>
);

const TitleCard: React.FC = () => (
  <CardFrame>
    <Img src={staticFile(REVIEW_DEMO_LOGO_SRC)} style={{height: 220, objectFit: 'contain'}} />
    <div
      style={{
        marginTop: 36,
        fontFamily: HEADLINE_FONT,
        fontSize: 92,
        textShadow: NEON_TEXT_SHADOW,
      }}
    >
      NoPanicPost — end-to-end demo
    </div>
    <div style={{marginTop: 48, fontSize: 40, lineHeight: 1.6}}>
      {TITLE_LINES.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  </CardFrame>
);

const MessageCard: React.FC<{message: string; footnote?: string}> = ({message, footnote}) => (
  <CardFrame>
    <div style={{fontSize: 68, lineHeight: 1.25, textShadow: NEON_TEXT_SHADOW}}>{message}</div>
    {footnote ? <div style={{marginTop: 56, fontSize: 44, color: NEON_CYAN}}>{footnote}</div> : null}
  </CardFrame>
);

const ClipOnNavy: React.FC<{src: string}> = ({src}) => (
  <AbsoluteFill style={{backgroundColor: NAVY_GROUND}}>
    <OffthreadVideo src={staticFile(src)} muted style={{width: '100%', height: '100%', objectFit: 'contain'}} />
  </AbsoluteFill>
);

export const ReviewDemo: React.FC<ReviewDemoProps> = ({
  macClipSrc,
  macClipFrames,
  phoneClipSrc,
  phoneClipFrames,
}) => {
  const titleFrames = toFrameCount(TITLE_CARD_SECONDS, REVIEW_DEMO_FPS);
  const stepFrames = toFrameCount(STEP_CARD_SECONDS, REVIEW_DEMO_FPS);
  const endFrames = toFrameCount(END_CARD_SECONDS, REVIEW_DEMO_FPS);

  return (
    <Series>
      <Series.Sequence durationInFrames={titleFrames}>
        <TitleCard />
      </Series.Sequence>
      <Series.Sequence durationInFrames={stepFrames}>
        <MessageCard message="1. Open the app website, sign in with TikTok, upload as a draft" />
      </Series.Sequence>
      <Series.Sequence durationInFrames={macClipFrames}>
        <ClipOnNavy src={macClipSrc} />
      </Series.Sequence>
      {phoneClipSrc && phoneClipFrames ? (
        <Series.Sequence durationInFrames={stepFrames}>
          <MessageCard message="2. The draft arrives in the creator's TikTok inbox. The creator edits and posts in TikTok." />
        </Series.Sequence>
      ) : null}
      {phoneClipSrc && phoneClipFrames ? (
        <Series.Sequence durationInFrames={phoneClipFrames}>
          <ClipOnNavy src={phoneClipSrc} />
        </Series.Sequence>
      ) : null}
      <Series.Sequence durationInFrames={endFrames}>
        <MessageCard
          message="The creator always taps Post in TikTok. NoPanicPost never publishes."
          footnote={SITE_URL}
        />
      </Series.Sequence>
    </Series>
  );
};
