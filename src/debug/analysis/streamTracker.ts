// Cross-event state needed by the window accumulators. Computed once per event.
import type { LoggedEvent } from '../../telemetry/schema';

/** Speed at or below this (u/s) counts as standing still. */
export const MOVING_SPEED_EPS = 5;
/** An interval is idle when it ends this long after the last player.action or run start. */
export const IDLE_THRESHOLD_MS = 3000;

export interface Derived {
  /** Duration of the encounter that this event ends; null for any other event. */
  encounterMs: number | null;
  /** pos.sample only: ms since the previous sample of the same run; null if none. */
  dtMs: number | null;
  /** pos.sample only: player path length since the previous sample; null if none. */
  stepDistance: number | null;
  /** pos.sample only: player-enemy distance at the end of the interval; null if none. */
  distance: number | null;
  /** pos.sample only: the interval is idle; null if there is no interval or no reference. */
  idle: boolean | null;
  /** player.dodge only: ms since the enemy attack start, when this is the first dodge inside an open dodge window; else null. */
  reactionMs: number | null;
}

interface Prev {
  t: number;
  x: number;
  y: number;
  session: string;
}

export class StreamTracker {
  private encounterStartT: number | null = null;
  private prev: Prev | null = null;
  private lastActivityT: number | null = null;
  /** t of the latest enemy.attack_start not yet answered by a dodge. */
  private attackStartT: number | null = null;
  /** ids of the dodge opportunity windows currently open. */
  private readonly dodgeWindows = new Set<string>();

  observe(ev: LoggedEvent): Derived {
    const out: Derived = { encounterMs: null, dtMs: null, stepDistance: null, distance: null, idle: null, reactionMs: null };
    switch (ev.type) {
      case 'session.start':
        this.encounterStartT = null;
        this.prev = null;
        this.lastActivityT = null;
        this.attackStartT = null;
        this.dodgeWindows.clear();
        break;
      case 'run.start':
        // A new run breaks sample continuity and is the idleness reference.
        this.prev = null;
        this.lastActivityT = ev.t_ms;
        break;
      case 'player.action':
        this.lastActivityT = ev.t_ms;
        break;
      case 'enemy.attack_start':
        this.attackStartT = ev.t_ms;
        break;
      case 'opp.open':
        if (ev.opp_type === 'dodge') this.dodgeWindows.add(ev.opp_id as string);
        break;
      case 'opp.close':
        this.dodgeWindows.delete(ev.opp_id as string);
        break;
      case 'player.dodge':
        // Only the first dodge inside an open window counts; earlier or later ones do not.
        if (this.attackStartT !== null && this.dodgeWindows.size > 0) {
          out.reactionMs = Math.max(0, ev.t_ms - this.attackStartT);
          this.attackStartT = null;
        }
        break;
      case 'encounter.start':
        this.encounterStartT = ev.t_ms;
        break;
      case 'encounter.end':
        if (this.encounterStartT !== null) {
          out.encounterMs = Math.max(0, ev.t_ms - this.encounterStartT);
          this.encounterStartT = null;
        }
        break;
      case 'pos.sample': {
        const [x, y] = ev.p as [number, number];
        const [ex, ey] = ev.e as [number, number];
        const prev = this.prev;
        if (prev !== null && prev.session === ev.session_id && ev.t_ms > prev.t) {
          out.dtMs = ev.t_ms - prev.t;
          out.stepDistance = Math.hypot(x - prev.x, y - prev.y);
          out.distance = Math.hypot(x - ex, y - ey);
          if (this.lastActivityT !== null) out.idle = ev.t_ms - this.lastActivityT > IDLE_THRESHOLD_MS;
        }
        this.prev = { t: ev.t_ms, x, y, session: ev.session_id };
        break;
      }
    }
    return out;
  }
}
