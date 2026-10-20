// src/experiments/v0/evaluate.ts
// Verdicts of the pre-registered hypotheses (spec §4.4) and ICC per dimension (spec §4.5).
import type { SkillId } from '../../profile/types';
import { HYPOTHESES, type Hypothesis } from './hypotheses';
import { bootstrapDelta, bootstrapIccClustered } from './stats';
import { STYLE_IDS, type StyleId } from './styles';
import { REPORT_SKILLS, type WindowValue } from './windowValues';

export type Verdict = 'confirmada' | 'refutada' | 'indefinida';

/**
 * nHigher/nLower: DEFINED run values of each group. For an 'undefinedRate'
 * hypothesis the single style fills the "lower" slot (nLower, undefinedRateLower)
 * and nHigher is 0. undefinedRateLower: fraction of the lower group's runs with
 * domain null (null when it has no run). delta/lo/hi: Cliff's delta and its
 * bootstrap 95% interval (null when a side has no defined value, and always for
 * 'undefinedRate').
 */
export interface HypothesisResult {
  id: string;
  skill: SkillId;
  verdict: Verdict;
  delta: number | null;
  lo: number | null;
  hi: number | null;
  nHigher: number;
  nLower: number;
  undefinedRateLower: number | null;
}

/** Fewer defined values (or runs, for undefined-rate rules) than this ⇒ 'indefinida'. */
export const MIN_VALUES = 10;
/** Minimum |delta| (medium effect) for a 'greater' hypothesis. */
export const MIN_DELTA = 0.33;
/** "indefinido em ≥ 95% das runs", as an integer ratio (no float drift). */
const UNDEFINED_PCT = 95;

/** Drops every window (run and room) of the given run_idx: the empty runs of AgentLog.emptyRuns. */
export function dropEmptyRuns(values: readonly WindowValue[], emptyRuns: readonly number[]): WindowValue[] {
  const drop = new Set(emptyRuns);
  return values.filter((v) => !drop.has(v.runIdx));
}

interface Group {
  runs: number;
  defined: number[];
  undefinedCount: number;
}

/** Run windows (roomIdx null) of one style and skill. */
function groupOf(values: readonly WindowValue[] | undefined, skill: SkillId): Group {
  const runs = (values ?? []).filter((v) => v.roomIdx === null && v.skill === skill);
  const defined: number[] = [];
  for (const v of runs) if (v.domain !== null) defined.push(v.domain);
  return { runs: runs.length, defined, undefinedCount: runs.length - defined.length };
}

const undefinedRate = (g: Group): number | null => (g.runs === 0 ? null : g.undefinedCount / g.runs);
const mostlyUndefined = (g: Group): boolean => g.runs >= MIN_VALUES && g.undefinedCount * 100 >= UNDEFINED_PCT * g.runs;

/**
 * Evaluates HYPOTHESES in order. Uses the per-RUN windows only (roomIdx null;
 * room windows are ignored) and, for the deltas, only the defined values.
 * Callers drop the empty runs first (dropEmptyRuns).
 * - 'undefinedRate': indefinida with < 10 runs; confirmada if >= 95% are null.
 * - 'greater': with `orLowerUndefined`, confirmada if the lower group has >= 10
 *   runs and >= 95% of them are null (regardless of delta). Otherwise indefinida
 *   if either group has < 10 defined values; confirmada if the bootstrap 95%
 *   interval of Cliff's delta (higher vs lower) lies above 0 and delta >= 0.33;
 *   else refutada.
 * The rng is consumed hypothesis by hypothesis, so a fixed seed is deterministic.
 */
export function evaluateHypotheses(
  valuesByStyle: Record<StyleId, WindowValue[]>,
  rng: () => number,
  B = 2000,
): HypothesisResult[] {
  return HYPOTHESES.map((h) => evaluateOne(h, valuesByStyle, rng, B));
}

function evaluateOne(
  h: Hypothesis,
  valuesByStyle: Record<StyleId, WindowValue[]>,
  rng: () => number,
  B: number,
): HypothesisResult {
  if (h.kind === 'undefinedRate') {
    const g = groupOf(valuesByStyle[h.style as StyleId], h.skill);
    const verdict: Verdict = g.runs < MIN_VALUES ? 'indefinida' : mostlyUndefined(g) ? 'confirmada' : 'refutada';
    return {
      id: h.id,
      skill: h.skill,
      verdict,
      delta: null,
      lo: null,
      hi: null,
      nHigher: 0,
      nLower: g.defined.length,
      undefinedRateLower: undefinedRate(g),
    };
  }

  const hi = groupOf(valuesByStyle[h.higher as StyleId], h.skill);
  const lo = groupOf(valuesByStyle[h.lower as StyleId], h.skill);
  const d = bootstrapDelta(hi.defined, lo.defined, rng, B);
  let verdict: Verdict;
  if (h.orLowerUndefined && mostlyUndefined(lo)) verdict = 'confirmada';
  else if (hi.defined.length < MIN_VALUES || lo.defined.length < MIN_VALUES) verdict = 'indefinida';
  else if (d.estimate !== null && d.lo !== null && d.lo > 0 && d.estimate >= MIN_DELTA) verdict = 'confirmada';
  else verdict = 'refutada';
  return {
    id: h.id,
    skill: h.skill,
    verdict,
    delta: d.estimate,
    lo: d.lo,
    hi: d.hi,
    nHigher: hi.defined.length,
    nLower: lo.defined.length,
    undefinedRateLower: undefinedRate(lo),
  };
}

/**
 * ICC(1,1) of one dimension, agents (styles) as groups and the defined per-room
 * values of all their runs as measures (spec §4.5; an upper bound: stationary
 * policies). lo/hi: cluster bootstrap 95% interval (bootstrapIccClustered),
 * CONDITIONAL on the 7 agents: it resamples runs within each agent only, so it
 * does not capture agent-sampling uncertainty — not a population CI.
 * belowCriterion: icc < 0.50 (master doc D1, shown only), null when icc is null.
 * styleId is omitted (one row per dimension).
 */
export interface IccResult {
  skill: SkillId;
  styleId?: StyleId;
  icc: number | null;
  lo: number | null;
  hi: number | null;
  belowCriterion: boolean | null;
}

/** D1 criterion of the master doc (shown, not applied). */
export const ICC_CRITERION = 0.5;

/**
 * One IccResult per REPORT_SKILLS dimension, in that order. Uses room windows
 * only (roomIdx !== null) and only defined values; per agent (STYLE_IDS order)
 * the values are grouped by runIdx (ascending) into the clusters of
 * bootstrapIccClustered; runs with no defined value for the dimension are left
 * out. Callers drop the empty runs first (dropEmptyRuns).
 */
export function iccBySkill(
  roomValuesByStyle: Record<StyleId, WindowValue[]>,
  rng: () => number,
  B = 2000,
): IccResult[] {
  return REPORT_SKILLS.map((skill) => {
    const agents = STYLE_IDS.map((style) => clustersOf(roomValuesByStyle[style] ?? [], skill));
    const r = bootstrapIccClustered(agents, rng, B);
    return {
      skill,
      icc: r.estimate,
      lo: r.lo,
      hi: r.hi,
      belowCriterion: r.estimate === null ? null : r.estimate < ICC_CRITERION,
    };
  });
}

function clustersOf(values: readonly WindowValue[], skill: SkillId): number[][] {
  const byRun = new Map<number, number[]>();
  for (const v of values) {
    if (v.roomIdx === null || v.skill !== skill || v.domain === null) continue;
    let run = byRun.get(v.runIdx);
    if (!run) {
      run = [];
      byRun.set(v.runIdx, run);
    }
    run.push(v.domain);
  }
  return [...byRun.entries()].sort((a, b) => a[0] - b[0]).map(([, xs]) => xs);
}
