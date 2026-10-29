// src/combat/eliteSelection.test.ts
// Elite weighted pattern choice, mandatory pause and selective stagger (combat v2 spec §4.3).
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from '../opportunity/opportunitySystem';
import { AssaltanteController } from './assaltanteController';
import { Encounter } from './encounter';
import { ELITE } from './eliteDefs';
import { primeElite } from './eliteTestKit';
import { LUNGE } from './movementDefs';

const STEP_MS = 16;

/** Wall-pinned elite (left wall, y = 600) so a far-left player does not move it while it ages. */
const SPAWN = { x: 0, y: 600 };
const FAR_LEFT = { x: -5000, y: 600 };

function makeElite(seed?: number) {
  const bus = new EventBus<GameEvents>();
  const opp = new OpportunitySystem(bus);
  const enemy = new AssaltanteController(bus, opp, { x: SPAWN.x, y: SPAWN.y, width: 20, height: 20 });
  if (seed !== undefined) enemy.reseed(seed);
  const starts: Array<{ t: number; kind: string; hit?: number }> = [];
  let t = 0;
  bus.on('enemy.attack_start', (e) => starts.push({ t, kind: e.kind, hit: (e as { hit?: number }).hit }));
  return {
    enemy,
    bus,
    starts,
    step(player: { x: number; y: number }) {
      enemy.step(STEP_MS, player);
      t += STEP_MS;
    },
    get now() {
      return t;
    },
  };
}

/** Pattern kinds drawn by a primed elite that fights a stationary player 50 u away, for `ms` of simulated time. */
function kindSequence(enemy: AssaltanteController, bus: EventBus<GameEvents>, ms: number): string[] {
  const kinds: string[] = [];
  bus.on('enemy.attack_start', (e) => {
    if ((e as { hit?: number }).hit !== 2) kinds.push(e.kind);
  });
  primeElite(enemy);
  enemy.respawn({ x: 100, y: 100 }, 'source_interrupted');
  primeElite(enemy);
  for (let t = 0; t < ms; t += STEP_MS) {
    enemy.step(STEP_MS, { x: 150, y: 100 });
    // a pattern in progress is never hurt: only the draw matters here
  }
  return kinds;
}

describe('elite pattern choice by distance', () => {
  function startedAt(d: number): string | null {
    const { enemy, starts, step } = makeElite();
    enemy.respawn(SPAWN, 'source_interrupted');
    for (let t = 0; t < 6100; t += STEP_MS) step(FAR_LEFT); // past the opening delay and the lunge cooldown
    expect(starts).toHaveLength(0);
    step({ x: SPAWN.x + d, y: SPAWN.y });
    return starts[0]?.kind ?? null;
  }

  it('at 100 u only the slam is eligible', () => {
    expect(startedAt(100)).toBe('slam');
  });

  it('at 200 u only the lunge is eligible', () => {
    expect(startedAt(200)).toBe('lunge');
  });

  it('from 141 to 149 u and past 260 u nothing is eligible: the elite chases', () => {
    expect(startedAt(145)).toBeNull();
    expect(startedAt(300)).toBeNull();
  });

  it('within 60 u a swing, a combo or a slam may be drawn; the lunge never', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const { enemy, starts, step } = makeElite(seed);
      primeElite(enemy);
      step({ x: SPAWN.x + 50, y: SPAWN.y });
      kinds.add(starts[0].kind);
    }
    expect([...kinds].sort()).toEqual(['combo', 'slam', 'swing']);
  });
});

describe('elite seeded determinism', () => {
  it('the same seed reproduces the sequence; another seed gives another one', () => {
    const run = (seed: number) => {
      const { enemy, bus } = makeElite(seed);
      return kindSequence(enemy, bus, 60_000);
    };
    const a = run(123);
    expect(a.length).toBeGreaterThanOrEqual(10);
    expect(new Set(a).size).toBeGreaterThan(1);
    expect(run(123)).toEqual(a);
    expect(run(124)).not.toEqual(a);
  });

  it('without reseed the controller is deterministic as well (seed 0)', () => {
    const a = makeElite();
    const b = makeElite();
    expect(kindSequence(a.enemy, a.bus, 30_000)).toEqual(kindSequence(b.enemy, b.bus, 30_000));
  });
});

describe('elite opening delay and mandatory pause', () => {
  it('no pattern starts before 2000 ms from birth, even with the player in range', () => {
    const { enemy, starts, step } = makeElite(5);
    const player = { x: SPAWN.x + 30, y: SPAWN.y };
    for (let t = 0; t < ELITE.firstAttackDelayMs - STEP_MS; t += STEP_MS) step(player);
    expect(starts).toHaveLength(0);
    for (let t = 0; t < 2 * STEP_MS; t += STEP_MS) step(player);
    expect(starts).toHaveLength(1);
    expect(enemy.state).toBe('attacking');
  });

  it('a respawned elite waits the opening delay again', () => {
    const { enemy, starts, step } = makeElite(5);
    const player = { x: SPAWN.x + 30, y: SPAWN.y };
    for (let t = 0; t < 2500; t += STEP_MS) step(player);
    expect(starts.length).toBeGreaterThan(0);
    starts.length = 0;
    enemy.respawn(SPAWN, 'source_interrupted');
    for (let t = 0; t < ELITE.firstAttackDelayMs - 2 * STEP_MS; t += STEP_MS) step(player);
    expect(starts).toHaveLength(0);
  });

  it('the lunge cooldown at birth is at least the opening delay (the lunge still waits its own 6000 ms)', () => {
    const { enemy, starts, step } = makeElite();
    enemy.respawn(SPAWN, 'source_interrupted');
    const player = { x: SPAWN.x + 200, y: SPAWN.y };
    for (let t = 0; t < LUNGE.cooldownMs - 2 * STEP_MS; t += STEP_MS) step(FAR_LEFT);
    step(player);
    expect(starts).toHaveLength(0);
    for (let t = 0; t < 3 * STEP_MS; t += STEP_MS) step(player);
    expect(starts.map((s) => s.kind)).toEqual(['lunge']);
  });

  it('at least 700 ms separate the end of a pattern (recovery included) from the next one, except combo strike 2', () => {
    const { enemy, starts, step } = makeElite(77);
    primeElite(enemy);
    const player = { x: SPAWN.x + 50, y: SPAWN.y };
    let lastBusy = -Infinity;
    const gaps: number[] = [];
    let seen = 0;
    for (let i = 0; i < 4000; i++) {
      step(player);
      const busy = enemy.state === 'attacking' || enemy.state === 'lunging' || enemy.state === 'recovering';
      if (starts.length > seen) {
        const s = starts[starts.length - 1];
        seen = starts.length;
        if (s.hit !== 2) gaps.push(i * STEP_MS - lastBusy);
      }
      if (busy) lastBusy = i * STEP_MS;
    }
    expect(gaps.length).toBeGreaterThan(10);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(ELITE.patternPauseMs);
  });

  it('the pause restarts after a stagger: no pattern within 700 ms of its end', () => {
    const { enemy, starts, step } = makeElite(5);
    primeElite(enemy);
    const player = { x: SPAWN.x + 30, y: SPAWN.y };
    enemy.stagger(400);
    let endedAt = -1;
    for (let i = 0; i < 200 && starts.length === 0; i++) {
      step(player);
      if (endedAt < 0 && enemy.state === 'idle') endedAt = i * STEP_MS;
    }
    expect(starts).toHaveLength(1);
    expect(starts[0].t - endedAt).toBeGreaterThanOrEqual(ELITE.patternPauseMs - STEP_MS);
  });
});

describe('selective stagger from the player', () => {
  function scenario(enemyX: number, weapon?: string) {
    // Unprimed: inside its opening delay the elite does not attack, so only the player hit can stagger it.
    const encounter = new Encounter({ x: 0, y: 0, width: 20, height: 20 }, { x: enemyX, y: 0, width: 20, height: 20 });
    if (weapon) {
      encounter.player.switchWeapon(weapon);
      for (let i = 0; i < 16; i++) encounter.step(STEP_MS);
    }
    const stagger = vi.spyOn(encounter.assaltante, 'stagger');
    return { encounter, stagger };
  }
  const run = (e: Encounter, ms: number) => {
    for (let t = 0; t < ms; t += STEP_MS) e.step(STEP_MS);
  };

  it('a connecting charged hit staggers the elite for 400 ms, once', () => {
    const { encounter, stagger } = scenario(30);
    encounter.player.tryAction('sword_shield.charged');
    run(encounter, 300);
    encounter.player.releaseAction();
    run(encounter, 400);
    expect(stagger).toHaveBeenCalledTimes(1);
    expect(stagger).toHaveBeenCalledWith(ELITE.chargedStaggerMs);
    expect(encounter.assaltante.hp).toBeLessThan(160);
  });

  it('light and heavy hits do not interrupt the elite', () => {
    const { encounter, stagger } = scenario(30);
    encounter.player.tryAction('sword_shield.light');
    run(encounter, 400);
    encounter.player.tryAction('sword_shield.heavy');
    run(encounter, 700);
    expect(encounter.assaltante.hp).toBeLessThan(160);
    expect(stagger).not.toHaveBeenCalled();
  });

  it('an arrow does not interrupt the elite', () => {
    const { encounter, stagger } = scenario(220, 'bow');
    const hp0 = encounter.assaltante.hp;
    encounter.player.tryAction('bow.shot');
    run(encounter, 600);
    expect(encounter.assaltante.hp).toBeLessThan(hp0);
    expect(stagger).not.toHaveBeenCalled();
  });
});
