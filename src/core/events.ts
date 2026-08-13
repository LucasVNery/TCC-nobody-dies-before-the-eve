// src/core/events.ts
import type { OppOpenPayload, OppClosePayload } from '../opportunity/types';

export interface PlayerActionPayload {
  action: string;
  opp_id?: string;
}

export type GameEvents = {
  'opp.open': OppOpenPayload;
  'opp.close': OppClosePayload;
  'player.action': PlayerActionPayload;
};
