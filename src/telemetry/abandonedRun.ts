// src/telemetry/abandonedRun.ts
import type { LoggedEvent } from './schema';
import { orderEvents } from './replay';
import { r1 } from './context';

/** A run that has a run.start but no run.end (the tab was closed mid-run). */
export interface AbandonedRun {
  run_idx: number;
  /** Indices of the run's last stored event: the closing events are logged with them. */
  room_idx: number;
  enc_idx: number;
  duration_ms: number;
  rooms_cleared: number;
  encounters_cleared: number;
}

/**
 * Most sessions end by closing the tab, which leaves the last run open: no
 * run.end, no boundaries, no partial snapshot — and its pending decay would
 * fold into the next session's first room (the leak spec §3.2 closes for
 * death). Returns the current player's last run when it is unterminated, so
 * boot can close it; null otherwise.
 *
 * run.end fields are derived from the run's stored events, all in the session
 * of its run.start (a run never spans sessions — it is closed at the next boot):
 * - duration_ms: t_ms of the run's last stored event minus t_ms of its
 *   run.start (simulation time; the tail lost with the tab, ≤ one persist
 *   interval, is not counted);
 * - rooms_cleared: completed rooms = profile.snapshot with partial === false;
 * - encounters_cleared: encounters ended by a kill = enemy.death events.
 */
export function findAbandonedRun(events: readonly LoggedEvent[], playerId: string): AbandonedRun | null {
  const ordered = orderEvents(events.filter((e) => e.player_id === playerId));
  let startAt = -1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i].type === 'run.start') {
      startAt = i;
      break;
    }
  }
  if (startAt < 0) return null;
  const start = ordered[startAt];
  const runIdx = start.run_idx;
  if (ordered.some((e) => e.type === 'run.end' && e.run_idx === runIdx)) return null;

  const run = ordered.slice(startAt).filter((e) => e.session_id === start.session_id && e.run_idx === runIdx);
  const last = run[run.length - 1];
  return {
    run_idx: runIdx,
    room_idx: last.room_idx,
    enc_idx: last.enc_idx,
    duration_ms: r1(last.t_ms - start.t_ms),
    rooms_cleared: run.filter((e) => e.type === 'profile.snapshot' && e.partial === false).length,
    encounters_cleared: run.filter((e) => e.type === 'enemy.death').length,
  };
}
