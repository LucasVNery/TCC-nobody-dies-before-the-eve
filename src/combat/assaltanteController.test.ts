// src/combat/assaltanteController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from '../opportunity/opportunitySystem';
import { AssaltanteController } from './assaltanteController';

function makeAssaltante() {
  const bus = new EventBus<GameEvents>();
  const opp = new OpportunitySystem(bus);
  const enemy = new AssaltanteController(bus, opp, { x: 100, y: 0, width: 20, height: 20 });
  return { bus, opp, enemy };
}

describe('AssaltanteController', () => {
  it('starts idle', () => {
    const { enemy } = makeAssaltante();
    expect(enemy.state).toBe('idle');
  });

  it('chases when far from the player', () => {
    const { enemy } = makeAssaltante();
    enemy.step(16, { x: -100, y: 0 });
    expect(enemy.state).toBe('chasing');
  });

  it('attacks and opens a dodge opportunity when in range', () => {
    const { bus, enemy } = makeAssaltante();
    const openHandler = vi.fn();
    bus.on('opp.open', openHandler);
    enemy.step(16, { x: 70, y: 0 });
    expect(enemy.state).toBe('attacking');
    expect(openHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dodge', src: 'assaltante.attack' }),
    );
  });

  it('opens exactly one dodge opportunity on entering attack, visible via the opportunity system', () => {
    const { enemy, opp } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 });
    expect(opp.activeOfType('dodge')).toHaveLength(1);
  });

  it('transitions attacking -> recovering and opens a punish opportunity', () => {
    const { enemy, opp } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 });
    let elapsed = 16;
    while (enemy.state === 'attacking' && elapsed < 2000) {
      enemy.step(16, { x: 70, y: 0 });
      elapsed += 16;
    }
    expect(enemy.state).toBe('recovering');
    expect(opp.activeOfType('punish')).toHaveLength(1);
  });

  it('onPlayerHitLanded() during recovering resolves the punish opportunity as taken', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 });
    let elapsed = 16;
    while (enemy.state === 'attacking' && elapsed < 2000) {
      enemy.step(16, { x: 70, y: 0 });
      elapsed += 16;
    }
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerHitLanded();
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'punish', outcome: 'taken' }),
    );
    expect(opp.activeOfType('punish')).toHaveLength(0);
  });

  it('onPlayerDodgeSuccess() during attacking resolves the dodge opportunity as taken', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 });
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerDodgeSuccess();
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dodge', outcome: 'taken' }),
    );
    expect(opp.activeOfType('dodge')).toHaveLength(0);
  });

  it('resolves the dodge opportunity as taken when the dodge lands during the swing (after telegraph ends)', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 });
    let elapsed = 16;
    while (elapsed < 416) {
      enemy.step(16, { x: 70, y: 0 });
      elapsed += 16;
    }
    expect(enemy.state).toBe('attacking');
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerDodgeSuccess();
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dodge', outcome: 'taken' }),
    );
    expect(opp.activeOfType('dodge')).toHaveLength(0);
  });

  it('moves toward the player while chasing', () => {
    const { enemy } = makeAssaltante();
    const before = enemy.position.x;
    enemy.step(16, { x: -100, y: 0 });
    expect(enemy.position.x).toBeLessThan(before);
  });

  it('attacks toward the player when the player is to the right, not always left', () => {
    const { enemy } = makeAssaltante();
    enemy.step(16, { x: 130, y: 0 }); // player to the right, distance 30
    expect(enemy.state).toBe('attacking');
    let elapsed = 16;
    while (elapsed < 416) {
      enemy.step(16, { x: 130, y: 0 });
      elapsed += 16;
    }
    const hitbox = enemy.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.x).toBeGreaterThan(enemy.position.x);
  });

  it('exposes the id of the currently selected rule, for HUD/debug purposes', () => {
    const { enemy } = makeAssaltante();
    enemy.step(16, { x: -100, y: 0 }); // far away -> chase
    expect(enemy.activeRuleId).toBe('assaltante.chase');
    enemy.step(16, { x: 70, y: 0 }); // in range -> attack
    expect(enemy.activeRuleId).toBe('assaltante.attack');
  });

  it('attacks toward the player when the player is above, not always horizontal', () => {
    const { enemy } = makeAssaltante(); // enemy at x=100, y=0
    enemy.step(16, { x: 100, y: -30 }); // player directly above, distance 30
    expect(enemy.state).toBe('attacking');
    let elapsed = 16;
    while (elapsed < 416) {
      enemy.step(16, { x: 100, y: -30 });
      elapsed += 16;
    }
    const hitbox = enemy.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.y).toBeLessThan(enemy.position.y); // extends upward, toward player
  });

  it('exposes the current attack direction, for visual/HUD purposes', () => {
    const { enemy } = makeAssaltante();
    expect(enemy.attackDirection).toEqual({ x: -1, y: 0 });
    enemy.step(16, { x: 130, y: 0 }); // player to the right, distance 30 -> attacks
    expect(enemy.attackDirection).toEqual({ x: 1, y: 0 });
  });
});
