// src/telemetry/replay.ts
import { ProfileAccumulator, type DefensiveLabel } from '../profile/profileAccumulator';
import type { ProfileSink } from '../profile/profileSink';
import type { ProfileOutcome } from '../profile/types';
import type { ActionType } from '../combat/actionRegistry';
import type { LoggedEvent } from './schema';

/**
 * Chronological order: sessions by their session.start `wall_clock_iso`
 * (ISO-8601 strings sort chronologically), sessions without one last (by id),
 * then by `seq` inside a session.
 */
export function orderEvents(events: readonly LoggedEvent[]): LoggedEvent[] {
  const sessionStart = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'session.start' && typeof e.wall_clock_iso === 'string') {
      sessionStart.set(e.session_id, e.wall_clock_iso);
    }
  }
  const NO_START = '￿';
  return [...events].sort((a, b) => {
    if (a.session_id !== b.session_id) {
      const sa = sessionStart.get(a.session_id) ?? NO_START;
      const sb = sessionStart.get(b.session_id) ?? NO_START;
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.session_id < b.session_id ? -1 : 1;
    }
    return a.seq - b.seq;
  });
}

/**
 * Rebuilds the profile by re-applying the `obs.*` events after the last
 * `obs.reset`, with the parameters currently in the code (γ, κ, …) — which is
 * what makes re-analysis with new parameters possible. Non-obs events are ignored.
 */
export function rebuildProfile(events: readonly LoggedEvent[]): ProfileAccumulator {
  const ordered = orderEvents(events);
  let start = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i].type === 'obs.reset') {
      start = i + 1;
      break;
    }
  }
  const acc = new ProfileAccumulator();
  for (let i = start; i < ordered.length; i++) applyObservation(acc, ordered[i]);
  return acc;
}

function applyObservation(sink: ProfileSink, e: LoggedEvent): void {
  switch (e.type) {
    case 'obs.record':
      sink.record(e.skill as string, e.num as number, e.den as number);
      break;
    case 'obs.outcome':
      sink.recordOutcome(e.skill as string, e.outcome as ProfileOutcome);
      break;
    case 'obs.action':
      sink.recordAction(e.actionType as ActionType, e.weaponId as string | undefined);
      break;
    case 'obs.defense':
      sink.recordDefense(e.label as DefensiveLabel);
      break;
    case 'obs.boundary':
      if (e.kind === 'encounter') sink.applyEncounterBoundary();
      else if (e.kind === 'room') sink.applyRoomBoundary();
      break;
    default:
      break;
  }
}

/** Run numbering continues across sessions: highest logged run.start + 1. */
export function nextRunIdx(events: readonly LoggedEvent[]): number {
  let max = -1;
  for (const e of events) {
    if (e.type === 'run.start' && typeof e.run_idx === 'number' && e.run_idx > max) max = e.run_idx;
  }
  return max + 1;
}
