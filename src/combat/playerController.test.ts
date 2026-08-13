import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { PlayerController } from './playerController';
import { LIGHT_ATTACK, DODGE, totalDurationMs } from './actionDefs';

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
    expect(player.state).toBe('idle'); // still on cooldown, ignored
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
});
