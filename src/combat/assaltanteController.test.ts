// src/combat/assaltanteController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from '../opportunity/opportunitySystem';
import { AssaltanteController } from './assaltanteController';
import { PARRY_BONUS_RECOVERY_MS } from './actionDefs';
import { sectorOverlapsBox } from './sector';
import { ASSALTANTE_MAX_HP, ASSALTANTE_CHASE_SPEED, ARENA_BOUNDS, LUNGE } from './movementDefs';

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

  it('attackDirection (used for sprite facing) tracks the chase direction while chasing, not a stale attack direction', () => {
    const { enemy } = makeAssaltante(); // starts at x=100, y=0
    enemy.step(16, { x: -100, y: 0 }); // player far to the left -> chases left
    expect(enemy.state).toBe('chasing');
    expect(enemy.attackDirection).toEqual({ x: -1, y: 0 });

    enemy.step(16, { x: 300, y: 0 }); // player now far to the right -> chases right
    expect(enemy.state).toBe('chasing');
    expect(enemy.attackDirection).toEqual({ x: 1, y: 0 });
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

  it('emits enemy.attack_start when it starts an attack', () => {
    const { bus, enemy } = makeAssaltante();
    const started = vi.fn();
    bus.on('enemy.attack_start', started);
    enemy.step(16, { x: 110, y: 0 }); // in range -> attacks
    expect(enemy.state).toBe('attacking');
    expect(started).toHaveBeenCalledTimes(1);
    expect(started).toHaveBeenCalledWith({ kind: 'swing' });
  });

  it('takeDamage lowers hp, clamps at 0 and flips isDead', () => {
    const { enemy } = makeAssaltante();
    expect(enemy.hp).toBe(ASSALTANTE_MAX_HP);
    enemy.takeDamage(20);
    expect(enemy.hp).toBe(ASSALTANTE_MAX_HP - 20);
    enemy.takeDamage(999);
    expect(enemy.hp).toBe(0);
    expect(enemy.isDead).toBe(true);
  });

  it('respawn() closes its open opportunity as invalid with the given reason and resets hp/state/position', () => {
    const { bus, enemy } = makeAssaltante();
    const closes: Array<{ type: string; outcome: string; reason?: string }> = [];
    bus.on('opp.close', (e) => closes.push(e));
    enemy.step(16, { x: 110, y: 0 }); // opens a 'dodge' window
    enemy.takeDamage(999);

    enemy.respawn({ x: 800, y: 600 }, 'source_interrupted');

    expect(closes).toEqual([{ opp_id: expect.any(String), type: 'dodge', outcome: 'invalid', reason: 'source_interrupted' }]);
    expect(enemy.hp).toBe(ASSALTANTE_MAX_HP);
    expect(enemy.state).toBe('idle');
    expect(enemy.position).toEqual({ x: 800, y: 600 });
  });

  it('respawn() with no open opportunity closes nothing', () => {
    const { bus, enemy } = makeAssaltante();
    const closes = vi.fn();
    bus.on('opp.close', closes);
    enemy.respawn({ x: 0, y: 0 }, 'player_dead');
    expect(closes).not.toHaveBeenCalled();
  });
});

describe('AssaltanteController lunge', () => {
  const FAR_LEFT = { x: -5000, y: 600 };
  const spawn = { x: 0, y: 600 };

  // Enemy pinned against the left wall (y=600), so ageing the cooldown with a far-left player does not move it.
  function fresh() {
    const ctx = makeAssaltante();
    ctx.enemy.respawn(spawn, 'source_interrupted');
    return ctx;
  }
  function age(enemy: AssaltanteController, ms: number) {
    for (let t = 0; t < ms; t += 16) enemy.step(16, FAR_LEFT);
  }
  function readyAt(d: number) {
    const ctx = fresh();
    age(ctx.enemy, LUNGE.cooldownMs);
    return { ...ctx, player: { x: spawn.x + d, y: spawn.y } };
  }
  function startLunge(d = 200) {
    const ctx = readyAt(d);
    ctx.enemy.step(16, ctx.player);
    expect(ctx.enemy.state).toBe('lunging');
    return ctx;
  }
  function runUntil(enemy: AssaltanteController, player: { x: number; y: number }, pred: () => boolean, maxMs = 5000) {
    let t = 0;
    while (!pred() && t < maxMs) {
      enemy.step(16, player);
      t += 16;
    }
    return t;
  }

  it('chases at 150 u/s', () => {
    expect(ASSALTANTE_CHASE_SPEED).toBe(150);
    const { enemy } = makeAssaltante();
    enemy.respawn({ x: 800, y: 600 }, 'source_interrupted');
    const x0 = enemy.position.x;
    for (let i = 0; i < 100; i++) enemy.step(10, { x: -2000, y: 600 }); // 1000 ms
    expect(x0 - enemy.position.x).toBeCloseTo(150, 5);
  });

  it('does not lunge while the spawn cooldown is active, even in the band', () => {
    const { enemy } = fresh();
    enemy.step(16, { x: 200, y: 600 });
    expect(enemy.state).toBe('chasing');
    age(enemy, 5000);
    enemy.step(16, { x: 200, y: 600 });
    expect(enemy.state).toBe('chasing');
  });

  it('lunges only in [150, 260] once ready (120, 149, 261 do not)', () => {
    for (const [d, expected] of [
      [120, 'chasing'],
      [149, 'chasing'],
      [150, 'lunging'],
      [260, 'lunging'],
      [261, 'chasing'],
    ] as const) {
      const { enemy, player } = readyAt(d);
      enemy.step(16, player);
      expect(enemy.state, `d=${d}`).toBe(expected);
    }
  });

  it('attack (<= 60) has priority over a ready lunge', () => {
    const { enemy } = readyAt(0);
    enemy.step(16, { x: spawn.x + 50, y: spawn.y });
    expect(enemy.state).toBe('attacking');
  });

  it('the cooldown restarts at the lunge start: the next lunge begins exactly 6000 ms later', () => {
    const { bus, enemy, player } = readyAt(200);
    let tick = 0;
    const starts: Array<{ tick: number; kind: string }> = [];
    bus.on('enemy.attack_start', (e) => starts.push({ tick, kind: e.kind }));
    enemy.step(16, player); // tick 0: first lunge starts
    // the player flees at a constant 200 u so the enemy is in the band whenever it is free to act
    for (tick = 1; tick <= 380; tick++) {
      enemy.step(16, { x: enemy.position.x + 200, y: enemy.position.y });
    }
    expect(starts).toEqual([
      { tick: 0, kind: 'lunge' },
      { tick: LUNGE.cooldownMs / 16, kind: 'lunge' },
    ]);
  });

  it('telegraphs 500 ms standing still without damage, then charges', () => {
    const { enemy, player } = startLunge(200);
    const x0 = enemy.position.x;
    expect(enemy.attackHitbox()).toBeNull();
    expect(enemy.strikeLanding()).toBe(false);
    for (let t = 16; t < LUNGE.telegraphMs - 16; t += 16) {
      enemy.step(16, player);
      expect(enemy.position.x).toBe(x0);
      expect(enemy.attackHitbox()).toBeNull();
    }
    expect(enemy.lungePhase).toBe('telegraph');
    runUntil(enemy, player, () => enemy.lungePhase === 'charge');
    expect(enemy.lungePhase).toBe('charge');
    expect(enemy.attackHitbox()).not.toBeNull();
  });

  it('aim follows the player during the telegraph and is locked at its end', () => {
    const { enemy } = startLunge(200);
    enemy.step(16, { x: spawn.x, y: spawn.y + 200 }); // now straight down
    expect(enemy.attackDirection).toEqual({ x: 0, y: 1 });
    runUntil(enemy, { x: spawn.x, y: spawn.y + 200 }, () => enemy.lungePhase === 'charge');
    const locked = enemy.attackDirection;
    for (let i = 0; i < 5; i++) enemy.step(16, { x: 1000, y: 0 }); // player moves away: aim must not change
    expect(enemy.attackDirection).toEqual(locked);
    expect(enemy.position.x).toBe(spawn.x);
    expect(enemy.position.y).toBeGreaterThan(spawn.y);
  });

  it('travels at most 260 u at 450 u/s, then recovers with a 500 ms punish window', () => {
    const { enemy, opp } = startLunge(200); // player to the right, far beyond contact once it passes
    const player = { x: spawn.x + 200, y: spawn.y };
    runUntil(enemy, player, () => enemy.lungePhase === 'charge');
    const x0 = enemy.position.x;
    let ticks = 0;
    while (enemy.state === 'lunging') {
      enemy.step(16, player);
      ticks++;
    }
    expect(enemy.position.x - x0).toBeCloseTo(LUNGE.maxTravel, 5);
    expect(ticks).toBe(Math.ceil(LUNGE.maxTravel / ((LUNGE.speed * 16) / 1000)));
    expect(enemy.state).toBe('recovering');
    expect(opp.activeOfType('punish')[0].remainingMs).toBe(500);
  });

  it('stops at the arena wall without leaving it', () => {
    const { enemy, opp } = makeAssaltante();
    const right = ARENA_BOUNDS.x + ARENA_BOUNDS.width - 20;
    enemy.respawn({ x: right - 80, y: 0 }, 'source_interrupted'); // 80 px from the right wall, on the top wall
    for (let t = 0; t < LUNGE.cooldownMs; t += 16) enemy.step(16, { x: right - 80, y: -5000 }); // pinned at the top wall
    expect(enemy.position).toEqual({ x: right - 80, y: 0 });
    const player = { x: right - 80 + 200, y: 0 };
    enemy.step(16, player);
    expect(enemy.state).toBe('lunging');
    while (enemy.state === 'lunging') {
      enemy.step(16, player);
      expect(enemy.position.x).toBeLessThanOrEqual(right);
    }
    expect(enemy.position.x).toBe(right);
    expect(enemy.state).toBe('recovering');
    expect(opp.activeOfType('punish')).toHaveLength(1);
  });

  it('emits enemy.attack_start with kind lunge and opens a dodge window of 500 + 260/450 s as assaltante.lunge', () => {
    const { bus, enemy, player } = readyAt(200);
    const started = vi.fn();
    const opened = vi.fn();
    bus.on('enemy.attack_start', started);
    bus.on('opp.open', opened);
    enemy.step(16, player);
    expect(started).toHaveBeenCalledWith({ kind: 'lunge' });
    expect(opened).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dodge', src: 'assaltante.lunge', window_ms: 500 + (260 / 450) * 1000 }),
    );
    expect(enemy.isCommitted).toBe(true);
  });

  it('parry during the lunge: taken, recovering with a 750 ms punish window', () => {
    const { bus, enemy, opp, player } = startLunge(200);
    const closes: Array<{ type: string; outcome: string }> = [];
    bus.on('opp.close', (e) => closes.push(e));
    runUntil(enemy, player, () => enemy.lungePhase === 'charge');
    enemy.onPlayerParrySuccess();
    expect(closes).toEqual([expect.objectContaining({ type: 'dodge', outcome: 'taken' })]);
    expect(enemy.state).toBe('recovering');
    expect(opp.activeOfType('punish')[0].remainingMs).toBe(PARRY_BONUS_RECOVERY_MS);
  });

  it('dodge during the lunge resolves the window taken once and the body keeps moving', () => {
    const { bus, enemy, player } = startLunge(200);
    const closes: Array<{ type: string; outcome: string }> = [];
    bus.on('opp.close', (e) => closes.push(e));
    runUntil(enemy, player, () => enemy.lungePhase === 'charge');
    enemy.onPlayerDodgeSuccess();
    enemy.onPlayerDodgeSuccess();
    expect(closes).toEqual([expect.objectContaining({ type: 'dodge', outcome: 'taken' })]);
    expect(enemy.state).toBe('lunging');
  });

  it('a wrong action during the lunge closes the window as missed', () => {
    const { bus, enemy } = startLunge(200);
    const closes: Array<{ outcome: string }> = [];
    bus.on('opp.close', (e) => closes.push(e));
    enemy.onPlayerWrongAction('sword.light');
    expect(closes).toEqual([expect.objectContaining({ outcome: 'missed' })]);
  });

  it('strikeLanding is true only while charging within 60 of the player', () => {
    const { enemy } = startLunge(200);
    const far = { x: spawn.x + 200, y: spawn.y };
    runUntil(enemy, far, () => enemy.lungePhase === 'charge');
    expect(enemy.strikeLanding()).toBe(false); // transition tick: not moving yet
    enemy.step(16, far); // body at ~7 u, player 193 away
    expect(enemy.strikeLanding()).toBe(false);
    enemy.step(16, { x: enemy.position.x + 60, y: spawn.y });
    expect(enemy.strikeLanding()).toBe(true);
    enemy.step(16, { x: enemy.position.x + 80, y: spawn.y });
    expect(enemy.strikeLanding()).toBe(false);
  });

  it('a player dying during the lunge: respawn closes the open window invalid/player_dead and resets the cooldown', () => {
    const { bus, enemy, player } = startLunge(200);
    const closes: Array<{ type: string; outcome: string; reason?: string }> = [];
    bus.on('opp.close', (e) => closes.push(e));
    runUntil(enemy, player, () => enemy.lungePhase === 'charge');
    enemy.respawn(spawn, 'player_dead');
    expect(closes).toEqual([expect.objectContaining({ type: 'dodge', outcome: 'invalid', reason: 'player_dead' })]);
    expect(enemy.state).toBe('idle');
    enemy.step(16, player); // cooldown back to 6000: no lunge
    expect(enemy.state).toBe('chasing');
  });

  it('stagger closes the open window as invalid/source_interrupted and recovers for the given time without a punish window', () => {
    const { bus, enemy, opp, player } = startLunge(200);
    const closes: Array<{ type: string; outcome: string; reason?: string }> = [];
    bus.on('opp.close', (e) => closes.push(e));
    enemy.stagger(1000);
    expect(closes).toEqual([expect.objectContaining({ outcome: 'invalid', reason: 'source_interrupted' })]);
    expect(enemy.state).toBe('recovering');
    expect(opp.activeOfType('punish')).toHaveLength(0);
    let ms = 0;
    while (enemy.state === 'recovering') {
      enemy.step(16, player);
      ms += 16;
    }
    expect(ms).toBeGreaterThanOrEqual(1000);
    expect(ms).toBeLessThan(1000 + 16);
  });

  it('msUntilThreatens: telegraph -> remaining ms within the horizon else null; moving -> 0', () => {
    const { enemy, player } = startLunge(200);
    const target = { x: 0, y: 0, width: 20, height: 20 };
    expect(enemy.msUntilThreatens(target, 600)).toBe(LUNGE.telegraphMs - 16);
    expect(enemy.msUntilThreatens(target, 484)).toBe(484);
    expect(enemy.msUntilThreatens(target, 483)).toBeNull();
    runUntil(enemy, player, () => enemy.lungePhase === 'charge');
    expect(enemy.msUntilThreatens(target, 1)).toBe(0);
  });
});
