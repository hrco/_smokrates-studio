export const NAVY_GROUND = '#0b1030';
export const CREAM_TEXT = '#f3e9d2';
export const NEON_CYAN = '#2fe6ff';
export const NEON_PURPLE = '#a64dff';
export const BAR_GOLD = '#f6e7a1';
export const BAR_PEACH = '#f2a97a';
export const WARM_SKIN = '#e0a47c';

export const NEON_TEXT_SHADOW = [
  `0 0 6px ${NEON_CYAN}`,
  `0 0 18px ${NEON_CYAN}`,
  `0 0 34px ${NEON_PURPLE}`,
  `0 0 60px ${NEON_PURPLE}`,
].join(', ');

export const VIDEO_WIDTH_PX = 1080;
export const VIDEO_HEIGHT_PX = 1920;
export const VIDEO_FPS = 30;
export const VIDEO_DURATION_SECONDS = 15;
export const VIDEO_DURATION_FRAMES = VIDEO_DURATION_SECONDS * VIDEO_FPS;
export const AUDIO_FADE_OUT_SECONDS = 1;

export const TEXT_INSET_LEFT_PX = Math.round(VIDEO_WIDTH_PX * 0.08);
export const TEXT_INSET_TOP_PX = Math.round(VIDEO_HEIGHT_PX * 0.08);
export const TEXT_MAX_WIDTH_PX = Math.round(VIDEO_WIDTH_PX * (1 - 0.08 - 0.12));
export const SAFE_BOTTOM_PX = Math.round(VIDEO_HEIGHT_PX * 0.8);
