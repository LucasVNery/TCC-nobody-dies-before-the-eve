import { describe, expect, it } from 'vitest';
import { createPrng } from '../../core/prng';
import { bootstrapDelta, bootstrapIcc, bootstrapIccClustered, bootstrapIccTwoStage, cliffsDelta, iccOneWay } from './stats';

const SF = [
  [9, 2, 5, 8],
  [6, 1, 3, 2],
  [8, 4, 6, 8],
  [7, 1, 2, 6],
  [10, 5, 6, 9],
  [6, 2, 4, 7],
];
const NUL = { estimate: null, lo: null, hi: null };

// Standard normal via Box-Muller on a seeded rng.
function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

describe('hardening', () => {
  it('constant decimal data gives null ICC', () => {
    expect(iccOneWay([[0.1, 0.1, 0.1], [0.1, 0.1, 0.1], [0.1, 0.1, 0.1]])).toBeNull();
    expect(iccOneWay([[0.7, 0.7, 0.7], [0.7, 0.7], [0.7, 0.7, 0.7, 0.7]])).toBeNull();
    const t = 1 / 3;
    expect(iccOneWay([[t, t, t], [t, t], [t, t, t]])).toBeNull();
  });
  it('bootstrapIcc with constant decimals and collapsing resamples is coherent', () => {
    expect(bootstrapIcc([[0.1, 0.1], [0.1, 0.1]], createPrng(1).next)).toEqual(NUL);
    const r = bootstrapIcc([[0.1, 0.3], [0.7, 0.7], [0.9, 0.9]], createPrng(2).next, 200);
    for (const v of [r.estimate, r.lo, r.hi]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
    // every group collapses to a constant in most resamples; clustered too
    const c = bootstrapIccClustered([[[0.1], [0.1]], [[0.7], [0.7]], [[0.1], [0.7]]], createPrng(2).next, 200);
    for (const v of [c.estimate, c.lo, c.hi]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
  });
  it('invalid level gives all-null intervals', () => {
    expect(bootstrapDelta([1, 2], [3, 4], createPrng(1).next, 10, NaN)).toEqual(NUL);
    expect(bootstrapDelta([1, 2], [3, 4], createPrng(1).next, 10, 1)).toEqual(NUL);
    expect(bootstrapIcc(SF, createPrng(1).next, 10, 0)).toEqual(NUL);
    expect(bootstrapIccClustered([[[1, 2]], [[3, 4]]], createPrng(1).next, 10, 2)).toEqual(NUL);
  });
  it('non-finite values are dropped from Cliff delta', () => {
    expect(cliffsDelta([NaN, 5, 6], [1, 2, Infinity])).toBe(1);
    expect(cliffsDelta([NaN], [1])).toBeNull();
  });
  it('B = 0 keeps the estimate with null bounds', () => {
    expect(bootstrapDelta([1, 2], [3, 4], createPrng(1).next, 0)).toEqual({ estimate: -1, lo: null, hi: null });
  });
  it('bootstrapDelta covers a known delta (0.5 SD shift) in >= 85% of 100 replicates', () => {
    // Large-sample Cliff's delta for N(0.5,1) vs N(0,1) is 2*Phi(0.5/sqrt2)-1 ~ 0.276;
    // obtained here on a big fixed-seed sample.
    const big = createPrng(999).next;
    const A = Array.from({ length: 1500 }, () => normal(big) + 0.5);
    const Bv = Array.from({ length: 1500 }, () => normal(big));
    const truth = cliffsDelta(A, Bv) as number;
    expect(truth).toBeCloseTo(0.276, 1);
    let covered = 0;
    for (let rep = 0; rep < 100; rep++) {
      const g = createPrng(1000 + rep).next;
      const a = Array.from({ length: 40 }, () => normal(g) + 0.5);
      const b = Array.from({ length: 40 }, () => normal(g));
      const r = bootstrapDelta(a, b, createPrng(5000 + rep).next, 400);
      if ((r.lo as number) <= truth && truth <= (r.hi as number)) covered++;
    }
    expect(covered).toBeGreaterThanOrEqual(85);
  });
});

function simulate(seed: number, nAgents: number, nRuns: number, nRooms: number, sdA: number, sdRun: number, sdE: number) {
  const g = createPrng(seed).next;
  return Array.from({ length: nAgents }, () => {
    const a = normal(g) * sdA;
    return Array.from({ length: nRuns }, () => {
      const u = normal(g) * sdRun;
      return Array.from({ length: nRooms }, () => a + u + normal(g) * sdE);
    });
  });
}

describe('bootstrapIccClustered', () => {
  it('is deterministic for a given seed', () => {
    const d = simulate(1, 5, 4, 3, 2, 0.5, 0.5);
    expect(bootstrapIccClustered(d, createPrng(3).next, 200)).toEqual(
      bootstrapIccClustered(d, createPrng(3).next, 200),
    );
  });
  it('strong between-agent variance gives a high ICC bracketed by the interval', () => {
    const d = simulate(2, 7, 8, 3, 3, 0.3, 0.3);
    const r = bootstrapIccClustered(d, createPrng(4).next, 500);
    expect(r.estimate as number).toBeGreaterThan(0.7);
    expect(r.lo as number).toBeLessThan(r.estimate as number);
    expect(r.estimate as number).toBeLessThan(r.hi as number);
  });
  it('handles degenerate agents without throwing, coherent with iccOneWay', () => {
    const rng = createPrng(1).next;
    expect(bootstrapIccClustered([], rng, 20)).toEqual(NUL);
    expect(bootstrapIccClustered([[], [[1, 2]]], rng, 20)).toEqual(NUL);
    expect(bootstrapIccClustered([[[]], [[1, 2]]], rng, 20)).toEqual(NUL);
    const mixed = [[[1, 2], []], [[5, 6], [7]], [], [[0.1, 0.1], [0.1]]];
    const r = bootstrapIccClustered(mixed, rng, 50);
    expect(r.estimate).toBe(iccOneWay(mixed.map((a) => a.flat())));
  });
  it('is deterministic for bootstrapIccTwoStage and brackets a high ICC', () => {
    const d = simulate(2, 7, 8, 3, 3, 0.3, 0.3);
    const a = bootstrapIccTwoStage(d, createPrng(6).next, 200);
    expect(a).toEqual(bootstrapIccTwoStage(d, createPrng(6).next, 200));
    expect(a.estimate as number).toBeGreaterThan(0.7);
  });
  it('covers the CONDITIONAL ICC of 7 fixed agents in >= 80% of 60 replicates (8 runs x 3 rooms)', () => {
    // The 7 agent effects are drawn once and kept fixed. Truth = iccOneWay of those same
    // agents from 2000 runs x 3 rooms each (fixed seed), concatenated per agent. Each
    // replicate regenerates only runs (run effect sd 0.5 + room noise sd 1).
    const eg = createPrng(31337).next;
    const effects = Array.from({ length: 7 }, () => normal(eg));
    const runsFor = (seed: number, nRuns: number) => {
      const g = createPrng(seed).next;
      return effects.map((a) =>
        Array.from({ length: nRuns }, () => {
          const u = normal(g) * 0.5;
          return Array.from({ length: 3 }, () => a + u + normal(g));
        }),
      );
    };
    const truth = iccOneWay(runsFor(424242, 2000).map((x) => x.flat())) as number;
    let covered = 0;
    for (let rep = 0; rep < 60; rep++) {
      const r = bootstrapIccClustered(runsFor(100 + rep, 8), createPrng(9000 + rep).next, 400);
      if ((r.lo as number) <= truth && truth <= (r.hi as number)) covered++;
    }
    console.log('conditional clustered coverage', covered, '/ 60, truth', truth);
    expect(covered).toBeGreaterThanOrEqual(48); // 80% of 60
  });
});
