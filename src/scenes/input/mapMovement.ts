import { fromScreen, GROUND_PROJECTION } from '../../visual/groundProjection';
import type { Vec2 } from '../../combat/types';

/**
 * WASD drives the player along the world axes directly: the ground projection
 * is screen-aligned, so world +x is screen-right and world +y is screen-down.
 */
export function mapMovement(ix: number, iy: number): { dx: number; dy: number } {
  return { dx: ix, dy: iy };
}

/** World-space aim direction from the pointer's world (screen-plane) point and the player's screen position. */
export function mapAim(pointerWorld: Vec2, playerScreen: Vec2): Vec2 {
  return fromScreen({ x: pointerWorld.x - playerScreen.x, y: pointerWorld.y - playerScreen.y }, GROUND_PROJECTION);
}
