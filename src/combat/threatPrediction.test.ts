// src/combat/threatPrediction.test.ts
import { describe, it, expect } from 'vitest';
import { predictThreatMs, type ChaseTelegraphConfig, type ChaseTelegraphSnapshot } from './threatPrediction';

const CONFIG: ChaseTelegraphConfig = {
  attackRange: 60,
  chaseSpeedPxPerSec: 90,
  telegraphMs: 400,
  swingMs: 150,
  recoveryMs: 500,
  reach: 55,
  halfAngleRad: Math.PI / 4,
};

describe('predictThreatMs', () => {
  it('idle and far away: returns null when the horizon is too short to close the distance', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'idle',
      phaseElapsedMs: 0,
      position: { x: 0, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 1, y: 0 },
    };
    const target = { x: 1000, y: 0, width: 20, height: 20 };
    expect(predictThreatMs(CONFIG, snapshot, target, 100)).toBeNull();
  });

  it('idle, close enough to close the distance and telegraph within the horizon: returns the exact ms', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'idle',
      phaseElapsedMs: 0,
      position: { x: 0, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 1, y: 0 },
    };
    // distance 150, attackRange 60 -> closes 90px at 90px/s = 1000ms, then +400ms telegraph = 1400ms
    const target = { x: 150, y: 0, width: 20, height: 20 };
    expect(predictThreatMs(CONFIG, snapshot, target, 1500)).toBe(1400);
  });

  it('attacking, telegraphing, aimed at the target: returns the remaining telegraph time', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'attacking',
      phaseElapsedMs: 100,
      position: { x: 40, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 1, y: 0 },
    };
    const target = { x: 80, y: 0, width: 20, height: 20 };
    expect(predictThreatMs(CONFIG, snapshot, target, 350)).toBe(300); // telegraphMs(400) - phaseElapsedMs(100)
  });

  it('attacking but aimed away from the target, horizon too short for a second cycle: returns null', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'attacking',
      phaseElapsedMs: 100,
      position: { x: 40, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 0, y: -1 }, // aimed up, target is to the right
    };
    const target = { x: 100, y: 0, width: 20, height: 20 };
    expect(predictThreatMs(CONFIG, snapshot, target, 400)).toBeNull();
  });

  it('attacking but aimed away, horizon long enough to cover the next attack cycle: returns that ms', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'attacking',
      phaseElapsedMs: 100,
      position: { x: 40, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 0, y: -1 },
    };
    const target = { x: 100, y: 0, width: 20, height: 20 };
    // whiffs this swing (450ms to recover), then re-aims correctly next cycle:
    // 450 (recover) + 500 (recoveryMs) + 400 (telegraph) = 1350
    expect(predictThreatMs(CONFIG, snapshot, target, 2000)).toBe(1350);
  });

  it('recovering, horizon too short to cover the remaining recovery plus telegraph: returns null', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'recovering',
      phaseElapsedMs: 100,
      position: { x: 40, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 1, y: 0 },
    };
    const target = { x: 1000, y: 0, width: 20, height: 20 };
    expect(predictThreatMs(CONFIG, snapshot, target, 300)).toBeNull(); // recoveryMs(500)-100 = 400 > 300
  });

  it('recovering, horizon sufficient: returns the exact ms through the next telegraph', () => {
    const snapshot: ChaseTelegraphSnapshot = {
      state: 'recovering',
      phaseElapsedMs: 100,
      position: { x: 40, y: 0 },
      width: 20,
      height: 20,
      attackDirection: { x: 1, y: 0 },
    };
    // distance to target from (40,0) is 50, already <= attackRange(60): re-attacks immediately after recovering
    const target = { x: 90, y: 0, width: 20, height: 20 };
    // (500-100) recovery + 400 telegraph = 800
    expect(predictThreatMs(CONFIG, snapshot, target, 900)).toBe(800);
  });
});
