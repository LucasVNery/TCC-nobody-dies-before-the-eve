// Pure statistics for the V0 experiment: Cliff's delta, one-way ICC(1,1) and
// percentile bootstrap intervals. No randomness of its own: callers pass an
// rng returning values in [0, 1).

export interface Interval {
  estimate: number | null;
  lo: number | null;
  hi: number | null;
}

const NULL_INTERVAL: Interval = { estimate: null, lo: null, hi: null };

export function cliffsDelta(a: readonly number[], b: readonly number[]): number | null {
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

export function bootstrapDelta(
  a: readonly number[],
  b: readonly number[],
  rng: () => number,
  B = 2000,
  level = 0.95,
): Interval {
  const estimate = cliffsDelta(a, b);
  if (estimate === null) return { ...NULL_INTERVAL };
  const stats: number[] = [];
  for (let i = 0; i < B; i++) {
    const d = cliffsDelta(resample(a, rng), resample(b, rng));
    if (d !== null) stats.push(d);
  }
  return { estimate, ...percentileInterval(stats, level) };
}

/** One-way random-effects ICC(1,1); groups with fewer than 2 measures are dropped. */
export function iccOneWay(groups: readonly (readonly number[])[]): number | null {
  const gs = groups.filter((g) => g.length >= 2);
  const k = gs.length;
  if (k < 2) return null;
  let N = 0;
  let sumSq = 0;
  let total = 0;
  for (const g of gs) {
    N += g.length;
    sumSq += g.length * g.length;
    for (const x of g) total += x;
  }
  const grand = total / N;
  let ssb = 0;
  let ssw = 0;
  for (const g of gs) {
    let s = 0;
    for (const x of g) s += x;
    const m = s / g.length;
    ssb += g.length * (m - grand) ** 2;
    for (const x of g) ssw += (x - m) ** 2;
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

export function bootstrapIcc(
  groups: readonly (readonly number[])[],
  rng: () => number,
  B = 2000,
  level = 0.95,
): Interval {
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
