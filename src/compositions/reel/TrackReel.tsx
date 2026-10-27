import React from 'react';
import {AbsoluteFill, Html5Audio, staticFile, useVideoConfig, type CalculateMetadataFunction} from 'remotion';
import {getVideoMetadata} from '@remotion/media-utils';
import {NAVY_GROUND, VIDEO_FPS} from '../smokratesTheme';
import {AudioBars, useAudioReaction} from './AudioBars';
import {FilmFinish} from './FilmFinish';
import {ReelBackground} from './ReelBackground';
import {SafeZoneOverlay} from './SafeZoneOverlay';
import {Wordmark} from './Wordmark';
import {
  AUDIO_FADE_IN_SECONDS,
  AUDIO_FADE_OUT_SECONDS,
  BREATH_MAX_BRIGHTNESS_BOOST,
  BREATH_MAX_SCALE_BOOST,
  REEL_DEFAULT_COVER_FOCUS_X,
} from './reelTheme';
import {calculateAudioVolume, calculateReelDurationFrames, secondsToFrames} from './reelTimeline';

export type TrackReelProps = {
  shortLine: string;
  audioSrc: string;
  audioStartSeconds?: number;
  durationSeconds?: number;
  introClipSrc?: string;
  loopClipSrc?: string;
  stillSrc?: string;
  coverSrc: string;
  coverFocusX?: number;
  introClipSeconds?: number;
  loopClipSeconds?: number;
  shouldDrawSafeZone?: boolean;
};

const FALLBACK_CLIP_SECONDS = 4;

async function readClipSeconds(clipSrc: string | undefined): Promise<number | undefined> {
  if (!clipSrc) return undefined;
  const metadata = await getVideoMetadata(staticFile(clipSrc));
  return metadata.durationInSeconds;
}

/** Sets the length from props and measures the clips, so the loop and crossfade know where to cut. */
export const calculateTrackReelMetadata: CalculateMetadataFunction<TrackReelProps> = async ({props}) => {
  const [introClipSeconds, loopClipSeconds] = await Promise.all([
    readClipSeconds(props.introClipSrc),
    readClipSeconds(props.loopClipSrc),
  ]);
  return {
    durationInFrames: calculateReelDurationFrames(props.durationSeconds, VIDEO_FPS),
    props: {...props, introClipSeconds, loopClipSeconds},
  };
};

export const TrackReel: React.FC<TrackReelProps> = (props) => {
  const {fps, durationInFrames} = useVideoConfig();
  const audioStartSeconds = props.audioStartSeconds ?? 0;
  const {barLevels, bassLevel} = useAudioReaction(props.audioSrc, audioStartSeconds);
  const breathScale = 1 + bassLevel * BREATH_MAX_SCALE_BOOST;
  const breathBrightness = 1 + bassLevel * BREATH_MAX_BRIGHTNESS_BOOST;

  return (
    <AbsoluteFill style={{backgroundColor: NAVY_GROUND}}>
      <AbsoluteFill style={{transform: `scale(${breathScale})`, filter: `brightness(${breathBrightness})`}}>
        <ReelBackground
          introClipSrc={props.introClipSrc}
          loopClipSrc={props.loopClipSrc}
          stillSrc={props.stillSrc}
          coverSrc={props.coverSrc}
          coverFocusX={props.coverFocusX ?? REEL_DEFAULT_COVER_FOCUS_X}
          introClipFrames={secondsToFrames(props.introClipSeconds ?? FALLBACK_CLIP_SECONDS, fps)}
          loopClipFrames={secondsToFrames(props.loopClipSeconds ?? FALLBACK_CLIP_SECONDS, fps)}
        />
      </AbsoluteFill>
      <FilmFinish />
      <Wordmark shortLine={props.shortLine} />
      <AudioBars barLevels={barLevels} />
      <Html5Audio
        src={staticFile(props.audioSrc)}
        trimBefore={Math.round(audioStartSeconds * fps)}
        volume={(frame) =>
          calculateAudioVolume({
            frame,
            totalFrames: durationInFrames,
            fps,
            fadeInSeconds: AUDIO_FADE_IN_SECONDS,
            fadeOutSeconds: AUDIO_FADE_OUT_SECONDS,
          })
        }
      />
      {props.shouldDrawSafeZone ? <SafeZoneOverlay /> : null}
    </AbsoluteFill>
  );
};
