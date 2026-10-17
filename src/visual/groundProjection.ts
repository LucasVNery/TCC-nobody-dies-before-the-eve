import type { Vec2 } from '../combat/types';

/**
 * Screen-aligned pitched ground projection (Hades-style): world x maps
 * straight to screen x, world y is foreshortened by the camera pitch.
 * One world tile (tileWorldSize square) draws as tileScreenWidth x
 * tileScreenHeight on screen. Linear with no offset, so it also projects
 * direction vectors.
 */
export interface GroundProjection {
  tileWorldSize: number;
  tileScreenWidth: number;
  tileScreenHeight: number;
}

export const GROUND_TILE_SIZE = 64;

export const GROUND_PROJECTION: GroundProjection = {
  tileWorldSize: GROUND_TILE_SIZE,
  tileScreenWidth: 64,
  tileScreenHeight: 48,
};

export function toScreen(pos: Vec2, p: GroundProjection): Vec2 {
  return {
    x: (pos.x * p.tileScreenWidth) / p.tileWorldSize,
    y: (pos.y * p.tileScreenHeight) / p.tileWorldSize,
  };
}

/** Inverse of toScreen for a screen-space delta (also works for absolute points, since toScreen has no offset). */
export function fromScreen(delta: Vec2, p: GroundProjection): Vec2 {
  return {
    x: (delta.x * p.tileWorldSize) / p.tileScreenWidth,
    y: (delta.y * p.tileWorldSize) / p.tileScreenHeight,
  };
}

/** Draw order: things lower on screen (greater world y) draw in front. */
export function screenDepth(pos: Vec2, _p: GroundProjection): number {
  return pos.y;
}
