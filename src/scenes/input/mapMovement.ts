import { fromScreen, toScreen, GROUND_PROJECTION } from '../../visual/groundProjection';
import { ENTITY_SIZE } from '../../visual/placeholderTextures';
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

/** Screen-plane point of the attack origin: the centre of the player's hurtbox (position is its top-left corner). */
export function aimOrigin(position: Vec2): Vec2 {
  return toScreen({ x: position.x + ENTITY_SIZE / 2, y: position.y + ENTITY_SIZE / 2 }, GROUND_PROJECTION);
}
