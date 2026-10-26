import {CROSSFADE_FRAMES, REEL_DEFAULT_DURATION_SECONDS} from './reelTheme';

export type BackgroundSources = {
  introClipSrc?: string;
  loopClipSrc?: string;
  stillSrc?: string;
  coverSrc: string;
};

export type BackgroundKind = 'intro-loop' | 'loop' | 'intro' | 'still' | 'cover';

export type BackgroundPlan = {
  kind: BackgroundKind;
  introFrames: number;
  loopStartFrame: number;
  loopClipFrames: number;
  crossfadeFrames: number;
};

/** Best available source wins: intro+loop, loop, intro, still, cover. */
export function selectBackgroundKind(sources: BackgroundSources): BackgroundKind {
  if (sources.introClipSrc && sources.loopClipSrc) return 'intro-loop';
  if (sources.loopClipSrc) return 'loop';
  if (sources.introClipSrc) return 'intro';
  if (sources.stillSrc) return 'still';
  return 'cover';
}

export function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

export function calculateReelDurationFrames(durationSeconds: number | undefined, fps: number): number {
  return secondsToFrames(durationSeconds ?? REEL_DEFAULT_DURATION_SECONDS, fps);
}

type PlanInput = {
  kind: BackgroundKind;
  totalFrames: number;
  introClipFrames: number;
  loopClipFrames: number;
};

/**
 * Frame ranges of the background layers. The intro plays from frame 0 and the
 * loop starts one crossfade before the intro ends, so both play during the fade.
 * Without an intro, the loop starts at frame 0 with no fade.
 */
export function planBackground({kind, totalFrames, introClipFrames, loopClipFrames}: PlanInput): BackgroundPlan {
  const hasIntro = kind === 'intro-loop';
  const introFrames = hasIntro ? Math.min(introClipFrames, totalFrames) : 0;
  const crossfadeFrames = hasIntro ? Math.min(CROSSFADE_FRAMES, introFrames) : 0;
  return {
    kind,
    introFrames,
    loopStartFrame: hasIntro ? introFrames - crossfadeFrames : 0,
    loopClipFrames: Math.max(1, loopClipFrames),
    crossfadeFrames,
  };
}

export function getLoopLayerFrames(plan: BackgroundPlan, totalFrames: number): number {
  return Math.max(0, totalFrames - plan.loopStartFrame);
}

export const REEL_STILL_SECONDS = [0, 7, 14];

export function getStillFrames(totalFrames: number, fps: number): number[] {
  return REEL_STILL_SECONDS.map((seconds) => seconds * fps).filter((frame) => frame < totalFrames);
}

type VolumeInput = {frame: number; totalFrames: number; fps: number; fadeInSeconds: number; fadeOutSeconds: number};

export function calculateAudioVolume({frame, totalFrames, fps, fadeInSeconds, fadeOutSeconds}: VolumeInput): number {
  const fadeInFrames = Math.max(1, Math.round(fadeInSeconds * fps));
  const fadeOutFrames = Math.max(1, Math.round(fadeOutSeconds * fps));
  const fadeIn = Math.min(1, frame / fadeInFrames);
  const fadeOut = Math.min(1, (totalFrames - frame) / fadeOutFrames);
  return Math.max(0, Math.min(fadeIn, fadeOut));
}
