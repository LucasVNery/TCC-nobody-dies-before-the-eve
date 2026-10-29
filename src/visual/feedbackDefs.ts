// src/visual/feedbackDefs.ts
// Pure tuning and helpers for the production-style combat feedback (spec combate-v2 §4.4).

/** Camera shake amplitude in screen px. */
export const SHAKE_PX = { light: 4, heavy: 9 } as const;
export const SHAKE_DECAY_MS = 250;
/** White flash on the entity that was hit. */
export const FLASH_MS = 100;
/** Floating damage number lifetime. */
export const DAMAGE_NUMBER_MS = 700;

export function shakeFor(kind: 'light' | 'heavy'): { px: number; decayMs: number } {
  return { px: SHAKE_PX[kind], decayMs: SHAKE_DECAY_MS };
}

/** Fill fraction of a telegraph indicator: progress clamped to 0..1 (non-finite counts as 0). */
export function telegraphFill(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}
