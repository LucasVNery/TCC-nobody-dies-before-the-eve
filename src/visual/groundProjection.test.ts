import { describe, it, expect } from 'vitest';
import { toScreen, fromScreen, screenDepth, GROUND_PROJECTION } from './groundProjection';

const p = GROUND_PROJECTION;

describe('GROUND_PROJECTION', () => {
  it('is a 2:1 diamond: 64-unit world tiles draw as 64x32', () => {
    expect(p).toEqual({ tileWorldSize: 64, tileScreenWidth: 64, tileScreenHeight: 32 });
  });
});

describe('toScreen', () => {
  it('maps the world origin to the screen origin', () => {
    expect(toScreen({ x: 0, y: 0 }, p)).toEqual({ x: 0, y: 0 });
  });

  it('maps world +x one tile to the right diamond vertex (32,16)', () => {
    expect(toScreen({ x: 64, y: 0 }, p)).toEqual({ x: 32, y: 16 });
  });

  it('maps world +y one tile to the left diamond vertex (-32,16)', () => {
    expect(toScreen({ x: 0, y: 64 }, p)).toEqual({ x: -32, y: 16 });
  });

  it('maps the far tile corner to the bottom diamond vertex (0,32)', () => {
    expect(toScreen({ x: 64, y: 64 }, p)).toEqual({ x: 0, y: 32 });
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
  it('screenDepth is x + y and grows with it', () => {
    expect(screenDepth({ x: 5, y: 7 }, p)).toBe(12);
    expect(screenDepth({ x: 6, y: 7 }, p)).toBeGreaterThan(screenDepth({ x: 5, y: 7 }, p));
    expect(screenDepth({ x: 5, y: 8 }, p)).toBeGreaterThan(screenDepth({ x: 5, y: 7 }, p));
  });
});
