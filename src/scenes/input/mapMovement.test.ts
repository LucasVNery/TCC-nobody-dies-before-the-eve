import { describe, it, expect } from 'vitest';
import { mapMovement, mapAim } from './mapMovement';
import { ISO_CONFIG } from '../../visual/placeholderTextures';

describe('mapMovement', () => {
  it.each([
    [1, 0, 1, -1],
    [0, -1, -1, -1],
    [-1, 0, -1, 1],
    [0, 1, 1, 1],
    [1, 1, 2, 0],
    [0, 0, 0, 0],
  ])('(%i,%i) -> {dx:%i, dy:%i}', (ix, iy, dx, dy) => {
    expect(mapMovement(ix, iy)).toEqual({ dx, dy });
  });
});

describe('mapAim', () => {
  it('pointer over the player gives a null vector', () => {
    const v = mapAim({ x: 50, y: 70 }, { x: 50, y: 70 });
    expect(Math.abs(v.x)).toBe(0);
    expect(Math.abs(v.y)).toBe(0);
  });
  it('pointer to the right on the diamond gives positive x', () => {
    expect(mapAim({ x: 100 + ISO_CONFIG.halfWidth, y: 70 }, { x: 100, y: 70 }).x).toBeGreaterThan(0);
  });
});
