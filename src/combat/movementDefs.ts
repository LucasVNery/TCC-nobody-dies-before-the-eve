import type { AABB } from './types';
import type { ActionType } from './actionRegistry';

export const PLAYER_WALK_SPEED = 175; // px/s
export const PLAYER_RUN_SPEED = 220; // px/s, sprint (costs stamina)
export const BLOCK_MOVE_SPEED_FACTOR = 0.5; // fraction of PLAYER_WALK_SPEED while blocking
export const ASSALTANTE_CHASE_SPEED = 150; // px/s, slower than the player's walk (175) and run (220)
export const DASH_DISTANCE = 120; // px, total displacement over DODGE.durationMs
export const ARENA_BOUNDS: AABB = { x: 0, y: 0, width: 1600, height: 1200 };
export const ATTACK_REACH = 45;
export const ATTACK_HALF_ANGLE_RAD = Math.PI / 4; // 45° pra cada lado da mira — leque de 90° total

// Sub-project 5a (spec 2026-09-30 §3.1) — initial balance values, tune in playtest.
export const PLAYER_MAX_HP = 100;
export const ASSALTANTE_MAX_HP = 60;
/** Damage of an unmitigated Assaltante hit. Block and parry deal no HP damage (block already costs stamina). */
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

/** Bow projectile (spec 2026-10-21 §4.4): speed px/s, max travel px, collision radius px. */
export const PROJECTILE = { speed: 500, range: 260, radius: 8 } as const;

/** Assaltante lunge (spec 2026-10-21 §4.5): distances and travel in px, speed px/s, times in ms. */
export const LUNGE = {
  minDistance: 150,
  maxDistance: 260,
  cooldownMs: 6000,
  telegraphMs: 500,
  speed: 450,
  maxTravel: 260,
  recoveryMs: 500,
  contactDistance: 60,
} as const;
