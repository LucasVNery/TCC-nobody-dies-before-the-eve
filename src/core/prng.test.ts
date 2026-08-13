import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';

describe('createPrng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createPrng(42);
    const b = createPrng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it('produces a different sequence for a different seed', () => {
    const a = createPrng(42);
    const b = createPrng(43);
    expect(a.next()).not.toBe(b.next());
  });

  it('next() stays within [0, 1)', () => {
    const rng = createPrng(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(n) stays within [0, n)', () => {
    const rng = createPrng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });
});
