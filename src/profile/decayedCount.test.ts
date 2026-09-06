import { describe, it, expect } from 'vitest';
import { DecayedCount } from './decayedCount';

describe('DecayedCount', () => {
  it('starts at zero', () => {
    const c = new DecayedCount();
    expect(c.value).toBe(0);
  });

  it('add() accumulates into a pending buffer invisible until decay()', () => {
    const c = new DecayedCount();
    c.add(3);
    expect(c.value).toBe(0);
  });

  it('add() defaults to incrementing by 1', () => {
    const c = new DecayedCount();
    c.add();
    c.decay(1);
    expect(c.value).toBe(1);
  });

  it('decay() folds pending into the total by gamma and clears pending', () => {
    const c = new DecayedCount();
    c.add(3);
    c.decay(0.8);
    expect(c.value).toBe(3);
    c.decay(0.8); // no new pending
    expect(c.value).toBeCloseTo(2.4);
  });

  it('reset() zeroes both total and pending', () => {
    const c = new DecayedCount();
    c.add(3);
    c.decay(0.8);
    c.reset();
    expect(c.value).toBe(0);
    c.decay(0.8); // no new pending after reset
    expect(c.value).toBe(0);
  });
});
