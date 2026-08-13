import type { AABB } from './types';

export const PLAYER_MOVE_SPEED = 160; // px/s
export const ASSALTANTE_CHASE_SPEED = 90; // px/s, slower than the player
export const DASH_DISTANCE = 80; // px, total displacement over DODGE.durationMs
export const ARENA_BOUNDS: AABB = { x: 0, y: 0, width: 1600, height: 1200 };
export const ATTACK_REACH = 45;
