// src/combat/playerController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { PlayerController } from './playerController';
import { DODGE } from './actionDefs';
import { SWORD_SHIELD_ACTIONS } from './actionRegistry';
import { PLAYER_MOVE_SPEED, ARENA_BOUNDS } from './movementDefs';

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
    expect(hitbox!.width).toBeCloseTo(HEAVY.reach);

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
    expect(hitbox!.width).toBeCloseTo(CHARGED.charge!.reachMax);
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
    const midpointReach = (CHARGED.reach + CHARGED.charge!.reachMax) / 2;
    expect(hitbox!.width).toBeCloseTo(midpointReach);
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
    expect(hitbox!.y).toBeLessThan(player.hurtbox().y); // reach strip is above the hurtbox, matching the aim
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
