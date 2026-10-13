import {describe, expect, it} from 'vitest';
import {calculateReviewDemoFrames, toFrameCount} from '../src/demo/reviewDemoTimeline';

describe('toFrameCount', () => {
  it('rounds partial frames up', () => {
    expect(toFrameCount(15, 30)).toBe(450);
    expect(toFrameCount(2.51, 30)).toBe(76);
  });

  it('never returns less than one frame', () => {
    expect(toFrameCount(0, 30)).toBe(1);
  });
});

describe('calculateReviewDemoFrames', () => {
  it('sums cards and the mac clip when there is no phone clip', () => {
    expect(calculateReviewDemoFrames({macClipFrames: 450})).toBe(285 + 450);
  });

  it('adds the step card and phone clip when present', () => {
    expect(calculateReviewDemoFrames({macClipFrames: 450, phoneClipFrames: 450})).toBe(285 + 450 + 75 + 450);
  });
});
