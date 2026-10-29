// src/combat/eliteDefs.ts
// Elite monster tuning (combat v2). Task 3 completes this file.

/** Telegraph (wind-up) duration per elite attack, in ms. Logged in session.start windows_ms. */
export const ELITE_TELEGRAPH_MS = { swing: 450, combo: 320, lunge: 500, slam: 700 } as const;

/** Elite tuning (ms unless noted; radius in px). */
export const ELITE = {
  slamRadius: 110,
  slamDamage: 30,
  slamRecoveryMs: 600,
  slamActiveMs: 150,
  swingDamage: 20,
  patternPauseMs: 700,
  firstAttackDelayMs: 2000,
  slamMaxDistance: 60, // melee range (= ATTACK_RANGE): the elite closes in instead of slamming from afar
  chargedStaggerMs: 400,
} as const;

/** Relative weights of the patterns that are eligible at the current distance. */
export const ELITE_PATTERN_WEIGHTS = { swing: 4, combo: 2, lunge: 2, slam: 1.5 } as const;

export type AttackKind = 'swing' | 'lunge' | 'combo' | 'slam';
