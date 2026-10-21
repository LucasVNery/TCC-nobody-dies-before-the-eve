// src/core/events.ts
import type { OppOpenPayload, OppClosePayload } from '../opportunity/types';
import type { ActionType } from '../combat/actionRegistry';
import type { DefensiveLabel } from '../profile/profileAccumulator';
import type { ProfileSnapshotPayload } from '../profile/types';
import type { ItemKind } from '../game/items';

export interface PlayerActionPayload {
  actionId: string;
  actionType: ActionType;
  weaponId: string;
  opp_id?: string;
}

export interface PlayerDodgePayload {
  cost: number;
}

export interface PlayerCancelPayload {
  /** What ended the recovery early. */
  by: 'move' | 'dash' | 'attack';
  /** The action whose recovery was cancelled. */
  actionId: string;
}

export type PlayerHitUnmitigatedPayload = Record<string, never>;

export type EmptyPayload = Record<string, never>;

export interface PlayerDefensePayload {
  label: DefensiveLabel;
  perfect?: boolean;
  refund?: number;
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

export interface RunStartPayload {
  run_idx: number;
  seed: number;
}

export interface RunEndPayload {
  run_idx: number;
  /** 'abandoned': closed at the next boot because the tab was closed mid-run. */
  cause: 'death' | 'abandoned';
  duration_ms: number;
  rooms_cleared: number;
  encounters_cleared: number;
}

export interface RoomEnterPayload {
  room_idx: number;
}

export interface EncounterBoundaryPayload {
  enc_idx: number;
}

export interface ProfileSnapshotEventPayload {
  /** true when the room was cut short by the player's death. */
  partial: boolean;
  snapshot: ProfileSnapshotPayload;
}

export type GameEvents = {
  'opp.open': OppOpenPayload;
  'opp.close': OppClosePayload;
  'player.action': PlayerActionPayload;
  'player.dodge': PlayerDodgePayload;
  'player.cancel': PlayerCancelPayload;
  'player.hit_unmitigated': PlayerHitUnmitigatedPayload;
  'player.defense': PlayerDefensePayload;
  'player.stamina_denied': { action: string };
  'player.guard_break': EmptyPayload;
  'player.hurt': PlayerHurtPayload;
  'enemy.attack_start': { kind: 'swing' | 'lunge' };
  'enemy.hurt': EnemyHurtPayload;
  'projectile.hit': { id: number; dmg: number };
  'projectile.expire': { id: number };
  'item.spawn': { item_id: string; kind: ItemKind; x: number; y: number };
  'item.pickup': { item_id: string; kind: ItemKind; wait_ms: number };
  'item.expire': { item_id: string; kind: ItemKind; reason: 'timeout' | 'run_end' };
  'item.use': { kind: ItemKind; hp: number; dist_to_enemy: number; held_ms: number; effective: boolean };
  'run.start': RunStartPayload;
  'run.end': RunEndPayload;
  'room.enter': RoomEnterPayload;
  'encounter.start': EncounterBoundaryPayload;
  'encounter.end': EncounterBoundaryPayload;
  'profile.snapshot': ProfileSnapshotEventPayload;
  'player.death': EmptyPayload;
  'enemy.death': EmptyPayload;
};
