import {describe, expect, it} from 'vitest';
import {
  calculateAudioVolume,
  calculateReelDurationFrames,
  getLoopLayerFrames,
  getStillFrames,
  planBackground,
  selectBackgroundKind,
} from '../src/compositions/reel/reelTimeline';

describe('selectBackgroundKind', () => {
  it.each([
    [{introClipSrc: 'i', loopClipSrc: 'l', stillSrc: 's', coverSrc: 'c'}, 'intro-loop'],
    [{loopClipSrc: 'l', stillSrc: 's', coverSrc: 'c'}, 'loop'],
    [{introClipSrc: 'i', stillSrc: 's', coverSrc: 'c'}, 'intro'],
    [{stillSrc: 's', coverSrc: 'c'}, 'still'],
    [{coverSrc: 'c'}, 'cover'],
  ])('picks the best source for %j', (sources, expectedKind) => {
    expect(selectBackgroundKind(sources)).toBe(expectedKind);
  });
});

describe('planBackground', () => {
  it('starts the loop one crossfade before the intro ends', () => {
    const plan = planBackground({kind: 'intro-loop', totalFrames: 480, introClipFrames: 180, loopClipFrames: 120});
    expect(plan).toMatchObject({introFrames: 180, crossfadeFrames: 12, loopStartFrame: 168, loopClipFrames: 120});
    expect(getLoopLayerFrames(plan, 480)).toBe(312);
  });

  it('cuts the intro at the end of a short video', () => {
    const plan = planBackground({kind: 'intro-loop', totalFrames: 100, introClipFrames: 180, loopClipFrames: 120});
    expect(plan.introFrames).toBe(100);
    expect(plan.loopStartFrame).toBe(88);
  });

  it('plays a lone loop from frame 0 without a fade', () => {
    const plan = planBackground({kind: 'loop', totalFrames: 480, introClipFrames: 0, loopClipFrames: 120});
    expect(plan).toMatchObject({introFrames: 0, crossfadeFrames: 0, loopStartFrame: 0});
    expect(getLoopLayerFrames(plan, 480)).toBe(480);
  });
});

describe('reel length and stills', () => {
  it('defaults to 16 seconds', () => {
    expect(calculateReelDurationFrames(undefined, 30)).toBe(480);
    expect(calculateReelDurationFrames(12.5, 30)).toBe(375);
  });

  it('takes stills at 0, 7 and 14 seconds that fit the video', () => {
    expect(getStillFrames(480, 30)).toEqual([0, 210, 420]);
    expect(getStillFrames(300, 30)).toEqual([0, 210]);
  });
});

describe('calculateAudioVolume', () => {
  const options = {totalFrames: 480, fps: 30, fadeInSeconds: 0.3, fadeOutSeconds: 1.5};

  it('fades in over 0.3 s and out over 1.5 s', () => {
    expect(calculateAudioVolume({...options, frame: 0})).toBe(0);
    expect(calculateAudioVolume({...options, frame: 9})).toBe(1);
    expect(calculateAudioVolume({...options, frame: 240})).toBe(1);
    expect(calculateAudioVolume({...options, frame: 480 - 22.5})).toBeCloseTo(0.5);
    expect(calculateAudioVolume({...options, frame: 480})).toBe(0);
  });
});
