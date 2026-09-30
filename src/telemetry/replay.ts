// src/telemetry/replay.ts
import { ProfileAccumulator, DEFENSIVE_LABELS, type DefensiveLabel } from '../profile/profileAccumulator';
import type { ProfileSink } from '../profile/profileSink';
import type { ProfileOutcome } from '../profile/types';
import { ACTION_TYPES, WEAPON_IDS, type ActionType } from '../combat/actionRegistry';
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

/** The events of one player (all of them when `playerId` is undefined). */
function ofPlayer(events: readonly LoggedEvent[], playerId: string | undefined): readonly LoggedEvent[] {
  return playerId === undefined ? events : events.filter((e) => e.player_id === playerId);
}

export interface ReplayResult {
  accumulator: ProfileAccumulator;
  /** Malformed obs.* events that were skipped (hand-edited or corrupted imports). */
  skipped: number;
}

/**
 * Rebuilds the profile by re-applying the `obs.*` events after the last
 * `obs.reset`, with the parameters currently in the code (γ, κ, …) — which is
 * what makes re-analysis with new parameters possible. Non-obs events are
 * ignored. With `playerId`, only that player's events count — including which
 * `obs.reset` is the last one — so an imported history of another player
 * never mixes into the profile. Malformed obs.* are skipped and counted.
 */
export function rebuildProfileWithStats(events: readonly LoggedEvent[], playerId?: string): ReplayResult {
  const ordered = orderEvents(ofPlayer(events, playerId));
  let start = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i].type === 'obs.reset') {
      start = i + 1;
      break;
    }
  }
  const accumulator = new ProfileAccumulator();
  let skipped = 0;
  for (let i = start; i < ordered.length; i++) {
    if (!applyObservation(accumulator, ordered[i])) skipped += 1;
  }
  return { accumulator, skipped };
}

export function rebuildProfile(events: readonly LoggedEvent[], playerId?: string): ProfileAccumulator {
  return rebuildProfileWithStats(events, playerId).accumulator;
}

const PROFILE_OUTCOMES: readonly string[] = ['taken', 'missed', 'expired'];
const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isOneOf = (x: unknown, allowed: readonly string[]): boolean => typeof x === 'string' && allowed.includes(x);

/**
 * Applies one event to `sink`. Returns false for a malformed obs.* event
 * (wrong field types or unknown labels), which is not applied — a bad value
 * would otherwise poison the decayed counters (or throw) on every reload.
 */
function applyObservation(sink: ProfileSink, e: LoggedEvent): boolean {
  switch (e.type) {
    case 'obs.record':
      if (typeof e.skill !== 'string' || !isFiniteNumber(e.num) || !isFiniteNumber(e.den)) return false;
      sink.record(e.skill, e.num, e.den);
      return true;
    case 'obs.outcome':
      if (typeof e.skill !== 'string' || !isOneOf(e.outcome, PROFILE_OUTCOMES)) return false;
      sink.recordOutcome(e.skill, e.outcome as ProfileOutcome);
      return true;
    case 'obs.action':
      if (!isOneOf(e.actionType, ACTION_TYPES)) return false;
      if (e.weaponId !== undefined && !isOneOf(e.weaponId, WEAPON_IDS)) return false;
      sink.recordAction(e.actionType as ActionType, e.weaponId as string | undefined);
      return true;
    case 'obs.defense':
      if (!isOneOf(e.label, DEFENSIVE_LABELS)) return false;
      sink.recordDefense(e.label as DefensiveLabel);
      return true;
    case 'obs.boundary':
      if (e.kind === 'encounter') sink.applyEncounterBoundary();
      else if (e.kind === 'room') sink.applyRoomBoundary();
      else return false;
      return true;
    default:
      return true;
  }
}

/**
 * Run numbering continues across sessions: highest logged run.start + 1 —
 * of `playerId` only, when given.
 */
export function nextRunIdx(events: readonly LoggedEvent[], playerId?: string): number {
  let max = -1;
  for (const e of ofPlayer(events, playerId)) {
    if (e.type === 'run.start' && typeof e.run_idx === 'number' && e.run_idx > max) max = e.run_idx;
  }
  return max + 1;
}
