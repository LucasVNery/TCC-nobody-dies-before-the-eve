// src/combat/testing/eliteTestKit.ts
// Test-only helper: lets fixtures that exercise a pattern skip the elite's opening delay
// (2000 ms since birth) and the mandatory pause, without changing positions or timing.
import type { AssaltanteController } from '../assaltanteController';
import { ELITE } from '../eliteDefs';

interface ElitePrivates {
  ageMs: number;
  sincePatternMs: number;
}

/** Makes the elite pattern-ready right now (opening delay and pause already served). */
export function primeElite(enemy: AssaltanteController): void {
  const p = enemy as unknown as ElitePrivates;
  p.ageMs = ELITE.firstAttackDelayMs;
  p.sincePatternMs = ELITE.patternPauseMs;
}
