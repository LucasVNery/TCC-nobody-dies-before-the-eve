// src/core/events.ts
import type { OppOpenPayload, OppClosePayload } from '../opportunity/types';
import type { ActionType } from '../combat/actionRegistry';

export interface PlayerActionPayload {
  actionId: string;
  actionType: ActionType;
  weaponId: string;
  opp_id?: string;
}

export type PlayerDodgePayload = Record<string, never>;

export type GameEvents = {
  'opp.open': OppOpenPayload;
  'opp.close': OppClosePayload;
  'player.action': PlayerActionPayload;
  'player.dodge': PlayerDodgePayload;
};
