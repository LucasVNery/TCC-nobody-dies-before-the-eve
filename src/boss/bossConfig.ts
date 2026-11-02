// Tunable parameters of the profile-driven boss (proposed values).

/** Encounters in the arena before the boss appears. */
export const BOSS_AFTER_ENCOUNTERS = 3;

export interface BossConfig {
  // Habit gate
  enterRuns: number;
  windowRuns: number;
  exitRuns: number;
  onset: number;
  enterConfidence: number;
  exitConfidence: number;
  maxActive: number;
  // Evidence per run
  minLabels: number;
  minNearSeconds: number;
  // Habit qualification
  farNearFractionMax: number;
  dodgeShareMin: number;
  blockShareMin: number;
  reflexMinCount: number;
  reflexToleranceMs: number;
  reflexMaxLevelCount: number;
  // Responses
  barrageMaxFraction: number;
  barrageFrequencyUntil: number;
  barrageDurationMaxMult: number;
  advanceMaxMult: number;
  dashCooldownMaxMs: number;
  // Base boss
  bossMaxHp: number;
  barrageBaseStrikes: number;
  barragePauseMs: number;
  barrageCooldownMs: number;
  passiveWindowMs: number;
  passiveMaxSpeed: number;
  passiveMaxDistance: number;
}

export const BOSS_CONFIG: BossConfig = {
  enterRuns: 3,
  windowRuns: 5,
  exitRuns: 1,
  onset: 0.2,
  enterConfidence: 0.6,
  exitConfidence: 0.4,
  maxActive: 2,
  minLabels: 8,
  minNearSeconds: 20,
  farNearFractionMax: 0.15,
  dodgeShareMin: 0.7,
  blockShareMin: 0.6,
  reflexMinCount: 10,
  reflexToleranceMs: 150,
  reflexMaxLevelCount: 30,
  barrageMaxFraction: 0.5,
  barrageFrequencyUntil: 0.6,
  barrageDurationMaxMult: 1.5,
  advanceMaxMult: 1.4,
  dashCooldownMaxMs: 4000,
  bossMaxHp: 400,
  barrageBaseStrikes: 3,
  barragePauseMs: 250,
  barrageCooldownMs: 6000,
  passiveWindowMs: 1200,
  passiveMaxSpeed: 20,
  passiveMaxDistance: 120,
};

/** Short-run variant for demos and playtests. */
export const BOSS_CONFIG_DEMO: BossConfig = {
  ...BOSS_CONFIG,
  enterRuns: 1,
  windowRuns: 3,
  exitRuns: 0,
  reflexMinCount: 4,
};
