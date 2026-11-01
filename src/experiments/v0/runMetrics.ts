// src/experiments/v0/runMetrics.ts
// Per-run values of the V0.1 M family (spec 2026-10-21 §4.3), computed with the SAME
// accumulator that feeds the analysis panel (src/debug/analysis: metricsFromLog /
// WindowAccumulator), read only. Analysis side: no game or policy code changes.
import { metricsFromLog } from '../../debug/analysis/metricsAggregator';
import type { WindowMetrics } from '../../debug/analysis/metricsTypes';
import { orderEvents } from '../../telemetry/replay';
import type { LoggedEvent } from '../../telemetry/schema';
import type { AgentLog } from './agentRunner';
import { STYLE_IDS, type StyleId } from './styles';

/** One run's metric values; null when the panel's metric is null (no sample) or a share's total is 0 — never NaN. */
export interface RunMetrics {
  runIdx: number;
  /** stamina.spentPerMinute */
  staminaSpentPerMinute: number | null;
  /** stamina.highFraction (time with stamina >= 80% of the maximum) */
  staminaHighFraction: number | null;
  /** stamina.spentByKind.dodge / sum of spentByKind */
  dodgeSpendShare: number | null;
  /** stamina.spentByKind.block / sum of spentByKind */
  blockSpendShare: number | null;
  /** items.pickRate */
  itemPickRate: number | null;
}

/** The metric keys of RunMetrics, in report order. */
export type RunMetricId = keyof Omit<RunMetrics, 'runIdx'>;
export const RUN_METRIC_IDS: readonly RunMetricId[] = [
  'staminaSpentPerMinute',
  'staminaHighFraction',
  'dodgeSpendShare',
  'blockSpendShare',
  'itemPickRate',
];

/** One run's reaction to the enemy attack, per attack kind (reaction.byKind of the panel; descriptive). */
export interface RunReactions {
  runIdx: number;
  /** Keys are the logged attack kinds, unknown kinds included as given. */
  byKind: Record<string, { n: number; meanMs: number }>;
}

const finiteOrNull = (x: number | null): number | null => (x !== null && Number.isFinite(x) ? x : null);

function share(part: number, total: number): number | null {
  if (!(total > 0)) return null;
  return finiteOrNull(part / total);
}

/**
 * The panel's window for each run of the player: the 'run' window of
 * metricsFromLog fed with the run's own events, from its run.start on, in
 * the session that started it (orderEvents order). Excluded: events of other
 * players, events logged under the run's index by a LATER session (the
 * abandoned-run close: boundaries, run.end, run-end item expiries, which the
 * M metrics do not read) and the pre-run events of a session (session.start
 * and anything before the session's first run.start carry a stale run_idx).
 * One entry per run.start of the player, ascending by run_idx.
 */
function runWindows(events: readonly LoggedEvent[], playerId: string): { runIdx: number; m: WindowMetrics }[] {
  const ordered = orderEvents(events.filter((e) => e.player_id === playerId));
  const starts = new Map<number, number>();
  ordered.forEach((e, i) => {
    if (e.type === 'run.start' && !starts.has(e.run_idx)) starts.set(e.run_idx, i);
  });
  return [...starts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([runIdx, at]) => {
      const session = ordered[at].session_id;
      const runEvents = ordered.slice(at).filter((e) => e.session_id === session && e.run_idx === runIdx);
      return { runIdx, m: metricsFromLog(runEvents).windows.run };
    });
}

function toRunMetrics(runIdx: number, m: WindowMetrics): RunMetrics {
  const k = m.stamina.spentByKind;
  const total = k.attack + k.sprint + k.dodge + k.block;
  return {
    runIdx,
    staminaSpentPerMinute: finiteOrNull(m.stamina.spentPerMinute),
    staminaHighFraction: finiteOrNull(m.stamina.highFraction),
    dodgeSpendShare: share(k.dodge, total),
    blockSpendShare: share(k.block, total),
    itemPickRate: finiteOrNull(m.items.pickRate),
  };
}

const toRunReactions = (runIdx: number, m: WindowMetrics): RunReactions => ({
  runIdx,
  byKind: Object.fromEntries(Object.entries(m.reaction.byKind).map(([kind, r]) => [kind, { n: r.n, meanMs: r.meanMs }])),
});

/** One RunMetrics per run_idx of the player (see runWindows). */
export function runMetrics(events: readonly LoggedEvent[], playerId: string): RunMetrics[] {
  return runWindows(events, playerId).map(({ runIdx, m }) => toRunMetrics(runIdx, m));
}

/** One RunReactions per run_idx of the player (see runWindows). */
export function runReactions(events: readonly LoggedEvent[], playerId: string): RunReactions[] {
  return runWindows(events, playerId).map(({ runIdx, m }) => toRunReactions(runIdx, m));
}

export interface PreparedRunMetrics {
  metrics: Record<StyleId, RunMetrics[]>;
  reactions: Record<StyleId, RunReactions[]>;
}

/**
 * Per style, the run metrics and reactions of its logs with the empty runs
 * (AgentLog.emptyRuns) dropped, as prepareValues does for the window values.
 * Styles without a log get []; two logs of the same style are concatenated.
 */
export function prepareRunMetrics(logs: readonly AgentLog[]): PreparedRunMetrics {
  const metrics = {} as Record<StyleId, RunMetrics[]>;
  const reactions = {} as Record<StyleId, RunReactions[]>;
  for (const s of STYLE_IDS) {
    metrics[s] = [];
    reactions[s] = [];
  }
  for (const log of logs) {
    const drop = new Set(log.emptyRuns);
    for (const { runIdx, m } of runWindows(log.events, log.playerId)) {
      if (drop.has(runIdx)) continue;
      metrics[log.styleId].push(toRunMetrics(runIdx, m));
      reactions[log.styleId].push(toRunReactions(runIdx, m));
    }
  }
  return { metrics, reactions };
}
