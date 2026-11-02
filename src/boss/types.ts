// Shared types for the profile-driven boss.

export type HabitId = 'far' | 'passive_defense' | 'dodge_abuse' | 'reflex_dash';

/** Response level per habit, each in 0..1. */
export type HabitLevels = Record<HabitId, number>;

export interface BossAdaptRecord {
  habit: HabitId;
  level: number;
  runs_qualifying: number;
  runs_window: number;
  confidence: number | null;
  active: boolean;
}

export interface BossPlan {
  gateOpen: boolean;
  levels: HabitLevels;
  /** Active responses only (at most 2). */
  records: BossAdaptRecord[];
}
