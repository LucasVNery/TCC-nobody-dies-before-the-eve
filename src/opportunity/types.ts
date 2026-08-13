// src/opportunity/types.ts
export type OppType = 'dodge' | 'punish';
export type OppOutcome = 'taken' | 'missed' | 'expired' | 'invalid';

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
}
