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
