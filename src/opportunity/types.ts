// src/opportunity/types.ts
export type OppType = 'dodge' | 'punish';
export type OppOutcome = 'taken' | 'missed' | 'expired' | 'invalid';
// The action registry's string id (e.g. 'sword_shield.light') of the action a
// player attempted while an opportunity window was open. Was a fixed 2-literal
// union before the action registry existed (2026-09-06 refactor).
export type ActionId = string;
export type InvalidReason =
  | 'other_source_hitstun'
  | 'out_of_range'
  | 'player_dead'
  | 'tool_locked'
  | 'source_interrupted'
  | 'overlapping_priority';

export interface OppOpenPayload {
  opp_id: string;
  type: OppType;
  src: string;
  window_ms: number;
}

export interface OppClosePayload {
  opp_id: string;
  type: OppType;
  outcome: OppOutcome;
  reason?: InvalidReason;
  attempt?: ActionId;
}
