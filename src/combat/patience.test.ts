// src/combat/patience.test.ts
import { describe, it, expect } from 'vitest';
import { isPatientAttack, type ThreatAssessor } from './patience';

function fakeThreat(msUntilThreatens: number | null): ThreatAssessor {
  return { msUntilThreatens: () => msUntilThreatens };
}

const TARGET = { x: 0, y: 0, width: 20, height: 20 };

describe('isPatientAttack', () => {
  it('is patient (safe) when there are no threats at all', () => {
    expect(isPatientAttack(300, [], TARGET)).toBe(true);
  });

  it('is patient when the only threat reports no danger within the horizon', () => {
    expect(isPatientAttack(300, [fakeThreat(null)], TARGET)).toBe(true);
  });

  it('is not patient when the only threat reports danger within the horizon', () => {
    expect(isPatientAttack(300, [fakeThreat(150)], TARGET)).toBe(false);
  });

  it('is not patient if any of several threats reports danger, even if others are safe', () => {
    expect(isPatientAttack(300, [fakeThreat(null), fakeThreat(150)], TARGET)).toBe(false);
  });
});
