import { describe, expect, it } from 'vitest';
import { createPrng } from '../../core/prng';
import { bootstrapDelta, bootstrapIcc, cliffsDelta, iccOneWay } from './stats';

const SF = [
  [9, 2, 5, 8],
  [6, 1, 3, 2],
  [8, 4, 6, 8],
  [7, 1, 2, 6],
  [10, 5, 6, 9],
  [6, 2, 4, 7],
];

describe('cliffsDelta', () => {
  it('computes the dominance statistic', () => {
    expect(cliffsDelta([1, 2, 3], [2, 3, 4])).toBeCloseTo(-5 / 9, 6);
    expect(cliffsDelta([5, 6], [1, 2])).toBe(1);
    expect(cliffsDelta([1], [1])).toBe(0);
  });
  it('is null when a group is empty', () => {
    expect(cliffsDelta([], [1])).toBeNull();
    expect(cliffsDelta([1], [])).toBeNull();
  });
});

describe('iccOneWay', () => {
  it('ICC(1,1) reproduces the Shrout and Fleiss example', () => {
    expect(iccOneWay(SF)).toBeCloseTo(0.1657, 3);
  });
  it('is 1 for identical-within, different-between groups', () => {
    expect(iccOneWay([[1, 1, 1], [5, 5, 5], [9, 9, 9]])).toBe(1);
  });
  it('is null for degenerate input', () => {
    expect(iccOneWay([[1, 2, 3]])).toBeNull();
    expect(iccOneWay([])).toBeNull();
    expect(iccOneWay([[4, 4], [4, 4], [4, 4]])).toBeNull();
    expect(iccOneWay([[1], [2], [3]])).toBeNull();
    expect(iccOneWay([[1, 2], [3]])).toBeNull();
  });
  it('handles unequal group sizes with a finite number', () => {
    const v = iccOneWay([[1, 2, 3], [4, 5], [7, 8, 9, 10]]);
    expect(v).not.toBeNull();
    expect(Number.isFinite(v as number)).toBe(true);
  });
});

describe('bootstrapDelta', () => {
  const hi30 = Array.from({ length: 30 }, (_, i) => 10 + (i % 11));
  const lo30 = Array.from({ length: 30 }, (_, i) => i % 6);
  it('is deterministic for a given seed', () => {
    const r1 = bootstrapDelta(hi30, lo30, createPrng(7).next);
    const r2 = bootstrapDelta(hi30, lo30, createPrng(7).next);
    expect(r1).toEqual(r2);
  });
  it('detects a clearly higher group', () => {
    const r = bootstrapDelta(hi30, lo30, createPrng(1).next);
    expect(r.estimate).toBe(1);
    expect(r.lo as number).toBeGreaterThan(0);
    expect(r.hi as number).toBeLessThanOrEqual(1);
  });
  it('contains 0 for identical groups', () => {
    const g = [1, 2, 3, 4, 5, 6, 7, 8];
    const r = bootstrapDelta(g, g, createPrng(3).next);
    expect(r.lo as number).toBeLessThanOrEqual(0);
    expect(r.hi as number).toBeGreaterThanOrEqual(0);
  });
  it('returns nulls for an empty group', () => {
    expect(bootstrapDelta([], [1], createPrng(1).next)).toEqual({ estimate: null, lo: null, hi: null });
  });
  it('does not throw with a tiny B', () => {
    expect(() => bootstrapDelta([1, 2], [3, 4], createPrng(1).next, 5)).not.toThrow();
  });
});

describe('bootstrapIcc', () => {
  it('is deterministic for a given seed', () => {
    expect(bootstrapIcc(SF, createPrng(5).next)).toEqual(bootstrapIcc(SF, createPrng(5).next));
  });
  it('brackets the estimate across seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = bootstrapIcc(SF, createPrng(seed).next);
      expect(Number.isFinite(r.lo as number)).toBe(true);
      expect(Number.isFinite(r.hi as number)).toBe(true);
      expect(r.lo as number).toBeLessThanOrEqual(r.estimate as number);
      expect(r.estimate as number).toBeLessThanOrEqual(r.hi as number);
    }
  });
  it('returns coherent nulls for degenerate input', () => {
    expect(bootstrapIcc([[1, 2, 3]], createPrng(1).next)).toEqual({ estimate: null, lo: null, hi: null });
    expect(bootstrapIcc([[4, 4], [4, 4]], createPrng(1).next)).toEqual({ estimate: null, lo: null, hi: null });
  });
  it('does not throw with a tiny B', () => {
    expect(() => bootstrapIcc(SF, createPrng(1).next, 3)).not.toThrow();
  });
});
