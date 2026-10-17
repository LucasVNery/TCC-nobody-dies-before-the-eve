import type { AABB } from '../combat/types';
import { toScreen, type GroundProjection } from './groundProjection';

/** Per-axis follow smoothing of the main camera (1 = rigid follow). */
export const CAMERA_FOLLOW_LERP = 0.12;

/** Background color shown outside the map. */
export const VOID_COLOR = 0x0b0e13;

/**
 * Screen-space camera bounds: the projected arena corners expanded by
 * marginTiles tiles (tileScreenWidth horizontally, tileScreenHeight vertically).
 */
export function worldCameraBounds(
  arena: AABB,
  p: GroundProjection,
  marginTiles: number,
): { x: number; y: number; width: number; height: number } {
  const topLeft = toScreen({ x: arena.x, y: arena.y }, p);
  const bottomRight = toScreen({ x: arena.x + arena.width, y: arena.y + arena.height }, p);
  const marginX = marginTiles * p.tileScreenWidth;
  const marginY = marginTiles * p.tileScreenHeight;
  return {
    x: topLeft.x - marginX,
    y: topLeft.y - marginY,
    width: bottomRight.x - topLeft.x + 2 * marginX,
    height: bottomRight.y - topLeft.y + 2 * marginY,
  };
}
