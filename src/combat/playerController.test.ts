// src/combat/playerController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { PlayerController } from './playerController';
import { LIGHT_ATTACK, DODGE, totalDurationMs } from './actionDefs';
import { PLAYER_MOVE_SPEED, ARENA_BOUNDS } from './movementDefs';

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

  it('tryLightAttack() transitions to attacking and emits player.action', () => {
    const { bus, player } = makePlayer();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryLightAttack();
    expect(player.state).toBe('attacking');
    expect(handler).toHaveBeenCalledWith({ action: 'light_attack' });
  });

  it('attackHitbox() is null during startup', () => {
    const { player } = makePlayer();
    player.tryLightAttack();
    player.step(LIGHT_ATTACK.startupMs - 10);
    expect(player.attackHitbox()).toBeNull();
  });

  it('attackHitbox() is non-null during the active phase', () => {
    const { player } = makePlayer();
    player.tryLightAttack();
    player.step(LIGHT_ATTACK.startupMs + 10);
    expect(player.attackHitbox()).not.toBeNull();
  });

  it('returns to idle after the full attack duration', () => {
    const { player } = makePlayer();
    player.tryLightAttack();
    player.step(totalDurationMs(LIGHT_ATTACK));
    expect(player.state).toBe('idle');
    expect(player.attackHitbox()).toBeNull();
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

  it('ignores tryLightAttack while not idle', () => {
    const { bus, player } = makePlayer();
    player.tryDodge();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryLightAttack();
    expect(player.state).toBe('dodging');
    expect(handler).not.toHaveBeenCalled();
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

  it('ignores moveInput while attacking', () => {
    const { player } = makePlayer();
    player.tryLightAttack();
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
});
