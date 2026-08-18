// src/opportunity/types.ts
export type OppType = 'dodge' | 'punish';
export type OppOutcome = 'taken' | 'missed' | 'expired' | 'invalid';
export type ActionId = 'light_attack' | 'dodge';
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
