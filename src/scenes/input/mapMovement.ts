import { fromScreen } from '../../visual/isometricProjection';
import { ISO_CONFIG } from '../../visual/placeholderTextures';
import type { Vec2 } from '../../combat/types';

/**
 * Rotates WASD 45° so each key drives the player toward a screen-space point
 * of the isometric diamond, instead of along the cartesian world axes.
 */
export function mapMovement(ix: number, iy: number): { dx: number; dy: number } {
  return { dx: ix + iy, dy: iy - ix };
}

/** World-space aim direction from the pointer's world (screen-plane) point and the player's screen position. */
export function mapAim(pointerWorld: Vec2, playerScreen: Vec2): Vec2 {
  return fromScreen({ x: pointerWorld.x - playerScreen.x, y: pointerWorld.y - playerScreen.y }, ISO_CONFIG);
}
