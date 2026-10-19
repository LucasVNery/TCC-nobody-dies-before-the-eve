import type { AABB } from '../combat/types';
import { toScreen, type GroundProjection } from './groundProjection';

/** Per-axis follow smoothing of the main camera (1 = rigid follow). */
export const CAMERA_FOLLOW_LERP = 0.12;

/** Background color shown outside the map. */
export const VOID_COLOR = 0x0b0e13;

/**
 * Screen-space camera bounds: the bounding box of the four projected corners
 * of the arena expanded by marginTiles world tiles on every side.
 */
export function worldCameraBounds(
  arena: AABB,
  p: GroundProjection,
  marginTiles: number,
): { x: number; y: number; width: number; height: number } {
  const m = marginTiles * p.tileWorldSize;
  const x0 = arena.x - m;
  const y0 = arena.y - m;
  const x1 = arena.x + arena.width + m;
  const y1 = arena.y + arena.height + m;
  const corners = [
    toScreen({ x: x0, y: y0 }, p),
    toScreen({ x: x1, y: y0 }, p),
    toScreen({ x: x1, y: y1 }, p),
    toScreen({ x: x0, y: y1 }, p),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}
