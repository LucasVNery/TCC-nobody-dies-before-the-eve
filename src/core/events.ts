// src/core/events.ts
import type { OppOpenPayload, OppClosePayload, ActionId } from '../opportunity/types';

export interface PlayerActionPayload {
  action: ActionId;
  opp_id?: string;
}

export type GameEvents = {
  'opp.open': OppOpenPayload;
  'opp.close': OppClosePayload;
  'player.action': PlayerActionPayload;
};
