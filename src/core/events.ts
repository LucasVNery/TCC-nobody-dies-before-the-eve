// src/core/events.ts
import type { OppOpenPayload, OppClosePayload } from '../opportunity/types';
import type { ActionType } from '../combat/actionRegistry';
import type { DefensiveLabel } from '../profile/profileAccumulator';
import type { ProfileSnapshotPayload } from '../profile/types';

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

export interface RunStartPayload {
  run_idx: number;
  seed: number;
}

export interface RunEndPayload {
  run_idx: number;
  cause: 'death';
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
  'player.hit_unmitigated': PlayerHitUnmitigatedPayload;
  'player.defense': PlayerDefensePayload;
  'player.hurt': PlayerHurtPayload;
  'enemy.attack_start': EmptyPayload;
  'enemy.hurt': EnemyHurtPayload;
  'run.start': RunStartPayload;
  'run.end': RunEndPayload;
  'room.enter': RoomEnterPayload;
  'encounter.start': EncounterBoundaryPayload;
  'encounter.end': EncounterBoundaryPayload;
  'profile.snapshot': ProfileSnapshotEventPayload;
  'player.death': EmptyPayload;
  'enemy.death': EmptyPayload;
};
