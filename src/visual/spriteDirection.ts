// src/visual/spriteDirection.ts
import type { Vec2 } from '../combat/types';

export const DIRECTION_COUNT = 8;

/**
 * Buckets a screen-space direction vector into one of 8 sprite-sheet rows.
 * Index 0 = east ({1,0}), increasing clockwise on screen (y grows downward)
 * in 45-degree steps: 2 = south, 4 = west, 6 = north. Magnitude doesn't
 * matter — only angle. The actual rendered sprite sheet's row-to-direction
 * correspondence is calibrated empirically against this convention in
 * DirectionalSprite (see tools/blender/README.md) — if that calibration
 * ever changes, update it there, not this function's own convention.
 */
export function directionBucket(screenDir: Vec2): number {
  const angle = Math.atan2(screenDir.y, screenDir.x);
  const sector = Math.round(angle / (Math.PI / 4));
  return ((sector % DIRECTION_COUNT) + DIRECTION_COUNT) % DIRECTION_COUNT;
}
