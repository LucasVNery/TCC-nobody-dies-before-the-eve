import { describe, it, expect } from 'vitest';
import { mapMovement, mapAim, aimOrigin } from './mapMovement';
import { toScreen, GROUND_PROJECTION } from '../../visual/groundProjection';

describe('mapMovement', () => {
  it.each([
    [1, 0, 1, -1],
    [0, -1, -1, -1],
    [-1, 0, -1, 1],
    [0, 1, 1, 1],
    [1, 1, 2, 0],
    [0, 0, 0, 0],
  ])('(%i,%i) -> {dx:%i, dy:%i}', (ix, iy, dx, dy) => {
    const m = mapMovement(ix, iy);
    expect(m.dx).toBe(dx);
    expect(m.dy).toBe(dy);
  });

  it('D (1,0) moves the player straight right on screen', () => {
    const m = mapMovement(1, 0);
    const s = toScreen({ x: m.dx, y: m.dy }, GROUND_PROJECTION);
    expect(s.x).toBeGreaterThan(0);
    expect(s.y).toBeCloseTo(0, 9);
  });

  it('W (0,-1) moves the player straight up on screen', () => {
    const m = mapMovement(0, -1);
    const s = toScreen({ x: m.dx, y: m.dy }, GROUND_PROJECTION);
    expect(s.x).toBeCloseTo(0, 9);
    expect(s.y).toBeLessThan(0);
  });
});

describe('mapAim', () => {
  const player = { x: 40, y: 70 };

  it('pointer at the projection of world +x one tile gives {64, 0}', () => {
    const o = aimOrigin(player);
    const d = toScreen({ x: 64, y: 0 }, GROUND_PROJECTION);
    const v = mapAim({ x: o.x + d.x, y: o.y + d.y }, o);
    expect(v.x).toBeCloseTo(64, 6);
    expect(v.y).toBeCloseTo(0, 6);
  });

  it('pointer at the projection of world +y one tile gives {0, 64}', () => {
    const o = aimOrigin(player);
    const d = toScreen({ x: 0, y: 64 }, GROUND_PROJECTION);
    const v = mapAim({ x: o.x + d.x, y: o.y + d.y }, o);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(64, 6);
  });

  it('pointer over the player gives a null vector', () => {
    const o = aimOrigin(player);
    const v = mapAim(o, o);
    expect(Math.abs(v.x)).toBe(0);
    expect(Math.abs(v.y)).toBe(0);
  });
});

describe('aimOrigin', () => {
  it('is the screen projection of the hurtbox centre', () => {
    expect(aimOrigin({ x: 100, y: 100 })).toEqual(toScreen({ x: 110, y: 110 }, GROUND_PROJECTION));
    expect(aimOrigin({ x: 0, y: 0 })).toEqual(toScreen({ x: 10, y: 10 }, GROUND_PROJECTION));
  });
});
