// src/combat/playerController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { PlayerController } from './playerController';
import {
  DODGE,
  SWITCH_RECOVERY_MS,
  POISE_MAX,
  POISE_DRAIN_PER_BLOCK,
  POISE_REGEN_DELAY_MS,
  PARRY_WINDOW_MS,
  STAGGER_MS,
} from './actionDefs';
import { SWORD_SHIELD_ACTIONS } from './actionRegistry';
import { PLAYER_MOVE_SPEED, ARENA_BOUNDS } from './movementDefs';
import { sectorOverlapsBox } from './sector';

const LIGHT = SWORD_SHIELD_ACTIONS.find((a) => a.actionType === 'light')!;
const HEAVY = SWORD_SHIELD_ACTIONS.find((a) => a.actionType === 'heavy')!;
const CHARGED = SWORD_SHIELD_ACTIONS.find((a) => a.actionType === 'charged')!;

function makePlayer() {
  const bus = new EventBus<GameEvents>();
  const player = new PlayerController(bus, { x: 0, y: 0, width: 20, height: 20 });
  return { bus, player };
}

describe('PlayerController', () => {
  it('starts idle', () => {
    const { player } = makePlayer();
    expect(player.state).toBe('idle');
  });

  it('tryAction() resolves via the registry, transitions to acting, and emits player.action', () => {
    const { bus, player } = makePlayer();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryAction(LIGHT.id);
    expect(player.state).toBe('acting');
    expect(handler).toHaveBeenCalledWith({
      actionId: LIGHT.id,
      actionType: 'light',
      weaponId: LIGHT.weaponId,
    });
  });

  it('tryAction() with an unknown id throws and does not change state', () => {
    const { player } = makePlayer();
    expect(() => player.tryAction('nope')).toThrow();
    expect(player.state).toBe('idle');
  });

  it('ignores tryAction while not idle', () => {
    const { bus, player } = makePlayer();
    player.tryDodge();
    const handler = vi.fn();
    bus.on('player.action', handler);
    expect(() => player.tryAction(LIGHT.id)).not.toThrow();
    expect(player.state).toBe('dodging');
    expect(handler).not.toHaveBeenCalled();
  });

  it('light attack: hitbox is null during startup, present during active, and back to idle after full duration', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs - 10);
    expect(player.attackHitbox()).toBeNull();

    player.step(20);
    expect(player.attackHitbox()).not.toBeNull();

    player.step(LIGHT.timing.activeMs + LIGHT.timing.recoveryMs);
    expect(player.state).toBe('idle');
    expect(player.attackHitbox()).toBeNull();
  });

  it('heavy attack follows its own startup/active/recovery timing and reach', () => {
    const { player } = makePlayer();
    player.tryAction(HEAVY.id);
    player.step(HEAVY.timing.startupMs - 10);
    expect(player.attackHitbox()).toBeNull();

    player.step(20);
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.reach).toBeCloseTo(HEAVY.reach + 10); // +10 = metade da largura do hurtbox de teste (20)

    player.step(HEAVY.timing.activeMs + HEAVY.timing.recoveryMs);
    expect(player.state).toBe('idle');
  });

  it('charged: released before minHoldMs cancels back to idle without ever producing a hitbox', () => {
    const { bus, player } = makePlayer();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryAction(CHARGED.id);
    player.step(CHARGED.charge!.minHoldMs - 20);
    player.releaseAction();
    expect(player.state).toBe('idle');
    expect(player.attackHitbox()).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it('charged: held past maxHoldMs auto-triggers with reach clamped to the max', () => {
    const { player } = makePlayer();
    player.tryAction(CHARGED.id);
    player.step(CHARGED.charge!.maxHoldMs + 500); // way past max — must clamp, not overshoot
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.reach).toBeCloseTo(CHARGED.charge!.reachMax + 10);
  });

  it('charged: held past maxHoldMs auto-triggers and emits player.action exactly once, at trigger time', () => {
    const { bus, player } = makePlayer();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryAction(CHARGED.id);
    expect(handler).not.toHaveBeenCalled();
    player.step(CHARGED.charge!.maxHoldMs + 500);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      actionId: CHARGED.id,
      actionType: 'charged',
      weaponId: CHARGED.weaponId,
    });
  });

  it('charged: released between minHoldMs and maxHoldMs fires with a linearly interpolated reach', () => {
    const { player } = makePlayer();
    player.tryAction(CHARGED.id);
    const holdMs = (CHARGED.charge!.minHoldMs + CHARGED.charge!.maxHoldMs) / 2;
    player.step(holdMs);
    player.releaseAction();
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    const midpointReach = (CHARGED.reach + CHARGED.charge!.reachMax) / 2 + 10;
    expect(hitbox!.reach).toBeCloseTo(midpointReach);
  });

  it('charged: released between minHoldMs and maxHoldMs emits player.action exactly once, at release time', () => {
    const { bus, player } = makePlayer();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryAction(CHARGED.id);
    const holdMs = (CHARGED.charge!.minHoldMs + CHARGED.charge!.maxHoldMs) / 2;
    player.step(holdMs);
    expect(handler).not.toHaveBeenCalled();
    player.releaseAction();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      actionId: CHARGED.id,
      actionType: 'charged',
      weaponId: CHARGED.weaponId,
    });
  });

  it('tryDodge() grants invulnerability that ends after iframesMs', () => {
    const { player } = makePlayer();
    player.tryDodge();
    expect(player.isInvulnerable).toBe(true);
    player.step(DODGE.iframesMs + 10);
    expect(player.isInvulnerable).toBe(false);
  });

  it('dodge ends after durationMs and starts a cooldown that blocks re-dodging', () => {
    const { player } = makePlayer();
    player.tryDodge();
    player.step(DODGE.durationMs);
    expect(player.state).toBe('idle');
    player.tryDodge();
    expect(player.state).toBe('idle');
  });

  it('dodge is available again once the cooldown elapses', () => {
    const { player } = makePlayer();
    player.tryDodge();
    player.step(DODGE.durationMs);
    player.step(DODGE.cooldownMs);
    player.tryDodge();
    expect(player.state).toBe('dodging');
  });

  it('emits player.dodge, not player.action, on dodge', () => {
    const { bus, player } = makePlayer();
    const actionHandler = vi.fn();
    const dodgeHandler = vi.fn();
    bus.on('player.action', actionHandler);
    bus.on('player.dodge', dodgeHandler);
    player.tryDodge();
    expect(dodgeHandler).toHaveBeenCalledWith({});
    expect(actionHandler).not.toHaveBeenCalled();
  });

  it('moves in the direction of moveInput', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 0);
    player.step(1000);
    expect(player.position.x).toBeCloseTo(PLAYER_MOVE_SPEED);
    expect(player.position.y).toBeCloseTo(0);
  });

  it('normalizes diagonal movement so it is not faster than a cardinal direction', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 1);
    player.step(1000);
    const distance = Math.hypot(player.position.x, player.position.y);
    expect(distance).toBeCloseTo(PLAYER_MOVE_SPEED);
  });

  it('does not move when moveInput is zero', () => {
    const { player } = makePlayer();
    player.step(1000);
    expect(player.position).toEqual({ x: 0, y: 0 });
  });

  it('movement is clamped to ARENA_BOUNDS', () => {
    const { player } = makePlayer();
    player.setMoveInput(-1, 0);
    player.step(100000);
    expect(player.position.x).toBe(ARENA_BOUNDS.x);
  });

  it('ignores moveInput while acting', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.setMoveInput(1, 0);
    player.step(500);
    expect(player.position).toEqual({ x: 0, y: 0 });
  });

  it('dash displaces the player in the last movement direction', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 0);
    player.step(16);
    player.setMoveInput(0, 0);
    const beforeX = player.position.x;
    player.tryDodge();
    player.step(DODGE.durationMs);
    expect(player.position.x).toBeGreaterThan(beforeX);
  });

  it('dash defaults to facing right if the player never moved', () => {
    const { player } = makePlayer();
    player.tryDodge();
    player.step(DODGE.durationMs);
    expect(player.position.x).toBeGreaterThan(0);
  });

  it('facing defaults to aiming right before any setAimDirection call', () => {
    const { player } = makePlayer();
    expect(player.facing).toEqual({ x: 1, y: 0 });
  });

  it('setAimDirection normalizes the vector and updates facing', () => {
    const { player } = makePlayer();
    player.setAimDirection({ x: 0, y: 5 });
    expect(player.facing).toEqual({ x: 0, y: 1 });
  });

  it('setAimDirection with a zero vector leaves the previous aim unchanged', () => {
    const { player } = makePlayer();
    player.setAimDirection({ x: 0, y: 1 });
    player.setAimDirection({ x: 0, y: 0 });
    expect(player.facing).toEqual({ x: 0, y: 1 });
  });

  it('attackHitbox() follows aimDirection, independent of the last movement direction', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 0);
    player.step(16); // moving right
    player.setAimDirection({ x: 0, y: -1 }); // aiming up
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs + 10);
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.direction).toEqual({ x: 0, y: -1 }); // aiming up
  });

  it('attackHitbox() direction is committed at tryAction() time, not updated live during the swing', () => {
    const { player } = makePlayer();
    player.setAimDirection({ x: 0, y: -1 }); // aim up
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs + 10); // now in the active window
    player.setAimDirection({ x: 1, y: 0 }); // player spins the mouse to aim right, mid-swing
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.direction).toEqual({ x: 0, y: -1 }); // still using the "aim up" direction committed at tryAction() time
  });

  it('dash still uses the last movement direction, not the aim direction', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 0);
    player.step(16);
    player.setMoveInput(0, 0);
    player.setAimDirection({ x: -1, y: 0 }); // aiming the opposite way from the dash
    const beforeX = player.position.x;
    player.tryDodge();
    player.step(DODGE.durationMs);
    expect(player.position.x).toBeGreaterThan(beforeX); // still dashes right (movement dir), not left (aim dir)
  });
});

describe('PlayerController — weapon switching', () => {
  it('defaults to sword_shield equipped', () => {
    const { player } = makePlayer();
    expect(player.equippedWeaponId).toBe('sword_shield');
  });

  it('switchWeapon changes the equipped weapon and locks attacks for SWITCH_RECOVERY_MS', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    expect(player.equippedWeaponId).toBe('bow');
    expect(() => player.tryAction('bow.shot')).not.toThrow();
    expect(player.state).toBe('idle'); // rejected: still locked
  });

  it('the attack lock clears on its own after SWITCH_RECOVERY_MS', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.step(SWITCH_RECOVERY_MS);
    player.tryAction('bow.shot');
    expect(player.state).toBe('acting');
  });

  it('switching to the already-equipped weapon is a no-op and does not lock attacks', () => {
    const { player } = makePlayer();
    player.switchWeapon('sword_shield'); // already equipped
    player.tryAction('sword_shield.light');
    expect(player.state).toBe('acting');
  });

  it('tryDodge cancels the switch lock immediately', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.tryDodge();
    player.step(DODGE.durationMs); // return to idle
    player.tryAction('bow.shot');
    expect(player.state).toBe('acting');
  });

  it('switching again before the previous lock elapses resets the lock to a full SWITCH_RECOVERY_MS', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.step(SWITCH_RECOVERY_MS - 20); // 20ms left on the first lock
    player.switchWeapon('heavy_weapon'); // resets to a fresh SWITCH_RECOVERY_MS
    player.step(30); // would have cleared the *first* lock, not a fresh one
    expect(() => player.tryAction('heavy_weapon.light')).not.toThrow();
    expect(player.state).toBe('idle'); // still locked
  });

  it('tryAction rejects an action belonging to a non-equipped weapon, without throwing or changing state', () => {
    const { player } = makePlayer();
    expect(() => player.tryAction('bow.shot')).not.toThrow(); // sword_shield still equipped by default
    expect(player.state).toBe('idle');
  });
});

describe('PlayerController — defensive kit (blocking/parry/stagger/poise)', () => {
  it('starts with full poise', () => {
    const { player } = makePlayer();
    expect(player.poise).toBe(POISE_MAX);
  });

  it('startBlock() transitions to blocking, only from idle', () => {
    const { player } = makePlayer();
    player.startBlock();
    expect(player.state).toBe('blocking');
    expect(player.isBlocking).toBe(true);
  });

  it('startBlock() is a no-op outside idle', () => {
    const { player } = makePlayer();
    player.tryDodge();
    expect(player.state).toBe('dodging');
    player.startBlock();
    expect(player.state).toBe('dodging'); // unchanged
  });

  it('stopBlock() returns to idle', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.stopBlock();
    expect(player.state).toBe('idle');
  });

  it('isParryTiming is true just after starting the block, false once past PARRY_WINDOW_MS', () => {
    const { player } = makePlayer();
    player.startBlock();
    expect(player.isParryTiming).toBe(true);
    player.step(PARRY_WINDOW_MS + 10);
    expect(player.isParryTiming).toBe(false);
    expect(player.isBlocking).toBe(true); // still blocking, just past the parry window
  });

  it('absorbBlockHit() drains poise by POISE_DRAIN_PER_BLOCK', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.absorbBlockHit();
    expect(player.poise).toBe(POISE_MAX - POISE_DRAIN_PER_BLOCK);
    expect(player.state).toBe('blocking'); // poise not yet broken
  });

  it('poise breaking (3 absorbed hits) enters staggered', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.absorbBlockHit();
    player.absorbBlockHit();
    player.absorbBlockHit();
    expect(player.poise).toBe(0);
    expect(player.state).toBe('staggered');
  });

  it('enterStagger() blocks all input until STAGGER_MS elapses, then returns to idle', () => {
    const { player } = makePlayer();
    player.enterStagger();
    expect(player.state).toBe('staggered');
    player.tryDodge();
    expect(player.state).toBe('staggered'); // still locked out
    player.step(STAGGER_MS - 1);
    expect(player.state).toBe('staggered');
    player.step(2);
    expect(player.state).toBe('idle');
  });

  it('poise regenerates after POISE_REGEN_DELAY_MS of standing idle, even across a single large step()', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.absorbBlockHit();
    player.stopBlock(); // back to idle, poise = 60, regen delay armed at 1000ms
    player.step(POISE_REGEN_DELAY_MS + 1000); // one big step: 1000ms of delay + 1000ms of regen
    expect(player.poise).toBe(POISE_MAX); // 60 + (1000/1000)*50 = 110, clamped to 100
  });

  it('poise never regenerates above POISE_MAX', () => {
    const { player } = makePlayer();
    player.step(POISE_REGEN_DELAY_MS + 5000);
    expect(player.poise).toBe(POISE_MAX);
  });
});

describe('PlayerController — diagonal attacks', () => {
  it('a diagonal attack reaches a target positioned on that diagonal (regression: old 4-quadrant hitbox could miss this)', () => {
    const { player } = makePlayer();
    player.setAimDirection({ x: 1, y: 1 });
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs + 10);
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    const targetBox = { x: 30, y: 30, width: 20, height: 20 }; // on the same diagonal, within reach (LIGHT.reach=45 + 10)
    expect(sectorOverlapsBox(hitbox!, targetBox)).toBe(true);
  });
});
