export const REVIEW_DEMO_FPS = 30;
export const TITLE_CARD_SECONDS = 4;
export const STEP_CARD_SECONDS = 2.5;
export const END_CARD_SECONDS = 3;

export type ReviewDemoClipFrames = {
  macClipFrames: number;
  phoneClipFrames?: number;
};

export function toFrameCount(seconds: number, fps: number): number {
  return Math.max(1, Math.ceil(seconds * fps));
}

export function calculateReviewDemoFrames(clips: ReviewDemoClipFrames): number {
  const cardSeconds = TITLE_CARD_SECONDS + STEP_CARD_SECONDS + END_CARD_SECONDS;
  const phoneFrames = clips.phoneClipFrames
    ? toFrameCount(STEP_CARD_SECONDS, REVIEW_DEMO_FPS) + clips.phoneClipFrames
    : 0;
  return toFrameCount(cardSeconds, REVIEW_DEMO_FPS) + clips.macClipFrames + phoneFrames;
}
