import { describe, it, expect } from 'vitest';
import { toScreen, screenDepth, type IsoConfig } from './isometricProjection';

const config: IsoConfig = { tileWorldSize: 64, halfWidth: 32, halfHeight: 16 };

describe('toScreen', () => {
  it('maps the world origin to the screen origin', () => {
    expect(toScreen({ x: 0, y: 0 }, config)).toEqual({ x: 0, y: 0 });
  });

  it('maps a point along world +x to the right and down (screen)', () => {
    // col = 64/64 = 1, row = 0 -> screenX = (1-0)*32 = 32, screenY = (1+0)*16 = 16
    expect(toScreen({ x: 64, y: 0 }, config)).toEqual({ x: 32, y: 16 });
  });

  it('maps a point along world +y to the left and down (screen)', () => {
    // col = 0, row = 64/64 = 1 -> screenX = (0-1)*32 = -32, screenY = (0+1)*16 = 16
    expect(toScreen({ x: 0, y: 64 }, config)).toEqual({ x: -32, y: 16 });
  });

  it('maps equal x/y (diagonal) straight down on screen', () => {
    // col = row = 2 -> screenX = 0, screenY = (2+2)*16 = 64
    expect(toScreen({ x: 128, y: 128 }, config)).toEqual({ x: 0, y: 64 });
  });

  it('supports fractional world positions (continuous movement, not grid-locked)', () => {
    // col = 32/64 = 0.5, row = 16/64 = 0.25 -> screenX = (0.5-0.25)*32 = 8, screenY = (0.5+0.25)*16 = 12
    expect(toScreen({ x: 32, y: 16 }, config)).toEqual({ x: 8, y: 12 });
  });
});

describe('screenDepth', () => {
  it('returns 0 at the world origin', () => {
    expect(screenDepth({ x: 0, y: 0 }, config)).toBe(0);
  });

  it('increases as x increases (moving "into" the isometric view)', () => {
    expect(screenDepth({ x: 64, y: 0 }, config)).toBeGreaterThan(screenDepth({ x: 0, y: 0 }, config));
  });

  it('increases as y increases', () => {
    expect(screenDepth({ x: 0, y: 64 }, config)).toBeGreaterThan(screenDepth({ x: 0, y: 0 }, config));
  });

  it('is equal for two points on the same iso diagonal (x+y constant)', () => {
    expect(screenDepth({ x: 64, y: 0 }, config)).toBe(screenDepth({ x: 0, y: 64 }, config));
    expect(screenDepth({ x: 32, y: 32 }, config)).toBe(screenDepth({ x: 64, y: 0 }, config));
  });
});
