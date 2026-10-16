// One metrics window: O(1) folding of events into running sums.
import type { LoggedEvent } from '../../telemetry/schema';
import type { Derived } from './streamTracker';
import type { OppStats, WindowMetrics } from './metricsTypes';

const div = (a: number, b: number): number | null => (b > 0 && Number.isFinite(a / b) ? a / b : null);
const bump = (m: Record<string, number>, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};
const neutralOpp = (): OppStats => ({
  taken: 0, missed: 0, expired: 0, invalid: 0, utilization: null, omission: null,
});

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
  }

  snapshot(): WindowMetrics {
    return {
      elapsedMs: this.elapsedMs,
      events: this.events,
      samples: this.samples,
      speed: { avg: null, moving: null },
      meanDistance: null,
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
      idleFraction: null,
      coverage: null,
    };
  }
}
