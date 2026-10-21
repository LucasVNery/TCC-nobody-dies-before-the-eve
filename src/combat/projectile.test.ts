// src/combat/projectile.test.ts
import { describe, it, expect } from 'vitest';
import { ProjectileSystem } from './projectile';
import { PROJECTILE } from './movementDefs';

const FAR = { x: 5000, y: 5000, width: 20, height: 20 };
const launch = { origin: { x: 0, y: 10 }, dir: { x: 1, y: 0 }, actionId: 'bow.shot' };
const TICK = 1000 / 60;

describe('ProjectileSystem', () => {
  it('travels 500 u/s (8.33 u per tick)', () => {
    const sys = new ProjectileSystem();
    sys.spawn(launch);
    sys.step(TICK, FAR);
    expect(sys.active[0].pos.x).toBeCloseTo(500 / 60, 6);
    expect(sys.active[0].travelled).toBeCloseTo(500 / 60, 6);
  });

  it('expires on accumulating 260 u and then is gone', () => {
    const sys = new ProjectileSystem();
    const id = sys.spawn(launch);
    let expired: number[] = [];
    let ticks = 0;
    while (sys.active.length > 0 && ticks < 100) {
      expired = sys.step(TICK, FAR).expired;
      ticks++;
    }
    expect(expired).toEqual([id]);
    expect(ticks).toBe(32); // 260 / 8.33 = 31.2
    expect(sys.active).toHaveLength(0);
    expect(PROJECTILE.range).toBe(260);
  });

  it('hits once and disappears', () => {
    const sys = new ProjectileSystem();
    const id = sys.spawn(launch);
    const target = { x: 100, y: 0, width: 20, height: 20 };
    const hits: number[] = [];
    for (let i = 0; i < 40; i++) hits.push(...sys.step(TICK, target).hits);
    expect(hits).toEqual([id]);
    expect(sys.active).toHaveLength(0);
  });

  it('does not hit a target off the line', () => {
    const sys = new ProjectileSystem();
    sys.spawn(launch);
    const target = { x: 100, y: 100, width: 20, height: 20 };
    let hit = false;
    for (let i = 0; i < 40; i++) hit = hit || sys.step(TICK, target).hits.length > 0;
    expect(hit).toBe(false);
  });

  it('does not tunnel through a thin target even with one huge step', () => {
    const sys = new ProjectileSystem();
    const id = sys.spawn(launch);
    // a 400 ms step = 200 u in one go, jumping straight over a 1 u wide box
    expect(sys.step(400, { x: 100, y: 0, width: 1, height: 20 }).hits).toEqual([id]);
  });

  it('clear() removes every projectile', () => {
    const sys = new ProjectileSystem();
    sys.spawn(launch);
    sys.spawn(launch);
    sys.clear();
    expect(sys.active).toHaveLength(0);
  });
});
