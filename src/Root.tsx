import React from 'react';
import {Composition} from 'remotion';
import {
  REVIEW_DEMO_HEIGHT_PX,
  REVIEW_DEMO_WIDTH_PX,
  ReviewDemo,
  type ReviewDemoProps,
} from './compositions/ReviewDemo';
import {TrackCard, type TrackCardProps} from './compositions/TrackCard';
import {calculateReviewDemoFrames, REVIEW_DEMO_FPS} from './demo/reviewDemoTimeline';
import {
  VIDEO_DURATION_FRAMES,
  VIDEO_FPS,
  VIDEO_HEIGHT_PX,
  VIDEO_WIDTH_PX,
} from './compositions/smokratesTheme';

export const TRACK_CARD_COMPOSITION_ID = 'TrackCard';
export const REVIEW_DEMO_COMPOSITION_ID = 'ReviewDemo';

const previewProps: TrackCardProps = {
  title: 'Golden Hour Groove',
  theme: 'Warm golden-hour funky dub that flows without drops',
  coverSrc: 'media/preview/cover.png',
  audioSrc: 'media/preview/track.mp3',
  audioStartSeconds: 0,
};

const reviewDemoPreviewProps: ReviewDemoProps = {
  macClipSrc: 'media/review-demo/mac.mp4',
  macClipFrames: 300,
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id={TRACK_CARD_COMPOSITION_ID}
      component={TrackCard}
      width={VIDEO_WIDTH_PX}
      height={VIDEO_HEIGHT_PX}
      fps={VIDEO_FPS}
      durationInFrames={VIDEO_DURATION_FRAMES}
      defaultProps={previewProps}
    />
    <Composition
      id={REVIEW_DEMO_COMPOSITION_ID}
      component={ReviewDemo}
      width={REVIEW_DEMO_WIDTH_PX}
      height={REVIEW_DEMO_HEIGHT_PX}
      fps={REVIEW_DEMO_FPS}
      durationInFrames={calculateReviewDemoFrames(reviewDemoPreviewProps)}
      defaultProps={reviewDemoPreviewProps}
      calculateMetadata={({props}) => ({durationInFrames: calculateReviewDemoFrames(props)})}
    />
  </>
);
