// src/experiments/v0/pipelineChecks.ts
// Integrity checks of one agent's log (V0 spec §4.6 item 5, §5 "Pipeline").
import { MetricsAggregator } from '../../debug/analysis/metricsAggregator';
import type { ProfileAccumulator } from '../../profile/profileAccumulator';
import { orderEvents, rebuildProfileWithStats } from '../../telemetry/replay';
import type { AgentLog } from './agentRunner';
import { REPORT_SKILLS } from './windowValues';

export interface PipelineCheck {
  id: string;
  ok: boolean;
  detail: string;
}

/**
 * The five checks, in this order:
 * - live-equals-rebuilt: the live profile equals the one rebuilt from the log
 *   (snapshot('room.exit') deep-equal, and domain/confidence/sampleSize of the
 *   six reported dimensions on both clocks);
 * - no-skipped-observations: the replay skipped no malformed obs.*;
 * - no-malformed-metrics: folding the (ordered) log through MetricsAggregator
 *   counts malformed === 0;
 * - run-accounting: run.start count = completedRuns + truncatedRuns + emptyRuns.length;
 * - seq-contiguous: in every session the seq values are exactly 0..n-1.
 */
export function checkAgentLog(log: AgentLog): PipelineCheck[] {
  const replay = rebuildProfileWithStats(log.events, log.playerId);
  return [
    liveEqualsRebuilt(log.live, replay.accumulator),
    {
      id: 'no-skipped-observations',
      ok: replay.skipped === 0,
      detail: `skipped=${replay.skipped}`,
    },
    noMalformedMetrics(log),
    runAccounting(log),
    seqContiguous(log),
  ];
}

function liveEqualsRebuilt(live: ProfileAccumulator, rebuilt: ProfileAccumulator): PipelineCheck {
  const diffs: string[] = [];
  const snap = firstDiff(live.snapshot('room.exit'), rebuilt.snapshot('room.exit'), 'snapshot');
  if (snap) diffs.push(snap);
  for (const skill of REPORT_SKILLS) {
    for (const clock of ['trait', 'state'] as const) {
      const a = [live.domain(skill, clock), live.confidence(skill, clock), live.sampleSize(skill, clock)];
      const b = [rebuilt.domain(skill, clock), rebuilt.confidence(skill, clock), rebuilt.sampleSize(skill, clock)];
      const d = firstDiff(a, b, `${skill}.${clock}[domain,confidence,sampleSize]`);
      if (d) diffs.push(d);
    }
  }
  return {
    id: 'live-equals-rebuilt',
    ok: diffs.length === 0,
    detail: diffs.length === 0 ? 'live profile equals the rebuilt one' : diffs.join('; '),
  };
}

/** Path and values of the first structural difference, or null. Numbers compare with === (so -0 equals 0); NaN equals NaN. */
function firstDiff(a: unknown, b: unknown, path: string): string | null {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b || (Number.isNaN(a) && Number.isNaN(b)) ? null : `${path}: live=${a} rebuilt=${b}`;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return a === b ? null : `${path}: live=${JSON.stringify(a)} rebuilt=${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort();
  for (const k of keys) {
    if (!(k in ra) || !(k in rb)) return `${path}.${k}: only in ${k in ra ? 'live' : 'rebuilt'}`;
    const d = firstDiff(ra[k], rb[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

function noMalformedMetrics(log: AgentLog): PipelineCheck {
  const agg = new MetricsAggregator();
  agg.applyAll(orderEvents(log.events));
  const { malformed } = agg.snapshot();
  return { id: 'no-malformed-metrics', ok: malformed === 0, detail: `malformed=${malformed}` };
}

function runAccounting(log: AgentLog): PipelineCheck {
  const starts = log.events.filter((e) => e.player_id === log.playerId && e.type === 'run.start').length;
  const sum = log.completedRuns + log.truncatedRuns + log.emptyRuns.length;
  return {
    id: 'run-accounting',
    ok: starts === sum,
    detail: `run.start=${starts}, completed=${log.completedRuns} + truncated=${log.truncatedRuns} + empty=${log.emptyRuns.length} = ${sum}`,
  };
}

function seqContiguous(log: AgentLog): PipelineCheck {
  const bySession = new Map<string, number[]>();
  for (const e of log.events) {
    let seqs = bySession.get(e.session_id);
    if (!seqs) {
      seqs = [];
      bySession.set(e.session_id, seqs);
    }
    seqs.push(e.seq);
  }
  const bad: string[] = [];
  for (const [session, seqs] of bySession) {
    const sorted = [...seqs].sort((x, y) => x - y);
    const i = sorted.findIndex((s, k) => s !== k);
    if (i !== -1) bad.push(`${session}: expected seq ${i}, found ${sorted[i]}`);
  }
  return {
    id: 'seq-contiguous',
    ok: bad.length === 0,
    detail: bad.length === 0 ? `${bySession.size} sessions, seq 0..n-1 in each` : bad.join('; '),
  };
}
