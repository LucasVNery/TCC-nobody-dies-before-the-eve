import type { AttackKind } from '../../combat/eliteDefs';
import type { Encounter } from '../../combat/encounter';
import type { EnemyState, Vec2 } from '../../combat/types';
import type { ItemKind } from '../../game/items';
import type { ProfileSink } from '../../profile/profileSink';

/** Exactly what a human player could see on screen at one instant. */
export interface Observation {
  tMs: number;
  enemyState: EnemyState;
  enemyPos: Vec2;
  playerPos: Vec2;
  playerHp: number;
  playerStamina: number;
  isBlocking: boolean;
  equippedWeaponId: string;
  enemyDead: boolean;
  /** Index of the run being played (the run counter is visible to a player; a change means a restart). */
  runIdx: number;
  /** The wind-up on screen (kind, progress 0..1, combo strike), or null outside any telegraph. */
  telegraph: { kind: AttackKind; progress: number; hit?: 1 | 2 } | null;
  /** The item in the slot, as the HUD shows it. */
  heldItem: ItemKind | null;
  /** Items lying on the map. */
  groundItems: readonly { kind: ItemKind; pos: Vec2 }[];
  isSprinting: boolean;
}

/** Reads only public, player-visible members; builds a fresh object with exactly the Observation keys. */
export function observe(encounter: Encounter<ProfileSink>, tMs: number, runIdx: number): Observation {
  const { player, assaltante, items } = encounter;
  const tg = assaltante.telegraph;
  const ep = assaltante.position;
  const pp = player.position;
  return {
    tMs,
    enemyState: assaltante.state,
    // copies, not references: a live reference would let the agent see the present through the reaction delay
    enemyPos: { x: ep.x, y: ep.y },
    playerPos: { x: pp.x, y: pp.y },
    playerHp: player.hp,
    playerStamina: player.stamina.value,
    isBlocking: player.isBlocking,
    equippedWeaponId: player.equippedWeaponId,
    enemyDead: assaltante.isDead,
    runIdx,
    telegraph: tg ? (tg.hit === undefined ? { kind: tg.kind, progress: tg.progress } : { kind: tg.kind, progress: tg.progress, hit: tg.hit }) : null,
    heldItem: items.held,
    groundItems: items.onMap.map((m) => ({ kind: m.kind, pos: { x: m.pos.x, y: m.pos.y } })),
    isSprinting: player.isSprinting,
  };
}

/**
 * Time-ordered history of observations, queried with a reaction delay.
 * Pushes must be monotone in tMs (equal tMs: the last push wins); a
 * decreasing tMs throws.
 */
export class PerceptionBuffer {
  private items: Observation[] = [];

  constructor(private readonly capacityMs = 2000) {}

  push(o: Observation): void {
    const last = this.items[this.items.length - 1];
    if (last && o.tMs < last.tMs) throw new Error(`PerceptionBuffer: non-monotone tMs ${o.tMs} < ${last.tMs}`);
    this.items.push(o);
    const cutoff = o.tMs - this.capacityMs;
    let drop = 0;
    while (drop < this.items.length && this.items[drop].tMs < cutoff) drop++;
    if (drop > 0) this.items.splice(0, drop);
  }

  /** Latest observation with tMs <= nowMs - delayMs, or null. */
  at(nowMs: number, delayMs: number): Observation | null {
    const limit = nowMs - delayMs;
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].tMs <= limit) return this.items[i];
    }
    return null;
  }
}
