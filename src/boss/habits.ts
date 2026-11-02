// Habit validity (hysteresis) and response level, from per-run tallies.
import { BOSS_CONFIG, type BossConfig } from './bossConfig';
import type { RunTally } from './habitEvidence';
import type { HabitId } from './types';

export interface ConfidenceSource {
  confidence(skill: string, clock: 'trait' | 'state'): number;
}

export interface HabitState {
  habit: HabitId;
  valid: boolean;
  /** 0 when invalid, otherwise onset..1. */
  level: number;
  /** Qualifying runs in the window (reflex_dash: 1 if valid else 0). */
  qualifying: number;
  /** Evidence runs in the window (reflex_dash: 1, or 0 with no closed run). */
  windowRuns: number;
  /** Null for reflex_dash (no profile skill). */
  confidence: number | null;
}

type RunStatus = 'no_evidence' | 'qualifies' | 'does_not';
type DimensionHabit = 'far' | 'passive_defense' | 'dodge_abuse';

const HABIT_ORDER: readonly HabitId[] = ['far', 'passive_defense', 'dodge_abuse', 'reflex_dash'];
const SKILL: Record<DimensionHabit, string> = {
  far: 'distance',
  passive_defense: 'defensive_repertoire',
  dodge_abuse: 'defensive_repertoire',
};

function runStatus(habit: DimensionHabit, r: RunTally, cfg: BossConfig): RunStatus {
  if (habit === 'far') {
    if (r.nearDen < cfg.minNearSeconds) return 'no_evidence';
    return r.nearNum / r.nearDen < cfg.farNearFractionMax ? 'qualifies' : 'does_not';
  }
  const labels = r.dodge + r.block + r.parry + r.retreat;
  if (labels < cfg.minLabels) return 'no_evidence';
  const share = habit === 'dodge_abuse' ? r.dodge / labels : r.block / labels;
  const min = habit === 'dodge_abuse' ? cfg.dodgeShareMin : cfg.blockShareMin;
  return share >= min ? 'qualifies' : 'does_not';
}

function dimensionLevel(qualifying: number, cfg: BossConfig): number {
  if (cfg.windowRuns === cfg.enterRuns) return qualifying >= cfg.enterRuns ? 1 : cfg.onset;
  const raw = cfg.onset + (1 - cfg.onset) * (qualifying - cfg.enterRuns) / (cfg.windowRuns - cfg.enterRuns);
  return Math.min(1, Math.max(cfg.onset, raw));
}

function evaluateDimension(
  habit: DimensionHabit, closed: readonly RunTally[], profile: ConfidenceSource, cfg: BossConfig,
): HabitState {
  // Current confidence, applied at every step of the walk (no history available).
  const confidence = profile.confidence(SKILL[habit], 'trait');
  const quals: boolean[] = [];
  let valid = false;
  let qualifying = 0;
  let windowRuns = 0;
  for (const r of closed) {
    const s = runStatus(habit, r, cfg);
    if (s === 'no_evidence') continue;
    quals.push(s === 'qualifies');
    const win = quals.slice(-cfg.windowRuns);
    windowRuns = win.length;
    qualifying = win.filter(Boolean).length;
    if (!valid) {
      valid = qualifying >= cfg.enterRuns && confidence >= cfg.enterConfidence;
    } else if (qualifying <= cfg.exitRuns || confidence < cfg.exitConfidence) {
      valid = false;
    }
  }
  return { habit, valid, level: valid ? dimensionLevel(qualifying, cfg) : 0, qualifying, windowRuns, confidence };
}

function evaluateReflex(closed: readonly RunTally[], cfg: BossConfig): HabitState {
  const last = closed[closed.length - 1];
  if (!last) return { habit: 'reflex_dash', valid: false, level: 0, qualifying: 0, windowRuns: 0, confidence: null };
  const valid = last.reflexDashes >= cfg.reflexMinCount;
  const span = cfg.reflexMaxLevelCount - cfg.reflexMinCount;
  const t = span > 0 ? (last.reflexDashes - cfg.reflexMinCount) / span : 1;
  const level = valid ? cfg.onset + (1 - cfg.onset) * Math.min(1, Math.max(0, t)) : 0;
  return { habit: 'reflex_dash', valid, level, qualifying: valid ? 1 : 0, windowRuns: 1, confidence: null };
}

/** One state per HabitId, in HabitId order. Only closed runs count. */
export function evaluateHabits(
  runs: readonly RunTally[], profile: ConfidenceSource, cfg: BossConfig = BOSS_CONFIG,
): HabitState[] {
  const closed = runs.filter((r) => r.closed).sort((a, b) => a.runIdx - b.runIdx);
  return HABIT_ORDER.map((h) =>
    h === 'reflex_dash' ? evaluateReflex(closed, cfg) : evaluateDimension(h, closed, profile, cfg),
  );
}
