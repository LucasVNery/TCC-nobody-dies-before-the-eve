import { fromScreen, toScreen, GROUND_PROJECTION } from '../../visual/groundProjection';
import { ENTITY_SIZE } from '../../visual/placeholderTextures';
import type { Vec2 } from '../../combat/types';

/**
 * Rotates screen-space WASD input by 45° into world axes so the keys stay
 * screen-aligned under the 2:1 diamond projection: D is screen-right
 * (world +x, -y), W is screen-up (world -x, -y). Not normalised; the caller
 * normalises the resulting vector.
 */
export function mapMovement(ix: number, iy: number): { dx: number; dy: number } {
  return { dx: ix + iy, dy: iy - ix };
}

/** World-space aim direction from the pointer's world (screen-plane) point and the player's screen position. */
export function mapAim(pointerWorld: Vec2, playerScreen: Vec2): Vec2 {
  return fromScreen({ x: pointerWorld.x - playerScreen.x, y: pointerWorld.y - playerScreen.y }, GROUND_PROJECTION);
}

/** Screen-plane point of the attack origin: the centre of the player's hurtbox (position is its top-left corner). */
export function aimOrigin(position: Vec2): Vec2 {
  return toScreen({ x: position.x + ENTITY_SIZE / 2, y: position.y + ENTITY_SIZE / 2 }, GROUND_PROJECTION);
}
