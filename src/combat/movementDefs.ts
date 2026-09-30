import type { AABB } from './types';
import type { ActionType } from './actionRegistry';

export const PLAYER_MOVE_SPEED = 160; // px/s
export const ASSALTANTE_CHASE_SPEED = 90; // px/s, slower than the player
export const DASH_DISTANCE = 80; // px, total displacement over DODGE.durationMs
export const ARENA_BOUNDS: AABB = { x: 0, y: 0, width: 1600, height: 1200 };
export const ATTACK_REACH = 45;
export const ATTACK_HALF_ANGLE_RAD = Math.PI / 4; // 45° pra cada lado da mira — leque de 90° total

// Sub-project 5a (spec 2026-09-30 §3.1) — initial balance values, tune in playtest.
export const PLAYER_MAX_HP = 100;
export const ASSALTANTE_MAX_HP = 60;
/** Damage of an unmitigated Assaltante hit. Block and parry deal no HP damage (block already drains poise). */
export const ASSALTANTE_HIT_DAMAGE = 20;
/** Damage dealt by one connecting player action, applied at most once per action. */
export const PLAYER_DAMAGE_BY_ACTION_TYPE: Record<ActionType, number> = {
  light: 10,
  heavy: 20,
  charged: 30,
  throw: 10,
  utility: 0,
};
/** Encounters (Assaltante kills) per room. */
export const ROOM_ENCOUNTER_COUNT = 3;
/** Minimum distance between the player and a freshly spawned Assaltante, in px. */
export const MIN_SPAWN_DISTANCE = 300;
