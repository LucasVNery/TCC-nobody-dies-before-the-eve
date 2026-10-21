// Shapes produced by the metrics aggregator (spec E1 §4.1-§4.3). Pure data.

export const WINDOW_IDS = ['encounter', 'run', 'session', 'history'] as const;
export type WindowId = (typeof WINDOW_IDS)[number];

/** Per-window result of one opportunity type. */
export interface OppStats {
  taken: number;
  missed: number;
  expired: number;
  invalid: number;
  /** taken / (taken + missed + expired); null when the denominator is 0. */
  rate: number | null;
  /** expired / (expired + missed); null when the denominator is 0. */
  omission: number | null;
}

/** Raw label counts plus entropy normalized by ln(n); null with fewer than 2 labels used. */
export interface Distribution {
  counts: Record<string, number>;
  entropy: number | null;
}

export type SpendKind = 'attack' | 'sprint' | 'dodge' | 'block';
export type ItemKindId = 'heal' | 'power' | 'bomb';

export interface StaminaMetrics {
  /** Sum(stam*dt)/Sum(dt) between consecutive samples of the same run; each interval weighs the stam at its end. */
  meanLevel: number | null;
  /** Time with stam >= 80 over total time. */
  highFraction: number | null;
  /** Time with stam <= 0 over total time. */
  exhaustedFraction: number | null;
  /** Sum(spent) per minute of elapsedMs; null when no sample carried spent. */
  spentPerMinute: number | null;
  spentByKind: Record<SpendKind, number>;
  denied: number;
  guardBreaks: number;
  perfectDodges: number;
  dodges: number;
  /** perfectDodges / dodges. */
  perfectRate: number | null;
}

export interface ItemMetrics {
  spawned: number;
  picked: number;
  /** Timeout expiries (and expiries without a reason, from old logs). */
  expired: number;
  /** Expiries caused by the run ending: censored, not a player refusal. */
  expiredRunEnd: number;
  /** picked / (picked + expired); run-end expiries are excluded. */
  pickRate: number | null;
  meanWaitMs: number | null;
  uses: Record<ItemKindId, number>;
  /** item.use with effective:false. */
  wastedUses: number;
  /** item.use heal with effective:false (healing at full HP). */
  healsAtFullHp: number;
  /** item.use bomb with effective:true. */
  bombHits: number;
  meanHeldMs: number | null;
}

export interface WindowMetrics {
  /** Sum of t_ms deltas between consecutive events of the same session. */
  elapsedMs: number;
  events: number;
  /** pos.sample count. */
  samples: number;
  speed: { avg: number | null; moving: number | null };
  meanDistance: number | null;
  actions: {
    count: number;
    perMinute: number | null;
    meanIntervalMs: number | null;
    byType: Distribution;
    byWeapon: Distribution;
  };
  defenses: Distribution;
  opportunities: { dodge: OppStats; punish: OppStats };
  reaction: { n: number; meanMs: number | null; medianMs: number | null };
  /** perAction = total / actions; null when there are no actions. */
  cancels: { total: number; perAction: number | null; byCause: Record<string, number> };
  damage: {
    dealt: number;
    taken: number;
    ratio: number | null;
    dealtPerMinute: number | null;
    takenPerMinute: number | null;
  };
  cycle: {
    encounters: number;
    meanEncounterMs: number | null;
    runs: number;
    meanRunMs: number | null;
    meanRoomsPerRun: number | null;
  };
  idleFraction: number | null;
  coverage: number | null;
  stamina: StaminaMetrics;
  items: ItemMetrics;
}

export interface OpenOpportunity {
  opp_id: string;
  opp_type: string;
  src: string;
  window_ms: number;
  openedAtMs: number;
}

export interface MetricsSnapshot {
  windows: Record<WindowId, WindowMetrics>;
  /** Per event type, over the whole history; malformed events are not counted. */
  eventCounts: Record<string, number>;
  openWindows: OpenOpportunity[];
  malformed: number;
}
