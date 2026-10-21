// src/experiments/v0/windowValues.ts
// Profile dimension values per run and per room, rebuilt from the log (V0 spec §4.4-4.5).
import type { SkillId } from '../../profile/types';
import { orderEvents, rebuildProfileWithStats } from '../../telemetry/replay';
import type { LoggedEvent } from '../../telemetry/schema';

/** The six dimensions reported by the V0 experiment, in report order. */
export const REPORT_SKILLS: readonly SkillId[] = [
  'weapon_repertoire',
  'action_repertoire',
  'punish',
  'defensive_repertoire',
  'distance',
  'patience',
];

/**
 * Minimum trait-clock sample size (decayed action/defense count) for an entropy
 * dimension to be defined in a V0 window. Analysis only: the game's
 * ProfileAccumulator is unchanged.
 */
export const MIN_ACTIONS_FOR_ENTROPY = 8;

const ENTROPY_SKILLS: ReadonlySet<SkillId> = new Set<SkillId>([
  'weapon_repertoire',
  'action_repertoire',
  'defensive_repertoire',
]);

export interface WindowValue {
  runIdx: number;
  /** null for a run window. */
  roomIdx: number | null;
  skill: SkillId;
  /** Trait-clock domain; null when the window has no sample for the skill (or the entropy dim is undefined). */
  domain: number | null;
  confidence: number;
  sampleSize: number;
}

/** obs.* types that add evidence (as opposed to boundaries/reset). */
const EVIDENCE_TYPES: ReadonlySet<string> = new Set(['obs.record', 'obs.outcome', 'obs.action', 'obs.defense']);

/** One window per run_idx of the player (roomIdx null). */
export function runWindowValues(events: readonly LoggedEvent[], playerId: string): WindowValue[] {
  return windowValues(events, playerId, (e) => [e.run_idx, null]);
}

/** One window per (run_idx, room_idx) pair of the player. */
export function roomWindowValues(events: readonly LoggedEvent[], playerId: string): WindowValue[] {
  return windowValues(events, playerId, (e) => [e.run_idx, e.room_idx]);
}

type WindowKey = [runIdx: number, roomIdx: number | null];

/**
 * Groups the player's obs.* events by the envelope indices given by `keyOf`
 * and rebuilds a fresh profile per window. Windows are derived from obs.*
 * events only, so non-obs events logged under stale indices (session.start
 * is enveloped with the recorder's initial run_idx 0) never create a window.
 *
 * Order: the player's FULL log is ordered once (orderEvents uses each
 * session.start's wall_clock_iso; a window of obs.* alone would fall back to
 * ordering sessions by id string, e.g. 'agent-s10' before 'agent-s2', which
 * can put an abandoned run's closing boundaries — logged by a later session —
 * before its own observations). The replay re-orders its input, so each
 * window is passed together with the session.start events of its sessions
 * (non-obs events are ignored by the replay) to keep that same order.
 *
 * Note: an obs.reset inside a window makes the replay drop the window's
 * earlier events (it starts after the last reset). Not expected in V0 —
 * agents never reset.
 *
 * Output: windows ordered by runIdx then roomIdx, skills in REPORT_SKILLS order.
 */
function windowValues(
  events: readonly LoggedEvent[],
  playerId: string,
  keyOf: (e: LoggedEvent) => WindowKey,
): WindowValue[] {
  const ordered = orderEvents(events.filter((e) => e.player_id === playerId));
  const sessionStarts = new Map<string, LoggedEvent>();
  for (const e of ordered) {
    if (e.type === 'session.start' && !sessionStarts.has(e.session_id)) sessionStarts.set(e.session_id, e);
  }

  const windows = new Map<string, { key: WindowKey; events: LoggedEvent[] }>();
  for (const e of ordered) {
    if (!e.type.startsWith('obs.')) continue;
    const key = keyOf(e);
    const id = `${key[0]}/${key[1]}`;
    let w = windows.get(id);
    if (!w) {
      w = { key, events: [] };
      windows.set(id, w);
    }
    w.events.push(e);
  }

  const sorted = [...windows.values()].sort(
    (a, b) => a.key[0] - b.key[0] || (a.key[1] ?? 0) - (b.key[1] ?? 0),
  );
  const out: WindowValue[] = [];
  for (const { key, events: windowEvents } of sorted) {
    const starts = [...new Set(windowEvents.map((e) => e.session_id))]
      .map((id) => sessionStarts.get(id))
      .filter((e): e is LoggedEvent => e !== undefined);
    const replayInput = [...starts, ...withFinalFold(windowEvents)];
    const acc = rebuildProfileWithStats(replayInput, playerId).accumulator;
    for (const skill of REPORT_SKILLS) {
      const sampleSize = acc.sampleSize(skill, 'trait');
      out.push({
        runIdx: key[0],
        roomIdx: key[1],
        skill,
        domain:
          sampleSize === 0 || (ENTROPY_SKILLS.has(skill) && sampleSize < MIN_ACTIONS_FOR_ENTROPY)
            ? null
            : acc.domain(skill, 'trait'),
        confidence: acc.confidence(skill, 'trait'),
        sampleSize,
      });
    }
  }
  return out;
}

/**
 * Evidence stays pending until a room boundary folds it into the trait clock.
 * If evidence follows the window's last room boundary (an open room or run),
 * append ONE synthetic room boundary after the window's last event; a window
 * already ending in a room boundary gets none (no double fold).
 * `ordered` must already be in global chronological order.
 */
function withFinalFold(ordered: readonly LoggedEvent[]): LoggedEvent[] {
  let pending = false;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const e = ordered[i];
    if ((e.type === 'obs.boundary' && e.kind === 'room') || e.type === 'obs.reset') break;
    if (EVIDENCE_TYPES.has(e.type)) {
      pending = true;
      break;
    }
  }
  if (!pending) return [...ordered];
  const last = ordered[ordered.length - 1];
  const fold: LoggedEvent = {
    v: last.v,
    seq: last.seq + 1,
    t_ms: last.t_ms,
    player_id: last.player_id,
    session_id: last.session_id,
    run_idx: last.run_idx,
    room_idx: last.room_idx,
    enc_idx: last.enc_idx,
    type: 'obs.boundary',
    kind: 'room',
  };
  return [...ordered, fold];
}
