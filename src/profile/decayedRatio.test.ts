// src/profile/decayedRatio.test.ts
import { describe, it, expect } from 'vitest';
import { DecayedRatio } from './decayedRatio';

describe('DecayedRatio', () => {
  it('starts at zero', () => {
    const r = new DecayedRatio();
    expect(r.num).toBe(0);
    expect(r.den).toBe(0);
  });

  it('add() accumulates into a pending buffer invisible until decay()', () => {
    const r = new DecayedRatio();
    r.add(3, 5);
    expect(r.num).toBe(0);
    expect(r.den).toBe(0);
  });

  it('decay() folds pending into the total by gamma and clears pending', () => {
    const r = new DecayedRatio();
    r.add(3, 5);
    r.decay(0.8);
    expect(r.num).toBe(3);
    expect(r.den).toBe(5);
    r.decay(0.8); // no new pending
    expect(r.num).toBeCloseTo(2.4);
    expect(r.den).toBeCloseTo(4);
  });

  it('reset() zeroes both total and pending', () => {
    const r = new DecayedRatio();
    r.add(3, 5);
    r.decay(0.8);
    r.reset();
    expect(r.num).toBe(0);
    expect(r.den).toBe(0);
    r.decay(0.8); // no new pending after reset
    expect(r.num).toBe(0);
    expect(r.den).toBe(0);
  });
});
