// src/core/events.ts
import type { OppOpenPayload, OppClosePayload } from '../opportunity/types';
import type { ActionType } from '../combat/actionRegistry';
import type { DefensiveLabel } from '../profile/profileAccumulator';

export interface PlayerActionPayload {
  actionId: string;
  actionType: ActionType;
  weaponId: string;
  opp_id?: string;
}

export type PlayerDodgePayload = Record<string, never>;

export type PlayerHitUnmitigatedPayload = Record<string, never>;

export type EmptyPayload = Record<string, never>;

export interface PlayerDefensePayload {
  label: DefensiveLabel;
}

export interface PlayerHurtPayload {
  dmg: number;
  hp_after: number;
}

export interface EnemyHurtPayload {
  dmg: number;
  hp_after: number;
  actionId: string;
}

export type GameEvents = {
  'opp.open': OppOpenPayload;
  'opp.close': OppClosePayload;
  'player.action': PlayerActionPayload;
  'player.dodge': PlayerDodgePayload;
  'player.hit_unmitigated': PlayerHitUnmitigatedPayload;
  'player.defense': PlayerDefensePayload;
  'player.hurt': PlayerHurtPayload;
  'enemy.attack_start': EmptyPayload;
  'enemy.hurt': EnemyHurtPayload;
};
