// One metrics window: O(1) folding of events into running sums.
import type { LoggedEvent } from '../../telemetry/schema';
import { MOVING_SPEED_EPS, type Derived } from './streamTracker';
import type { OppStats, WindowMetrics } from './metricsTypes';

const div = (a: number, b: number): number | null => (b > 0 && Number.isFinite(a / b) ? a / b : null);
const bump = (m: Record<string, number>, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};
const neutralOpp = (): OppStats => ({
  taken: 0, missed: 0, expired: 0, invalid: 0, utilization: null, omission: null,
});

const CELL_SIZE = 64;
// ceil(1600/64) * ceil(1200/64) = 25 * 19, from ARENA_BOUNDS (1600x1200).
const ARENA_CELLS = Math.ceil(1600 / CELL_SIZE) * Math.ceil(1200 / CELL_SIZE);

// NOTE: the `as` payload casts below rely on isWellFormed having run first (see MetricsAggregator.apply).
export class WindowAccumulator {
  private elapsedMs = 0;
  private lastT: number | null = null;
  private lastSession: string | null = null;
  private events = 0;
  private samples = 0;
  private actionCount = 0;
  private intervalSum = 0;
  private intervalN = 0;
  private byType: Record<string, number> = {};
  private byWeapon: Record<string, number> = {};
  private encounters = 0;
  private encounterMsSum = 0;
  private runs = 0;
  private runMsSum = 0;
  private roomsSum = 0;
  private pathLen = 0;
  private dtSum = 0;
  private movingPath = 0;
  private movingDt = 0;
  private distWeighted = 0;
  private idleDt = 0;
  private cells = new Set<number>();

  apply(ev: LoggedEvent, d: Derived): void {
    if (this.lastT !== null && this.lastSession === ev.session_id) {
      this.elapsedMs += Math.max(0, ev.t_ms - this.lastT);
    }
    this.lastT = ev.t_ms;
    this.lastSession = ev.session_id;
    this.events += 1;
    switch (ev.type) {
      case 'pos.sample':
        this.samples += 1;
        this.visit(ev.p as [number, number]);
        if (d.dtMs !== null && d.stepDistance !== null && d.distance !== null) {
          this.dtSum += d.dtMs;
          this.pathLen += d.stepDistance;
          this.distWeighted += d.distance * d.dtMs;
          if ((d.stepDistance / d.dtMs) * 1000 > MOVING_SPEED_EPS) {
            this.movingPath += d.stepDistance;
            this.movingDt += d.dtMs;
          }
          if (d.idle === true) this.idleDt += d.dtMs;
        }
        break;
      case 'player.action': {
        this.actionCount += 1;
        bump(this.byType, ev.actionType as string);
        bump(this.byWeapon, ev.weaponId as string);
        const ctx = ev.ctx as { ms_since_last_action?: unknown } | undefined;
        const ms = ctx && typeof ctx === 'object' ? ctx.ms_since_last_action : null;
        if (typeof ms === 'number' && Number.isFinite(ms)) {
          this.intervalSum += ms;
          this.intervalN += 1;
        }
        break;
      }
      case 'encounter.end':
        if (d.encounterMs !== null) {
          this.encounters += 1;
          this.encounterMsSum += d.encounterMs;
        }
        break;
      case 'run.end':
        this.runs += 1;
        this.runMsSum += ev.duration_ms as number;
        this.roomsSum += ev.rooms_cleared as number;
        break;
    }
  }

  private visit(p: [number, number]): void {
    this.cells.add(Math.floor(p[0] / CELL_SIZE) * 100003 + Math.floor(p[1] / CELL_SIZE));
  }

  reset(): void {
    this.elapsedMs = 0;
    this.lastT = null;
    this.lastSession = null;
    this.events = 0;
    this.samples = 0;
    this.actionCount = 0;
    this.intervalSum = 0;
    this.intervalN = 0;
    this.byType = {};
    this.byWeapon = {};
    this.encounters = 0;
    this.encounterMsSum = 0;
    this.runs = 0;
    this.runMsSum = 0;
    this.roomsSum = 0;
    this.pathLen = 0;
    this.dtSum = 0;
    this.movingPath = 0;
    this.movingDt = 0;
    this.distWeighted = 0;
    this.idleDt = 0;
    this.cells.clear();
  }

  snapshot(): WindowMetrics {
    return {
      elapsedMs: this.elapsedMs,
      events: this.events,
      samples: this.samples,
      speed: { avg: div(this.pathLen * 1000, this.dtSum), moving: div(this.movingPath * 1000, this.movingDt) },
      meanDistance: div(this.distWeighted, this.dtSum),
      actions: {
        count: this.actionCount,
        perMinute: div(this.actionCount, this.elapsedMs / 60000),
        meanIntervalMs: div(this.intervalSum, this.intervalN),
        byType: { ...this.byType },
        byWeapon: { ...this.byWeapon },
      },
      defenses: {},
      opportunities: { dodge: neutralOpp(), punish: neutralOpp() },
      reaction: { n: 0, meanMs: null, medianMs: null },
      cancels: { count: 0, ratio: null, byCause: {} },
      damage: { dealt: 0, taken: 0, ratio: null, dealtPerMinute: null, takenPerMinute: null },
      cycle: {
        encounters: this.encounters,
        meanEncounterMs: div(this.encounterMsSum, this.encounters),
        runs: this.runs,
        meanRunMs: div(this.runMsSum, this.runs),
        meanRoomsPerRun: div(this.roomsSum, this.runs),
      },
      idleFraction: div(this.idleDt, this.dtSum),
      coverage: this.samples > 0 ? this.cells.size / ARENA_CELLS : null,
    };
  }
}
