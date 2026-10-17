import { describe, it, expect } from 'vitest';
import { mapMovement, mapAim, aimOrigin } from './mapMovement';

describe('mapMovement', () => {
  it.each([
    [1, 0, 1, 0],
    [-1, 0, -1, 0],
    [0, -1, 0, -1],
    [0, 1, 0, 1],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
  ])('(%i,%i) -> {dx:%i, dy:%i}', (ix, iy, dx, dy) => {
    expect(mapMovement(ix, iy)).toEqual({ dx, dy });
  });
});

describe('mapAim', () => {
  const playerScreen = { x: 100, y: 70 };

  it('pointer one screen tile to the right gives one world tile along +x', () => {
    const v = mapAim({ x: playerScreen.x + 64, y: playerScreen.y }, playerScreen);
    expect(v.x).toBeCloseTo(64, 6);
    expect(v.y).toBeCloseTo(0, 6);
  });

  it('pointer one screen tile below gives one world tile along +y', () => {
    const v = mapAim({ x: playerScreen.x, y: playerScreen.y + 48 }, playerScreen);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(64, 6);
  });

  it('pointer over the player gives a null vector', () => {
    const v = mapAim(playerScreen, playerScreen);
    expect(Math.abs(v.x)).toBe(0);
    expect(Math.abs(v.y)).toBe(0);
  });

  it('pointer to the left gives negative x', () => {
    expect(mapAim({ x: playerScreen.x - 30, y: playerScreen.y }, playerScreen).x).toBeLessThan(0);
  });

  it('pointer above gives negative y', () => {
    expect(mapAim({ x: playerScreen.x, y: playerScreen.y - 30 }, playerScreen).y).toBeLessThan(0);
  });
});

describe('aimOrigin', () => {
  it('is the screen projection of the hurtbox centre', () => {
    expect(aimOrigin({ x: 100, y: 100 })).toEqual({ x: 110, y: 82.5 });
    expect(aimOrigin({ x: 0, y: 0 })).toEqual({ x: 10, y: 7.5 });
  });

  it('gives a zero-length-offset aim when the pointer sits on it, and +x for a pointer 64px right', () => {
    const o = aimOrigin({ x: 40, y: 70 });
    expect(mapAim({ x: o.x + 64, y: o.y }, o)).toEqual({ x: 64, y: 0 });
  });
});
