// src/game/items.test.ts
import { describe, it, expect } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { ItemSystem, ITEM } from './items';
import { ARENA_BOUNDS } from '../combat/movementDefs';

const STEP = 16;
const PLAYER = { x: 800, y: 600, width: 20, height: 20 };
const ENEMY = { x: 100, y: 100 };

type Log = Array<{ type: string; payload: Record<string, unknown> }>;

function make(seed = 1) {
  const bus = new EventBus<GameEvents>();
  const log: Log = [];
  for (const t of ['item.spawn', 'item.pickup', 'item.expire', 'item.use'] as const) {
    bus.on(t, (p: unknown) => log.push({ type: t, payload: p as Record<string, unknown> }));
  }
  const items = new ItemSystem(bus);
  items.reset(seed);
  return { items, log };
}

function run(items: ItemSystem, ms: number, player = PLAYER, enemy = ENEMY) {
  for (let t = 0; t < ms; t += STEP) items.step(STEP, player, enemy);
}

const of = (log: Log, type: string) => log.filter((e) => e.type === type);
const onTop = (pos: { x: number; y: number }) => ({ x: pos.x, y: pos.y, width: 20, height: 20 });

describe('ItemSystem spawning', () => {
  it('first item appears at 20 000 ms, not before', () => {
    const { items, log } = make();
    run(items, 19900);
    expect(of(log, 'item.spawn')).toHaveLength(0);
    run(items, 200);
    expect(of(log, 'item.spawn')).toHaveLength(1);
  });

  it('is deterministic by seed (kinds and positions)', () => {
    const a = make(42);
    const b = make(42);
    const c = make(43);
    run(a.items, 60000);
    run(b.items, 60000);
    run(c.items, 60000);
    expect(a.log).toEqual(b.log);
    expect(a.log).not.toEqual(c.log);
  });

  it('never more than 2 on the map; positions respect margin and distances', () => {
    const { items, log } = make(5);
    let max = 0;
    for (let t = 0; t < 200000; t += STEP) {
      items.step(STEP, PLAYER, ENEMY);
      max = Math.max(max, items.onMap.length);
    }
    expect(max).toBeLessThanOrEqual(2);
    expect(of(log, 'item.spawn').length).toBeGreaterThan(2);
    for (const s of of(log, 'item.spawn')) {
      const { x, y } = s.payload as { x: number; y: number };
      expect(x).toBeGreaterThanOrEqual(ITEM.margin - 0.1);
      expect(y).toBeGreaterThanOrEqual(ITEM.margin - 0.1);
      expect(x + ITEM.size).toBeLessThanOrEqual(ARENA_BOUNDS.width - ITEM.margin + 0.1);
      expect(y + ITEM.size).toBeLessThanOrEqual(ARENA_BOUNDS.height - ITEM.margin + 0.1);
      expect(Math.hypot(x - PLAYER.x, y - PLAYER.y)).toBeGreaterThanOrEqual(ITEM.minDistance - 0.1);
      expect(Math.hypot(x - ENEMY.x, y - ENEMY.y)).toBeGreaterThanOrEqual(ITEM.minDistance - 0.1);
    }
  });

  it('a ground item expires at 15 000 ms with reason timeout', () => {
    const { items, log } = make();
    run(items, 20100);
    expect(items.onMap).toHaveLength(1);
    run(items, 14800);
    expect(of(log, 'item.expire')).toHaveLength(0);
    run(items, 400);
    const expires = of(log, 'item.expire');
    expect(expires).toHaveLength(1);
    expect(expires[0].payload.reason).toBe('timeout');
  });
});

describe('ItemSystem PRNG budget', () => {
  it('consumption does not depend on trajectory; a rejected candidate falls through to the next', () => {
    const a = make(77);
    run(a.items, 20100);
    const firstA = a.items.onMap[0];
    // Same seed, but the player stands exactly on candidate 0 at the first beat: it must be rejected.
    const b = make(77);
    run(b.items, 19900, onTop(firstA.pos), ENEMY);
    run(b.items, 200, onTop(firstA.pos), ENEMY);
    const firstB = b.items.onMap[0];
    expect(firstB.kind).toBe(firstA.kind);
    expect(firstB.pos).not.toEqual(firstA.pos);
    expect(Math.hypot(firstB.pos.x - firstA.pos.x, firstB.pos.y - firstA.pos.y)).toBeGreaterThan(0);
    expect(Math.hypot(firstB.pos.x - firstA.pos.x, firstB.pos.y - firstA.pos.y)).toBeGreaterThanOrEqual(ITEM.minDistance);
    // Second beat, both in the same place afterwards: identical kind and position => same draws consumed.
    run(a.items, 20000);
    run(b.items, 20000);
    const secondA = a.log.filter((e) => e.type === 'item.spawn')[1].payload;
    const secondB = b.log.filter((e) => e.type === 'item.spawn')[1].payload;
    expect(secondB).toEqual({ ...secondA, item_id: secondB.item_id });
  });

  it('keeps the drawn candidates pending: a blocked beat does not consume new draws', () => {
    const a = make(5);
    run(a.items, 20100);
    const posA = a.items.onMap[0].pos;
    // Blocked at the beat (player on candidate 0 and enemy on candidate 1 is not needed): free later.
    const b = make(5);
    run(b.items, 25000, onTop(posA), ENEMY); // spawns at 20 s on a later candidate
    expect(b.items.onMap).toHaveLength(1);
    run(a.items, 5000);
    run(a.items, 15000);
    run(b.items, 15000);
    const sa = a.log.filter((e) => e.type === 'item.spawn')[1].payload;
    const sb = b.log.filter((e) => e.type === 'item.spawn')[1].payload;
    expect({ kind: sb.kind, x: sb.x, y: sb.y }).toEqual({ kind: sa.kind, x: sa.x, y: sa.y });
  });

  it('a full map at the beat skips the spawn and the timer wraps; the next beat spawns once a slot is free', () => {
    const { items, log } = make(3);
    run(items, 19900);
    const ground = (items as unknown as { ground: Array<{ id: string; kind: 'heal'; pos: { x: number; y: number }; ageMs: number }> }).ground;
    // Two items already on the map (not reachable by timing alone: lifetime 15 s < beat 20 s).
    ground.push({ id: 'x0', kind: 'heal', pos: { x: 300, y: 300 }, ageMs: 0 }, { id: 'x1', kind: 'heal', pos: { x: 400, y: 300 }, ageMs: 0 });
    run(items, 200);
    expect(log.filter((e) => e.type === 'item.spawn')).toHaveLength(0);
    run(items, 15000); // x0/x1 time out
    expect(items.onMap).toHaveLength(0);
    run(items, 5200); // past the 40 s beat
    expect(log.filter((e) => e.type === 'item.spawn')).toHaveLength(1);
  });
});

describe('ItemSystem pickup', () => {
  it('picking up on overlap with an empty slot emits item.pickup with wait_ms', () => {
    const { items, log } = make();
    run(items, 20100);
    const item = items.onMap[0];
    run(items, 1000); // the item waits ~1 s on the ground
    items.step(STEP, onTop(item.pos), ENEMY);
    const pickups = of(log, 'item.pickup');
    expect(pickups).toHaveLength(1);
    expect(pickups[0].payload.item_id).toBe(item.id);
    expect(pickups[0].payload.wait_ms as number).toBeGreaterThan(1000);
    expect(items.held).toBe(item.kind);
    expect(items.onMap).toHaveLength(0);
  });

  it('with a full slot the item is not picked up and stays until it expires', () => {
    const { items, log } = make(9);
    run(items, 20100);
    items.step(STEP, onTop(items.onMap[0].pos), ENEMY);
    expect(items.held).not.toBeNull();
    run(items, 20000); // second spawn at ~40 000
    const second = items.onMap[0];
    expect(second).toBeDefined();
    items.step(STEP, onTop(second.pos), ENEMY);
    expect(of(log, 'item.pickup')).toHaveLength(1);
    expect(items.onMap.map((i) => i.id)).toContain(second.id);
    run(items, 15200);
    expect(of(log, 'item.expire').filter((e) => e.payload.item_id === second.id)).toHaveLength(1);
  });
});

describe('ItemSystem use', () => {
  function hold(kind: 'heal' | 'power' | 'bomb') {
    for (let seed = 1; seed < 500; seed++) {
      const m = make(seed);
      run(m.items, 20100);
      if (m.items.onMap[0]?.kind !== kind) continue;
      m.items.step(STEP, onTop(m.items.onMap[0].pos), ENEMY);
      return m;
    }
    throw new Error('no seed found');
  }
  const ctx = (hp: number, dist = 500) => ({ playerHp: hp, playerPos: { x: 0, y: 0 }, enemyPos: { x: dist, y: 0 } });

  it('empty slot: use returns null and emits nothing', () => {
    const { items, log } = make();
    expect(items.use(ctx(50))).toBeNull();
    expect(of(log, 'item.use')).toHaveLength(0);
  });

  it('heal: 50 -> 80, 90 -> 100 (capped), 100 -> not effective', () => {
    for (const [hp, after, heal, eff] of [[50, 80, 30, true], [90, 100, 10, true], [100, 100, 0, false]] as const) {
      const { items, log } = hold('heal');
      const r = items.use(ctx(hp))!;
      expect(r.heal).toBe(heal);
      expect(r.effective).toBe(eff);
      const ev = of(log, 'item.use')[0].payload;
      expect(ev.hp).toBe(after);
      expect(ev.effective).toBe(eff);
      expect(items.held).toBeNull();
    }
  });

  it('power: multiplier 1.5 for 8 000 ms, then back to 1', () => {
    const { items } = hold('power');
    expect(items.damageMultiplier).toBe(1);
    items.use(ctx(100));
    expect(items.damageMultiplier).toBe(1.5);
    run(items, 7900);
    expect(items.powerActive).toBe(true);
    run(items, 200);
    expect(items.powerActive).toBe(false);
    expect(items.damageMultiplier).toBe(1);
  });

  it('bomb: hits at 100 u, misses at 130 u', () => {
    expect(hold('bomb').items.use(ctx(100, 100))!.bombHit).toBe(true);
    const miss = hold('bomb');
    expect(miss.items.use(ctx(100, 130))!.bombHit).toBe(false);
    expect(of(miss.log, 'item.use')[0].payload.effective).toBe(false);
  });

  it('item.use carries dist_to_enemy and held_ms (time since pickup)', () => {
    const { items, log } = hold('heal');
    run(items, 500);
    items.use(ctx(50, 130));
    const ev = of(log, 'item.use')[0].payload;
    expect(ev.dist_to_enemy).toBe(130);
    expect(ev.held_ms as number).toBeGreaterThanOrEqual(500);
    expect(ev.held_ms as number).toBeLessThan(560);
  });
});

describe('ItemSystem reset / endRun and conservation', () => {
  it('endRun expires ground items as run_end; reset clears silently', () => {
    const { items, log } = make();
    run(items, 20100);
    const n = log.length;
    items.endRun();
    expect(log.slice(n)).toHaveLength(1);
    expect(log[n].payload.reason).toBe('run_end');
    expect(items.onMap).toHaveLength(0);
    run(items, 20100);
    const m = log.length;
    items.reset(3);
    expect(log).toHaveLength(m);
    expect(items.onMap).toHaveLength(0);
    expect(items.held).toBeNull();
  });

  it('conservation over a simulated run: spawn = pickup + expire', () => {
    const { items, log } = make(11);
    for (let t = 0; t < 130000; t += STEP) {
      const target = items.onMap[0];
      const grab = target && t < 100000 && Math.floor(t / 5000) % 2 === 0 && !items.held;
      items.step(STEP, grab ? onTop(target.pos) : PLAYER, ENEMY);
      if (items.held && t % 3000 < STEP) {
        items.use({ playerHp: 50, playerPos: { x: 0, y: 0 }, enemyPos: { x: 50, y: 0 } });
      }
    }
    items.endRun();
    const spawns = of(log, 'item.spawn').length;
    const pickups = of(log, 'item.pickup').length;
    const expires = of(log, 'item.expire').length;
    expect(spawns).toBeGreaterThan(3);
    expect(pickups).toBeGreaterThan(0);
    expect(expires).toBeGreaterThan(0);
    expect(spawns).toBe(pickups + expires);
  });
});
