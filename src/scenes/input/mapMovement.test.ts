import { describe, it, expect } from 'vitest';
import { mapMovement, mapAim } from './mapMovement';

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
