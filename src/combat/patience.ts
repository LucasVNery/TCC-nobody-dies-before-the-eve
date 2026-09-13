// src/combat/patience.ts
import type { AABB } from './types';

export interface ThreatAssessor {
  /**
   * Returns the number of ms until this enemy's hitbox would first reach
   * `target`, or `null` if it provably cannot within `horizonMs`.
   * `null` always means *safe* — never "unknown" or "not evaluated". This is
   * the extension point future enemy archetypes implement, so any new
   * implementation must preserve this exact contract.
   */
  msUntilThreatens(target: AABB, horizonMs: number): number | null;
}

export function isPatientAttack(commitmentMs: number, threats: readonly ThreatAssessor[], target: AABB): boolean {
  return threats.every((threat) => threat.msUntilThreatens(target, commitmentMs) === null);
}
