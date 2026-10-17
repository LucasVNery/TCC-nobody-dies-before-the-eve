import { describe, it, expect } from 'vitest';
import { toScreen, fromScreen, screenDepth, GROUND_PROJECTION } from './groundProjection';

const p = GROUND_PROJECTION;

describe('toScreen', () => {
  it('maps the world origin to the screen origin', () => {
    expect(toScreen({ x: 0, y: 0 }, p)).toEqual({ x: 0, y: 0 });
  });

  it('maps one world tile to one screen tile (64 wide, 48 tall)', () => {
    expect(toScreen({ x: 64, y: 64 }, p)).toEqual({ x: 64, y: 48 });
  });

  it('keeps world x on screen x and foreshortens world y', () => {
    expect(toScreen({ x: 32, y: 64 }, p)).toEqual({ x: 32, y: 48 });
  });
});

describe('fromScreen', () => {
  it.each([
    [0, 0],
    [123.4, -56.7],
    [-640, -480],
    [1600, 1200],
  ])('fromScreen inverts toScreen for (%f, %f)', (x, y) => {
    const back = fromScreen(toScreen({ x, y }, p), p);
    expect(back.x).toBeCloseTo(x, 6);
    expect(back.y).toBeCloseTo(y, 6);
  });
});

describe('screenDepth', () => {
  it('screenDepth grows with y and ignores x', () => {
    expect(screenDepth({ x: 5, y: 7 }, p)).toBe(7);
    expect(screenDepth({ x: 900, y: 7 }, p)).toBe(7);
    expect(screenDepth({ x: 0, y: 8 }, p)).toBeGreaterThan(screenDepth({ x: 0, y: 7 }, p));
  });
});
