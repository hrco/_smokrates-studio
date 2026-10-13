import React from 'react';
import {Composition} from 'remotion';
import {TrackCard, type TrackCardProps} from './compositions/TrackCard';
import {
  VIDEO_DURATION_FRAMES,
  VIDEO_FPS,
  VIDEO_HEIGHT_PX,
  VIDEO_WIDTH_PX,
} from './compositions/smokratesTheme';

export const TRACK_CARD_COMPOSITION_ID = 'TrackCard';

const previewProps: TrackCardProps = {
  title: 'Golden Hour Groove',
  theme: 'Warm golden-hour funky dub that flows without drops',
  coverSrc: 'media/preview/cover.png',
  audioSrc: 'media/preview/track.mp3',
  audioStartSeconds: 0,
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id={TRACK_CARD_COMPOSITION_ID}
    component={TrackCard}
    width={VIDEO_WIDTH_PX}
    height={VIDEO_HEIGHT_PX}
    fps={VIDEO_FPS}
    durationInFrames={VIDEO_DURATION_FRAMES}
    defaultProps={previewProps}
  />
);
