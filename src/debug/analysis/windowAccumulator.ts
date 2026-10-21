// One metrics window: O(1) folding of events into running sums.
import type { LoggedEvent } from '../../telemetry/schema';
import { MOVING_SPEED_EPS, type Derived } from './streamTracker';
import type { Distribution, ItemKindId, OppStats, SpendKind, WindowMetrics } from './metricsTypes';

const div = (a: number, b: number): number | null => (b > 0 && Number.isFinite(a / b) ? a / b : null);
const bump = (m: Record<string, number>, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};
const neutralOpp = (): OppStats => ({
  taken: 0, missed: 0, expired: 0, invalid: 0, rate: null, omission: null,
});

const HIGH_STAMINA = 80;
const SPEND_KINDS: SpendKind[] = ['attack', 'sprint', 'dodge', 'block'];
const zeroSpent = (): Record<SpendKind, number> => ({ attack: 0, sprint: 0, dodge: 0, block: 0 });
const zeroUses = (): Record<ItemKindId, number> => ({ heal: 0, power: 0, bomb: 0 });

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
  private stamDt = 0;
  private stamWeighted = 0;
  private highDt = 0;
  private exhaustedDt = 0;
  private spentSeen = false;
  private spentByKind = zeroSpent();
  private denied = 0;
  private guardBreaks = 0;
  private dodges = 0;
  private perfectDodges = 0;
  private itemsSpawned = 0;
  private itemsPicked = 0;
  private itemsExpired = 0;
  private waitSum = 0;
  private itemUses = zeroUses();
  private wastedUses = 0;
  private heldSum = 0;
  private useN = 0;

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
        if (d.dtMs !== null && typeof ev.stam === 'number') {
          // Like distance, each interval weighs the value at its end.
          this.stamDt += d.dtMs;
          this.stamWeighted += ev.stam * d.dtMs;
          if (ev.stam >= HIGH_STAMINA) this.highDt += d.dtMs;
          if (ev.stam <= 0) this.exhaustedDt += d.dtMs;
        }
        if (ev.spent !== undefined) {
          this.spentSeen = true;
          const sp = ev.spent as Record<string, number>;
          for (const k of SPEND_KINDS) if (typeof sp[k] === 'number') this.spentByKind[k] += sp[k];
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
        if (ev.label === 'dodge') {
          this.dodges += 1;
          if (ev.perfect === true) this.perfectDodges += 1;
        }
        break;
      case 'player.stamina_denied':
        this.denied += 1;
        break;
      case 'player.guard_break':
        this.guardBreaks += 1;
        break;
      case 'item.spawn':
        this.itemsSpawned += 1;
        break;
      case 'item.pickup':
        this.itemsPicked += 1;
        this.waitSum += ev.wait_ms as number;
        break;
      case 'item.expire':
        this.itemsExpired += 1;
        break;
      case 'item.use':
        this.itemUses[ev.kind as ItemKindId] += 1;
        this.useN += 1;
        this.heldSum += ev.held_ms as number;
        if (ev.effective === false) this.wastedUses += 1;
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
    this.stamDt = 0;
    this.stamWeighted = 0;
    this.highDt = 0;
    this.exhaustedDt = 0;
    this.spentSeen = false;
    this.spentByKind = zeroSpent();
    this.denied = 0;
    this.guardBreaks = 0;
    this.dodges = 0;
    this.perfectDodges = 0;
    this.itemsSpawned = 0;
    this.itemsPicked = 0;
    this.itemsExpired = 0;
    this.waitSum = 0;
    this.itemUses = zeroUses();
    this.wastedUses = 0;
    this.heldSum = 0;
    this.useN = 0;
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
      stamina: {
        meanLevel: div(this.stamWeighted, this.stamDt),
        highFraction: div(this.highDt, this.stamDt),
        exhaustedFraction: div(this.exhaustedDt, this.stamDt),
        spentPerMinute: this.spentSeen
          ? div(SPEND_KINDS.reduce((a, k) => a + this.spentByKind[k], 0), this.elapsedMs / 60000)
          : null,
        spentByKind: { ...this.spentByKind },
        denied: this.denied,
        guardBreaks: this.guardBreaks,
        perfectDodges: this.perfectDodges,
        dodges: this.dodges,
        perfectRate: div(this.perfectDodges, this.dodges),
      },
      items: {
        spawned: this.itemsSpawned,
        picked: this.itemsPicked,
        expired: this.itemsExpired,
        pickRate: div(this.itemsPicked, this.itemsPicked + this.itemsExpired),
        meanWaitMs: div(this.waitSum, this.itemsPicked),
        uses: { ...this.itemUses },
        wastedUses: this.wastedUses,
        meanHeldMs: div(this.heldSum, this.useN),
      },
    };
  }
}
