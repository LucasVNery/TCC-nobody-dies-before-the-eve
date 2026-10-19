// Pure statistics for the V0 experiment: Cliff's delta, one-way ICC(1,1) and
// percentile bootstrap intervals. No randomness of its own: callers pass an
// rng returning values in [0, 1).

export interface Interval {
  estimate: number | null;
  lo: number | null;
  hi: number | null;
}

const NULL_INTERVAL: Interval = { estimate: null, lo: null, hi: null };

const finite = (xs: readonly number[]): number[] => xs.filter((x) => Number.isFinite(x));
const validLevel = (level: number): boolean => Number.isFinite(level) && level > 0 && level < 1;

/** Cliff's delta. Non-finite values (NaN, +-Infinity) are dropped from both inputs first; null if a side ends up empty. */
export function cliffsDelta(a0: readonly number[], b0: readonly number[]): number | null {
  const a = finite(a0);
  const b = finite(b0);
  if (a.length === 0 || b.length === 0) return null;
  let greater = 0;
  let less = 0;
  for (const x of a) {
    for (const y of b) {
      if (x > y) greater++;
      else if (x < y) less++;
    }
  }
  return (greater - less) / (a.length * b.length);
}

function resample(xs: readonly number[], rng: () => number): number[] {
  const out: number[] = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    out[i] = xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];
  }
  return out;
}

/**
 * Percentile rule: sort the n kept values ascending; the bound at probability
 * p is sorted[floor(p * (n - 1))] for the lower bound and
 * sorted[ceil(p * (n - 1))] for the upper bound (conservative, no interpolation).
 */
function percentileInterval(values: number[], level: number): { lo: number | null; hi: number | null } {
  if (values.length === 0) return { lo: null, hi: null };
  const sorted = [...values].sort((x, y) => x - y);
  const alpha = (1 - level) / 2;
  const last = sorted.length - 1;
  const loIdx = Math.max(0, Math.min(last, Math.floor(alpha * last)));
  const hiIdx = Math.max(0, Math.min(last, Math.ceil((1 - alpha) * last)));
  return { lo: sorted[loIdx], hi: sorted[hiIdx] };
}

/**
 * Percentile bootstrap of Cliff's delta. Non-finite inputs are dropped. A level
 * that is NaN or outside (0,1) gives an all-null Interval. With B = 0 (or if every
 * resample is null) the estimate is returned with lo/hi null.
 */
export function bootstrapDelta(
  a0: readonly number[],
  b0: readonly number[],
  rng: () => number,
  B = 2000,
  level = 0.95,
): Interval {
  if (!validLevel(level)) return { ...NULL_INTERVAL };
  const a = finite(a0);
  const b = finite(b0);
  const estimate = cliffsDelta(a, b);
  if (estimate === null) return { ...NULL_INTERVAL };
  const stats: number[] = [];
  for (let i = 0; i < B; i++) {
    const d = cliffsDelta(resample(a, rng), resample(b, rng));
    if (d !== null) stats.push(d);
  }
  return { estimate, ...percentileInterval(stats, level) };
}

/**
 * One-way random-effects ICC(1,1); groups with fewer than 2 measures (or with
 * non-finite values) are dropped. Not clamped: it can be negative (lower bound
 * -1/(k0-1)). Returns null when fewer than 2 groups remain, when all kept measures
 * are exactly equal (zero variance, robust to decimal rounding), or when the
 * denominator is 0/non-finite (e.g. k0 = 1 with MSB = 0). With MSB = 0 and MSW > 0
 * it returns the negative value -1/(k0-1).
 */
export function iccOneWay(groups: readonly (readonly number[])[]): number | null {
  const gs = groups.filter((g) => g.length >= 2 && g.every((x) => Number.isFinite(x)));
  const k = gs.length;
  if (k < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  let N = 0;
  let sumSq = 0;
  let total = 0;
  for (const g of gs) {
    N += g.length;
    sumSq += g.length * g.length;
    for (const x of g) {
      total += x;
      if (x < min) min = x;
      if (x > max) max = x;
    }
  }
  if (min === max) return null;
  const grand = total / N;
  let ssb = 0;
  let ssw = 0;
  for (const g of gs) {
    let s = 0;
    let gMin = Infinity;
    let gMax = -Infinity;
    for (const x of g) {
      s += x;
      if (x < gMin) gMin = x;
      if (x > gMax) gMax = x;
    }
    const m = s / g.length;
    ssb += g.length * (m - grand) ** 2;
    // a constant group contributes exactly 0 (no rounding noise from its mean)
    if (gMin !== gMax) for (const x of g) ssw += (x - m) ** 2;
  }
  const msb = ssb / (k - 1);
  const msw = ssw / (N - k);
  if (msb === 0 && msw === 0) return null;
  const k0 = (N - sumSq / N) / (k - 1);
  const denom = msb + (k0 - 1) * msw;
  if (denom === 0) return null;
  const icc = (msb - msw) / denom;
  return Number.isFinite(icc) ? icc : null;
}

/**
 * Approximate: resamples measures, not clusters; the V0 report uses
 * bootstrapIccClustered. Null resamples are dropped; B = 0 gives lo/hi null;
 * an invalid level (NaN or outside (0,1)) gives an all-null Interval.
 */
export function bootstrapIcc(
  groups: readonly (readonly number[])[],
  rng: () => number,
  B = 2000,
  level = 0.95,
): Interval {
  if (!validLevel(level)) return { ...NULL_INTERVAL };
  const estimate = iccOneWay(groups);
  if (estimate === null) return { ...NULL_INTERVAL };
  const usable = groups.filter((g) => g.length >= 2);
  const stats: number[] = [];
  for (let i = 0; i < B; i++) {
    const v = iccOneWay(usable.map((g) => resample(g, rng)));
    if (v !== null) stats.push(v);
  }
  return { estimate, ...percentileInterval(stats, level) };
}

/**
 * Cluster bootstrap of ICC(1,1). agents[a][r] = room values of run r of agent a.
 * Point estimate: iccOneWay over each agent's concatenated room values. Each
 * resample draws, per agent, R runs with replacement (R = its run count) and
 * concatenates their values. Null resamples are dropped; all-null Interval if the
 * point estimate is null, the level is invalid, or (for lo/hi) no resample is valid.
 */
export function bootstrapIccClustered(
  agents: readonly (readonly (readonly number[])[])[],
  rng: () => number,
  B = 2000,
  level = 0.95,
): Interval {
  if (!validLevel(level)) return { ...NULL_INTERVAL };
  const flat = (runs: readonly (readonly number[])[]): number[] => runs.flat();
  const estimate = iccOneWay(agents.map(flat));
  if (estimate === null) return { ...NULL_INTERVAL };
  const stats: number[] = [];
  for (let i = 0; i < B; i++) {
    const groups = agents.map((runs) => {
      const drawn: (readonly number[])[] = [];
      for (let r = 0; r < runs.length; r++) {
        drawn.push(runs[Math.min(runs.length - 1, Math.floor(rng() * runs.length))]);
      }
      return flat(drawn);
    });
    const v = iccOneWay(groups);
    if (v !== null) stats.push(v);
  }
  return { estimate, ...percentileInterval(stats, level) };
}
