import {VIDEO_HEIGHT_PX, VIDEO_WIDTH_PX} from '../smokratesTheme';

export type PixelRect = {leftPx: number; topPx: number; widthPx: number; heightPx: number};

export const SAFE_ZONE_TOP_PX = 250;
export const SAFE_ZONE_BOTTOM_PX = 640;
export const SAFE_ZONE_RIGHT_PX = 130;

/** The three strips the Reels/TikTok interface covers: top, bottom, right. They do not overlap. */
export function getUnsafeRects(): PixelRect[] {
  return [
    {leftPx: 0, topPx: 0, widthPx: VIDEO_WIDTH_PX, heightPx: SAFE_ZONE_TOP_PX},
    {leftPx: 0, topPx: VIDEO_HEIGHT_PX - SAFE_ZONE_BOTTOM_PX, widthPx: VIDEO_WIDTH_PX, heightPx: SAFE_ZONE_BOTTOM_PX},
    {
      leftPx: VIDEO_WIDTH_PX - SAFE_ZONE_RIGHT_PX,
      topPx: SAFE_ZONE_TOP_PX,
      widthPx: SAFE_ZONE_RIGHT_PX,
      heightPx: VIDEO_HEIGHT_PX - SAFE_ZONE_TOP_PX - SAFE_ZONE_BOTTOM_PX,
    },
  ];
}

export function getSafeRect(): PixelRect {
  return {
    leftPx: 0,
    topPx: SAFE_ZONE_TOP_PX,
    widthPx: VIDEO_WIDTH_PX - SAFE_ZONE_RIGHT_PX,
    heightPx: VIDEO_HEIGHT_PX - SAFE_ZONE_TOP_PX - SAFE_ZONE_BOTTOM_PX,
  };
}
