import type { AABB } from './types';

export interface ThreatAssessor {
  msUntilThreatens(target: AABB, horizonMs: number): number | null;
}

export function isPatientAttack(commitmentMs: number, threats: ThreatAssessor[], target: AABB): boolean {
  return threats.every((threat) => threat.msUntilThreatens(target, commitmentMs) === null);
}
