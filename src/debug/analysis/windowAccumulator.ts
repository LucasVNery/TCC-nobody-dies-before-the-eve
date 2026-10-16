// One metrics window: O(1) folding of events into running sums.
import type { LoggedEvent } from '../../telemetry/schema';
import { MOVING_SPEED_EPS, type Derived } from './streamTracker';
import type { Distribution, OppStats, WindowMetrics } from './metricsTypes';

const div = (a: number, b: number): number | null => (b > 0 && Number.isFinite(a / b) ? a / b : null);
const bump = (m: Record<string, number>, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};
const neutralOpp = (): OppStats => ({
  taken: 0, missed: 0, expired: 0, invalid: 0, rate: null, omission: null,
});

const CELL_SIZE = 64;
// ceil(1600/64) * ceil(1200/64) = 25 * 19, from ARENA_BOUNDS (1600x1200); a drift test guards it.
export const ARENA_CELLS = Math.ceil(1600 / CELL_SIZE) * Math.ceil(1200 / CELL_SIZE);

const N_ACTION_TYPES = 5;
const N_WEAPONS = 3;
const N_DEFENSE_LABELS = 4;

/** H / ln(n) over raw counts; null with fewer than 2 labels used (same rule as the profile). */
function normalizedEntropy(counts: Record<string, number>, n: number): number | null {
  let total = 0;
  let used = 0;
  for (const k in counts) {
    total += counts[k];
    used += 1;
  }
  if (used < 2 || total <= 0) return null;
  let h = 0;
  for (const k in counts) {
    const p = counts[k] / total;
    h -= p * Math.log(p);
  }
  const e = h / Math.log(n);
  return Number.isFinite(e) ? Math.min(1, Math.max(0, e)) : null;
}

const distribution = (counts: Record<string, number>, n: number): Distribution => ({
  counts: { ...counts },
  entropy: normalizedEntropy(counts, n),
});

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
  private defenseCounts: Record<string, number> = {};
  private opps: { dodge: OppStats; punish: OppStats } = { dodge: neutralOpp(), punish: neutralOpp() };
  private reactions: number[] = [];
  private reactionSum = 0;
  private cachedMedian: number | null = null;
  private medianFresh = true;
  private cancelTotal = 0;
  private cancelByCause: Record<string, number> = {};
  private dealt = 0;
  private taken = 0;

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
          // The first interval after session.start has no idleness reference: it counts in
          // the denominator (dtSum) but is never idle.
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
      case 'player.defense':
        bump(this.defenseCounts, ev.label as string);
        break;
      case 'opp.close': {
        const o = this.opps[ev.opp_type as 'dodge' | 'punish'];
        o[ev.outcome as 'taken' | 'missed' | 'expired' | 'invalid'] += 1;
        break;
      }
      case 'player.dodge':
        if (d.reactionMs !== null) {
          this.reactions.push(d.reactionMs);
          this.reactionSum += d.reactionMs;
          this.medianFresh = false;
        }
        break;
      case 'player.cancel':
        this.cancelTotal += 1;
        bump(this.cancelByCause, ev.by as string);
        break;
      case 'enemy.hurt':
        this.dealt += ev.dmg as number;
        break;
      case 'player.hurt':
        this.taken += ev.dmg as number;
        break;
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
    this.defenseCounts = {};
    this.opps = { dodge: neutralOpp(), punish: neutralOpp() };
    this.reactions = [];
    this.reactionSum = 0;
    this.cachedMedian = null;
    this.medianFresh = true;
    this.cancelTotal = 0;
    this.cancelByCause = {};
    this.dealt = 0;
    this.taken = 0;
  }

  /** Median of the reactions, cached until a new reaction arrives. */
  private median(): number | null {
    if (!this.medianFresh) {
      const s = [...this.reactions].sort((a, b) => a - b);
      const m = s.length >> 1;
      this.cachedMedian = s.length === 0 ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      this.medianFresh = true;
    }
    return this.cachedMedian;
  }

  private oppSnapshot(o: OppStats): OppStats {
    return {
      ...o,
      rate: div(o.taken, o.taken + o.missed + o.expired),
      omission: div(o.expired, o.expired + o.missed),
    };
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
        byType: distribution(this.byType, N_ACTION_TYPES),
        byWeapon: distribution(this.byWeapon, N_WEAPONS),
      },
      defenses: distribution(this.defenseCounts, N_DEFENSE_LABELS),
      opportunities: { dodge: this.oppSnapshot(this.opps.dodge), punish: this.oppSnapshot(this.opps.punish) },
      reaction: { n: this.reactions.length, meanMs: div(this.reactionSum, this.reactions.length), medianMs: this.median() },
      cancels: {
        total: this.cancelTotal,
        perAction: div(this.cancelTotal, this.actionCount),
        byCause: { ...this.cancelByCause },
      },
      damage: {
        dealt: this.dealt,
        taken: this.taken,
        ratio: div(this.dealt, this.taken),
        dealtPerMinute: div(this.dealt, this.elapsedMs / 60000),
        takenPerMinute: div(this.taken, this.elapsedMs / 60000),
      },
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
