// Folds the telemetry stream into four windows (encounter, run, session, history).
import type { LoggedEvent } from '../../telemetry/schema';
import { isWellFormed } from './eventGuards';
import { StreamTracker } from './streamTracker';
import { WindowAccumulator } from './windowAccumulator';
import { WINDOW_IDS, type MetricsSnapshot, type OpenOpportunity, type WindowId, type WindowMetrics } from './metricsTypes';

export { WINDOW_IDS } from './metricsTypes';
export type { WindowId, MetricsSnapshot, WindowMetrics, OpenOpportunity } from './metricsTypes';

/** Which boundary event restarts which window (history never restarts). */
const RESET_ON: Partial<Record<string, WindowId>> = {
  'encounter.start': 'encounter',
  'run.start': 'run',
  'session.start': 'session',
};

export class MetricsAggregator {
  private readonly tracker = new StreamTracker();
  private readonly accs: Record<WindowId, WindowAccumulator> = {
    encounter: new WindowAccumulator(),
    run: new WindowAccumulator(),
    session: new WindowAccumulator(),
    history: new WindowAccumulator(),
  };
  private readonly counts = new Map<string, number>();
  private readonly open = new Map<string, OpenOpportunity>();
  private malformed = 0;

  /** O(1) per event; never throws. */
  apply(event: LoggedEvent): void {
    try {
      if (!isWellFormed(event)) {
        this.malformed += 1;
        return;
      }
      const d = this.tracker.observe(event);
      // Boundary events open their own window, so they reset before being applied.
      // session.start also clears the stale opportunity windows of the old session.
      const boundary = RESET_ON[event.type];
      if (boundary) this.accs[boundary].reset();
      if (event.type === 'session.start') this.open.clear();
      for (const id of WINDOW_IDS) this.accs[id].apply(event, d);
      this.counts.set(event.type, (this.counts.get(event.type) ?? 0) + 1);
      if (event.type === 'opp.open') {
        this.open.set(event.opp_id as string, {
          opp_id: event.opp_id as string,
          opp_type: event.opp_type as string,
          src: typeof event.src === 'string' ? event.src : '',
          window_ms: event.window_ms as number,
          openedAtMs: event.t_ms,
        });
      } else if (event.type === 'opp.close') {
        this.open.delete(event.opp_id as string);
      }
    } catch {
      this.malformed += 1;
    }
  }

  applyAll(events: readonly LoggedEvent[]): void {
    for (const ev of events) this.apply(ev);
  }

  snapshot(): MetricsSnapshot {
    const windows = {} as Record<WindowId, WindowMetrics>;
    for (const id of WINDOW_IDS) windows[id] = this.accs[id].snapshot();
    const eventCounts: Record<string, number> = {};
    for (const [k, v] of this.counts) eventCounts[k] = v;
    return { windows, eventCounts, openWindows: [...this.open.values()], malformed: this.malformed };
  }
}

/**
 * Folds a whole log into a snapshot. `events` MUST be in chronological/stream order: IndexedDB `readAll`
 * returns key order [session_id, seq], which is not chronological across sessions, so order it first
 * (`orderEvents` in src/telemetry/replay.ts).
 */
export function metricsFromLog(events: readonly LoggedEvent[]): MetricsSnapshot {
  const agg = new MetricsAggregator();
  agg.applyAll(events);
  return agg.snapshot();
}
