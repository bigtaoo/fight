import { fromFp } from '@dnf/engine';

// World to screen. Logical screen 1920x1080; the floor band starts at GROUND_TOP (depth 0, the
// back) and runs down 360 units to the front. A body's screen y is its floor y minus its height.

export const VIEW_W = 1920;
export const VIEW_H = 1080;
export const GROUND_TOP = 660;

/** Screen y of the floor at depth `y` (world units). */
export function floorY(y: number): number {
  return GROUND_TOP + y;
}

/** Interpolated value between the last two ticks. */
export function lerp(prev: number, cur: number, alpha: number): number {
  return fromFp(prev + (cur - prev) * alpha);
}

/** Camera x (left edge of the view, world units) following `x`, kept inside the room. */
export function cameraX(x: number, roomWidth: number): number {
  const w = fromFp(roomWidth);
  return Math.min(Math.max(x - VIEW_W * 0.4, 0), Math.max(0, w - VIEW_W));
}
