// src/core/events.ts
import type { OppOpenPayload, OppClosePayload } from '../opportunity/types';

export interface PlayerActionPayload {
  action: string;
  opp_id?: string;
}

export interface GameEvents {
  'opp.open': OppOpenPayload;
  'opp.close': OppClosePayload;
  'player.action': PlayerActionPayload;
}
