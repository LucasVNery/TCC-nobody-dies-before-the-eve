// src/game/items.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { createPrng, type Prng } from '../core/prng';
import { ARENA_BOUNDS, PLAYER_MAX_HP } from '../combat/movementDefs';
import { aabbOverlap } from '../combat/collision';
import type { AABB, Vec2 } from '../combat/types';

export type ItemKind = 'heal' | 'power' | 'bomb';

const KINDS: readonly ItemKind[] = ['heal', 'power', 'bomb'];

/** Map items (spec 2026-10-21 §4.6): times in ms, distances in px. */
export const ITEM = {
  spawnEveryMs: 20000,
  maxOnMap: 2,
  lifetimeMs: 15000,
  margin: 80,
  minDistance: 120,
  size: 24,
  healAmount: 30,
  powerMultiplier: 1.5,
  powerMs: 8000,
  bombDamage: 30,
  bombRadius: 120,
  bombStaggerMs: 250,
  useLockMs: 100,
} as const;

const SPAWN_TRIES = 10;

export interface MapItem {
  id: string;
  kind: ItemKind;
  pos: Vec2;
  ageMs: number;
}

/** `heal` is the HP actually restored (capped at the player's maximum). */
export interface ItemUse {
  kind: ItemKind;
  heal?: number;
  bombHit?: boolean;
  effective: boolean;
}

interface HeldItem {
  id: string;
  kind: ItemKind;
  heldMs: number;
}

export class ItemSystem {
  private prng: Prng = createPrng(0);
  private ground: MapItem[] = [];
  private slot: HeldItem | null = null;
  private powerRemainingMs = 0;
  private spawnTimerMs = 0;
  private nextId = 0;

  constructor(private readonly bus: EventBus<GameEvents>) {}

  /** Fresh PRNG and empty state; emits nothing. */
  reset(seed: number): void {
    this.prng = createPrng(seed);
    this.ground = [];
    this.slot = null;
    this.powerRemainingMs = 0;
    this.spawnTimerMs = 0;
    this.nextId = 0;
  }

  /** Run over: ground items expire as `run_end`; the held one is dropped silently (it already has its pickup). */
  endRun(): void {
    for (const item of this.ground) {
      this.bus.emit('item.expire', { item_id: item.id, kind: item.kind, reason: 'run_end' });
    }
    this.ground = [];
    this.slot = null;
    this.powerRemainingMs = 0;
  }

  get onMap(): readonly MapItem[] {
    return this.ground;
  }

  get held(): ItemKind | null {
    return this.slot ? this.slot.kind : null;
  }

  get powerActive(): boolean {
    return this.powerRemainingMs > 0;
  }

  get damageMultiplier(): number {
    return this.powerActive ? ITEM.powerMultiplier : 1;
  }

  step(stepMs: number, player: AABB, enemyPos: Vec2): void {
    if (this.powerRemainingMs > 0) this.powerRemainingMs = Math.max(0, this.powerRemainingMs - stepMs);
    if (this.slot) this.slot.heldMs += stepMs;

    // Age and expire.
    const alive: MapItem[] = [];
    for (const item of this.ground) {
      item.ageMs += stepMs;
      if (item.ageMs >= ITEM.lifetimeMs) {
        this.bus.emit('item.expire', { item_id: item.id, kind: item.kind, reason: 'timeout' });
      } else {
        alive.push(item);
      }
    }
    this.ground = alive;

    // Pickup: overlap with the player, empty slot only.
    if (!this.slot) {
      const index = this.ground.findIndex((item) =>
        aabbOverlap(player, { x: item.pos.x, y: item.pos.y, width: ITEM.size, height: ITEM.size }),
      );
      if (index >= 0) {
        const [item] = this.ground.splice(index, 1);
        this.slot = { id: item.id, kind: item.kind, heldMs: 0 };
        this.bus.emit('item.pickup', { item_id: item.id, kind: item.kind, wait_ms: item.ageMs });
      }
    }

    // Spawn timer: full map skips the beat; a failed placement retries next tick.
    this.spawnTimerMs += stepMs;
    if (this.spawnTimerMs >= ITEM.spawnEveryMs) {
      if (this.ground.length >= ITEM.maxOnMap) {
        this.spawnTimerMs -= ITEM.spawnEveryMs;
      } else if (this.trySpawn(player, enemyPos)) {
        this.spawnTimerMs -= ITEM.spawnEveryMs;
      }
    }
  }

  /** Consumes the held item; null when the slot is empty. */
  use(ctx: { playerHp: number; enemyPos: Vec2; playerPos: Vec2 }): ItemUse | null {
    const slot = this.slot;
    if (!slot) return null;
    this.slot = null;
    const dist = Math.hypot(ctx.enemyPos.x - ctx.playerPos.x, ctx.enemyPos.y - ctx.playerPos.y);
    let result: ItemUse;
    let hpAfter = ctx.playerHp;
    if (slot.kind === 'heal') {
      hpAfter = Math.min(PLAYER_MAX_HP, ctx.playerHp + ITEM.healAmount);
      const heal = hpAfter - ctx.playerHp;
      result = { kind: 'heal', heal, effective: heal > 0 };
    } else if (slot.kind === 'power') {
      this.powerRemainingMs = ITEM.powerMs;
      result = { kind: 'power', effective: true };
    } else {
      const bombHit = dist <= ITEM.bombRadius;
      result = { kind: 'bomb', bombHit, effective: bombHit };
    }
    this.bus.emit('item.use', {
      kind: slot.kind,
      hp: hpAfter,
      dist_to_enemy: Math.round(dist * 10) / 10,
      held_ms: slot.heldMs,
      effective: result.effective,
    });
    return result;
  }

  private trySpawn(player: AABB, enemyPos: Vec2): boolean {
    const kind = KINDS[this.prng.nextInt(KINDS.length)];
    const { margin, size, minDistance } = ITEM;
    const spanX = ARENA_BOUNDS.width - 2 * margin - size;
    const spanY = ARENA_BOUNDS.height - 2 * margin - size;
    for (let attempt = 0; attempt < SPAWN_TRIES; attempt++) {
      const pos = {
        x: ARENA_BOUNDS.x + margin + this.prng.next() * spanX,
        y: ARENA_BOUNDS.y + margin + this.prng.next() * spanY,
      };
      const farFromPlayer = Math.hypot(pos.x - player.x, pos.y - player.y) >= minDistance;
      const farFromEnemy = Math.hypot(pos.x - enemyPos.x, pos.y - enemyPos.y) >= minDistance;
      if (!farFromPlayer || !farFromEnemy) continue;
      const item: MapItem = { id: `item-${this.nextId++}`, kind, pos, ageMs: 0 };
      this.ground.push(item);
      this.bus.emit('item.spawn', { item_id: item.id, kind, x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10 });
      return true;
    }
    return false;
  }
}
