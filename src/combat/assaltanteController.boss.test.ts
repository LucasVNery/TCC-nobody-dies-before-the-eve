// src/combat/assaltanteController.boss.test.ts
import { describe, it, expect } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from '../opportunity/opportunitySystem';
import { AssaltanteController, SWING_MS, TELEGRAPH_MS } from './assaltanteController';
import { primeElite } from './testing/eliteTestKit';
import { ASSALTANTE_MAX_HP, ASSALTANTE_CHASE_SPEED } from './movementDefs';
import { BOSS_CONFIG } from '../boss/bossConfig';

const STEP = 1000 / 60;

function makeEnemy(x = 100, y = 600) {
  const bus = new EventBus<GameEvents>();
  const opp = new OpportunitySystem(bus);
  const enemy = new AssaltanteController(bus, opp, { x, y, width: 20, height: 20 });
  return { bus, opp, enemy };
}

/** Distance chased in 1 s toward a far, stationary player (fresh enemy: no pattern can start within 1 s). */
function chasedInOneSecond(enemy: AssaltanteController): number {
  const start = enemy.position;
  const player = { x: start.x + 900, y: start.y }; // beyond the long charge's reach
  for (let i = 0; i < 60; i++) enemy.step(STEP, player);
  return Math.hypot(enemy.position.x - start.x, enemy.position.y - start.y);
}

describe('AssaltanteController — boss mode', () => {
  it('maxHp is the elite max outside boss mode', () => {
    const { enemy } = makeEnemy();
    expect(enemy.maxHp).toBe(ASSALTANTE_MAX_HP);
  });

  it('configureBoss sets hp and maxHp and restarts idle', () => {
    const { enemy } = makeEnemy();
    enemy.takeDamage(50);
    enemy.configureBoss({ maxHp: BOSS_CONFIG.bossMaxHp, advanceMult: 1.4, bodyScale: 1 });
    expect(enemy.hp).toBe(400);
    expect(enemy.maxHp).toBe(400);
    expect(enemy.state).toBe('idle');
  });

  it('configureBoss closes an open window as source_interrupted', () => {
    const { enemy, bus } = makeEnemy(100, 0);
    primeElite(enemy);
    enemy.step(STEP, { x: 70, y: 0 }); // swing: dodge window open
    const closed: GameEvents['opp.close'][] = [];
    bus.on('opp.close', (p) => closed.push(p));
    enemy.configureBoss({ maxHp: 400, advanceMult: 1, bodyScale: 1 });
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ outcome: 'invalid', reason: 'source_interrupted' });
  });

  it('chases at 150 px/s normally and 210 px/s with advanceMult 1.4', () => {
    expect(chasedInOneSecond(makeEnemy().enemy)).toBeCloseTo(ASSALTANTE_CHASE_SPEED, 0);
    const { enemy } = makeEnemy();
    enemy.configureBoss({ maxHp: 400, advanceMult: 1.4, bodyScale: 1 });
    expect(Math.abs(chasedInOneSecond(enemy) - 210)).toBeLessThanOrEqual(1);
  });

  it('respawn() clears boss mode: 160 hp and 150 px/s', () => {
    const { enemy } = makeEnemy();
    enemy.configureBoss({ maxHp: 400, advanceMult: 1.4, bodyScale: 1 });
    enemy.respawn({ x: 100, y: 600 }, 'source_interrupted');
    expect(enemy.hp).toBe(ASSALTANTE_MAX_HP);
    expect(enemy.maxHp).toBe(ASSALTANTE_MAX_HP);
    expect(Math.abs(chasedInOneSecond(enemy) - 150)).toBeLessThanOrEqual(1);
  });

  it('clearBoss() restores maxHp and speed without touching hp or position', () => {
    const { enemy } = makeEnemy();
    enemy.configureBoss({ maxHp: 400, advanceMult: 1.4, bodyScale: 1 });
    enemy.takeDamage(30);
    const pos = enemy.position;
    enemy.clearBoss();
    expect(enemy.hp).toBe(370);
    expect(enemy.position).toEqual(pos);
    expect(enemy.maxHp).toBe(ASSALTANTE_MAX_HP);
    expect(Math.abs(chasedInOneSecond(enemy) - 150)).toBeLessThanOrEqual(1);
  });

  it('msUntilThreatens uses the effective chase speed', () => {
    const target = { x: 900, y: 600, width: 20, height: 20 };
    const normal = makeEnemy().enemy;
    const boss = makeEnemy().enemy;
    boss.configureBoss({ maxHp: 400, advanceMult: 1.4, bodyScale: 1 });
    primeElite(normal); // past the opening delay: the chase time decides
    primeElite(boss);
    const tNormal = normal.msUntilThreatens(target, 10_000);
    const tBoss = boss.msUntilThreatens(target, 10_000);
    expect(tNormal).not.toBeNull();
    expect(tBoss).not.toBeNull();
    expect(tBoss!).toBeLessThan(tNormal!);
  });
});

describe('AssaltanteController — barrage', () => {
  const PAUSE = BOSS_CONFIG.barragePauseMs; // 250
  const BSTEP = 16;
  const PLAYER = { x: 70, y: 0 };

  function runBarrage() {
    const { bus, opp, enemy } = makeEnemy(100, 0);
    primeElite(enemy);
    let clock = 0;
    const starts: { t: number; kind: string }[] = [];
    const dodgeOpens: string[] = [];
    const strikeEnds: number[] = [];
    bus.on('enemy.attack_start', (p) => starts.push({ t: clock, kind: p.kind }));
    bus.on('opp.open', (p) => {
      if (p.type === 'dodge') dodgeOpens.push(p.src);
    });
    enemy.startBarrage(3, PAUSE);
    expect(enemy.isBarraging).toBe(true);
    let wasAttacking = false;
    for (let i = 0; i < 200 && (enemy.isBarraging || enemy.state === 'attacking'); i++) {
      clock += BSTEP;
      enemy.step(BSTEP, PLAYER);
      opp.step(BSTEP);
      if (wasAttacking && enemy.state !== 'attacking') strikeEnds.push(clock);
      wasAttacking = enemy.state === 'attacking';
    }
    return { enemy, starts, dodgeOpens, strikeEnds };
  }

  it('produces exactly 3 swings, each with its dodge window, paced by the barrage pause', () => {
    const { enemy, starts, dodgeOpens, strikeEnds } = runBarrage();
    expect(starts).toEqual([
      expect.objectContaining({ kind: 'swing' }),
      expect.objectContaining({ kind: 'swing' }),
      expect.objectContaining({ kind: 'swing' }),
    ]);
    expect(dodgeOpens).toEqual(['assaltante.attack', 'assaltante.attack', 'assaltante.attack']);
    expect(strikeEnds.length).toBeGreaterThanOrEqual(2);
    for (let k = 0; k < 2; k++) {
      // the start step already counts toward the strike's phase
      const strikeLength = strikeEnds[k] - starts[k].t + BSTEP;
      expect(strikeLength).toBeGreaterThanOrEqual(TELEGRAPH_MS + SWING_MS);
      const gap = starts[k + 1].t - strikeEnds[k];
      expect(gap).toBeLessThanOrEqual(PAUSE + BSTEP);
    }
    expect(enemy.isBarraging).toBe(false);
    expect(enemy.state).toBe('recovering'); // the last strike recovers normally
  });

  it('activeRuleId is assaltante.attack on a barrage strike', () => {
    const { enemy } = makeEnemy(100, 0);
    primeElite(enemy);
    enemy.startBarrage(2, PAUSE);
    enemy.step(BSTEP, PLAYER);
    expect(enemy.state).toBe('attacking');
    expect(enemy.activeRuleId).toBe('assaltante.attack');
  });

  it('chases into range before striking when the player is far', () => {
    const { enemy, bus } = makeEnemy(100, 0);
    const starts: string[] = [];
    bus.on('enemy.attack_start', (p) => starts.push(p.kind));
    enemy.startBarrage(1, PAUSE); // fresh enemy: the first-attack delay does not gate barrage strikes
    enemy.step(BSTEP, { x: 300, y: 0 });
    expect(enemy.state).toBe('chasing');
    expect(enemy.activeRuleId).toBe('assaltante.chase');
    for (let i = 0; i < 120 && starts.length === 0; i++) enemy.step(BSTEP, { x: 300, y: 0 });
    expect(starts).toEqual(['swing']);
  });

  it('startBarrage during an attack is ignored', () => {
    const { enemy } = makeEnemy(100, 0);
    primeElite(enemy);
    enemy.step(BSTEP, PLAYER);
    expect(enemy.state).toBe('attacking');
    enemy.startBarrage(3, PAUSE);
    expect(enemy.isBarraging).toBe(false);
  });

  it('startBarrage with no strikes is ignored', () => {
    const { enemy } = makeEnemy(100, 0);
    enemy.startBarrage(0, PAUSE);
    expect(enemy.isBarraging).toBe(false);
  });

  it('stagger cancels the barrage', () => {
    const { enemy } = makeEnemy(100, 0);
    primeElite(enemy);
    enemy.startBarrage(3, PAUSE);
    enemy.step(BSTEP, PLAYER);
    enemy.stagger(300);
    expect(enemy.isBarraging).toBe(false);
  });

  it('does not consume the pattern PRNG', () => {
    // Same seed: after a barrage, the next normal pattern draw matches one made with no barrage at all.
    const draw = (barrage: boolean): string[] => {
      const { bus, opp, enemy } = makeEnemy(100, 0);
      enemy.reseed(4242);
      primeElite(enemy);
      const kinds: string[] = [];
      bus.on('enemy.attack_start', (p) => kinds.push(p.kind));
      if (barrage) {
        enemy.startBarrage(2, PAUSE);
        for (let i = 0; i < 400 && (enemy.isBarraging || enemy.state !== 'idle'); i++) {
          enemy.step(BSTEP, PLAYER);
          opp.step(BSTEP);
        }
        kinds.length = 0;
      }
      for (let i = 0; i < 2000 && kinds.length < 8; i++) {
        if (enemy.state === 'idle') primeElite(enemy);
        enemy.step(BSTEP, PLAYER);
        opp.step(BSTEP);
      }
      return kinds;
    };
    const plain = draw(false);
    expect(plain).toHaveLength(8);
    expect(new Set(plain).size).toBeGreaterThan(1); // a real weighted sequence, not one repeated kind
    expect(draw(true)).toEqual(plain);
  });
});
