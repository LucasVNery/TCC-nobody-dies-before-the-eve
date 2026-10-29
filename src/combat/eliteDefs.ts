// src/combat/eliteDefs.ts
// Elite monster tuning (combat v2). Task 3 completes this file.

/** Telegraph (wind-up) duration per elite attack, in ms. Logged in session.start windows_ms. */
export const ELITE_TELEGRAPH_MS = { swing: 450, combo: 320, lunge: 500, slam: 700 } as const;

/** Elite tuning (ms unless noted; radius in px). */
export const ELITE = {
  comboGapTelegraphMs: 320,
  slamRadius: 110,
  slamDamage: 30,
  slamRecoveryMs: 600,
  slamActiveMs: 150,
  swingDamage: 20,
  patternPauseMs: 700,
  firstAttackDelayMs: 2000,
  slamMaxDistance: 140,
  chargedStaggerMs: 400,
} as const;

export type AttackKind = 'swing' | 'lunge' | 'combo' | 'slam';
