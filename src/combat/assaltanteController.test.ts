// src/combat/assaltanteController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from '../opportunity/opportunitySystem';
import { AssaltanteController } from './assaltanteController';
import { PARRY_BONUS_RECOVERY_MS } from './actionDefs';
import { sectorOverlapsBox } from './sector';

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
    expect(hitbox!.direction).toEqual({ x: 1, y: 0 });
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
    expect(hitbox!.direction).toEqual({ x: 0, y: -1 }); // extends upward, toward player
  });

  it('exposes the current attack direction, for visual/HUD purposes', () => {
    const { enemy } = makeAssaltante();
    expect(enemy.attackDirection).toEqual({ x: -1, y: 0 });
    enemy.step(16, { x: 130, y: 0 }); // player to the right, distance 30 -> attacks
    expect(enemy.attackDirection).toEqual({ x: 1, y: 0 });
  });

  it('onPlayerWrongAction resolves the active dodge opportunity as missed with the given attempt', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 }); // enters attacking, opens dodge
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerWrongAction('light_attack');
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dodge', outcome: 'missed', attempt: 'light_attack' }),
    );
    expect(opp.activeOfType('dodge')).toHaveLength(0);
  });

  it('onPlayerWrongAction outside the attacking state is a no-op', () => {
    const { enemy, bus } = makeAssaltante();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerWrongAction('light_attack'); // still idle, no active dodge opportunity
    expect(closeHandler).not.toHaveBeenCalled();
  });

  it('punish opportunity expires normally when the player is in range at some point during the window', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 }); // enters attacking
    opp.step(16);
    let elapsed = 16;
    while (enemy.state === 'attacking' && elapsed < 2000) {
      enemy.step(16, { x: 70, y: 0 });
      opp.step(16);
      elapsed += 16;
    }
    expect(enemy.state).toBe('recovering');
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    elapsed = 0;
    while (enemy.state === 'recovering' && elapsed < 1000) {
      enemy.step(16, { x: 70, y: 0 }); // stays within ATTACK_REACH (45) the whole window
      opp.step(16);
      elapsed += 16;
    }
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'punish', outcome: 'expired' }),
    );
  });

  it('punish opportunity resolves as invalid/out_of_range when the player never enters range during the window', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 }); // enters attacking
    opp.step(16);
    let elapsed = 16;
    while (enemy.state === 'attacking' && elapsed < 2000) {
      enemy.step(16, { x: 70, y: 0 });
      opp.step(16);
      elapsed += 16;
    }
    expect(enemy.state).toBe('recovering');
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    elapsed = 0;
    while (enemy.state === 'recovering' && elapsed < 1000) {
      enemy.step(16, { x: 1000, y: 0 }); // far outside ATTACK_REACH the whole window
      opp.step(16);
      elapsed += 16;
    }
    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'punish', outcome: 'invalid', reason: 'out_of_range' }),
    );
  });

  it('onPlayerParrySuccess() during attacking cuts the swing short, resolves dodge as taken, and opens a bigger punish window', () => {
    const { enemy, opp, bus } = makeAssaltante();
    enemy.step(16, { x: 70, y: 0 }); // enters attacking
    const closeHandler = vi.fn();
    const openHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    bus.on('opp.open', openHandler);

    enemy.onPlayerParrySuccess();

    expect(closeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dodge', outcome: 'taken' }),
    );
    expect(enemy.state).toBe('recovering');
    expect(opp.activeOfType('punish')).toHaveLength(1);
    expect(openHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'punish', src: 'assaltante.recover', window_ms: PARRY_BONUS_RECOVERY_MS }),
    );
  });

  it('onPlayerParrySuccess() outside the attacking state is a no-op', () => {
    const { enemy, bus } = makeAssaltante();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    enemy.onPlayerParrySuccess(); // still idle, no active dodge opportunity
    expect(closeHandler).not.toHaveBeenCalled();
    expect(enemy.state).toBe('idle');
  });

  it('attack hitbox reaches a diagonally-positioned player (regression: old 4-quadrant hitbox could miss this)', () => {
    const { enemy } = makeAssaltante(); // enemy at x=100, y=0, 20x20
    const playerPos = { x: 130, y: 30 }; // diagonal offset, distance ~42.4, within ATTACK_RANGE (60)
    enemy.step(16, playerPos);
    expect(enemy.state).toBe('attacking');
    let elapsed = 16;
    while (elapsed < 416) {
      enemy.step(16, playerPos);
      elapsed += 16;
    }
    const hitbox = enemy.attackHitbox();
    expect(hitbox).not.toBeNull();
    const playerHurtbox = { x: playerPos.x, y: playerPos.y, width: 20, height: 20 };
    expect(sectorOverlapsBox(hitbox!, playerHurtbox)).toBe(true);
  });

  it('msUntilThreatens returns null for a fresh, far-away enemy with a short horizon', () => {
    const { enemy } = makeAssaltante(); // idle, at x=100
    const target = { x: -1000, y: 0, width: 20, height: 20 };
    expect(enemy.msUntilThreatens(target, 100)).toBeNull();
  });

  it('msUntilThreatens returns the remaining telegraph time once attacking, aimed at the target', () => {
    const { enemy } = makeAssaltante(); // at x=100, y=0, 20x20
    enemy.step(16, { x: 70, y: 0 }); // distance 30 <= ATTACK_RANGE(60) -> attacking, aimed left
    expect(enemy.state).toBe('attacking');
    const target = { x: 70, y: 0, width: 20, height: 20 };
    expect(enemy.msUntilThreatens(target, 500)).toBe(384); // TELEGRAPH_MS(400) - phaseElapsedMs(16)
  });
});
