import type { Vec2 } from '../combat/types';

/**
 * 2:1 diamond ground projection: the world grid is yawed 45° and pitched so
 * one world tile (tileWorldSize square) draws as a tileScreenWidth x
 * tileScreenHeight diamond. World +x runs screen right-and-down, world +y
 * screen left-and-down. Linear with no offset, so it also projects direction
 * vectors.
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
  tileScreenHeight: 32,
};

export function toScreen(pos: Vec2, p: GroundProjection): Vec2 {
  const t2 = 2 * p.tileWorldSize;
  return {
    x: ((pos.x - pos.y) * p.tileScreenWidth) / t2,
    y: ((pos.x + pos.y) * p.tileScreenHeight) / t2,
  };
}

/** Inverse of toScreen for a screen-space delta (also works for absolute points, since toScreen has no offset). */
export function fromScreen(delta: Vec2, p: GroundProjection): Vec2 {
  const u = delta.x / p.tileScreenWidth;
  const v = delta.y / p.tileScreenHeight;
  return {
    x: p.tileWorldSize * (u + v),
    y: p.tileWorldSize * (v - u),
  };
}

/** Draw order: things lower on screen (greater world x + y) draw in front. */
export function screenDepth(pos: Vec2, _p: GroundProjection): number {
  return pos.x + pos.y;
}
