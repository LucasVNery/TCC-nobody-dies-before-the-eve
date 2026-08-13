import { describe, it, expect } from 'vitest';
import { normalizeVelocity, applyMovement, clampToArena } from './movement';
import type { AABB } from './types';

describe('normalizeVelocity', () => {
  it('returns zero vector for zero input', () => {
    expect(normalizeVelocity(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('returns a unit vector for a cardinal direction', () => {
    const v = normalizeVelocity(1, 0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });

  it('normalizes diagonal input so magnitude is 1, not sqrt(2)', () => {
    const v = normalizeVelocity(1, 1);
    const magnitude = Math.hypot(v.x, v.y);
    expect(magnitude).toBeCloseTo(1);
  });

  it('preserves direction while normalizing', () => {
    const v = normalizeVelocity(2, 0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });
});

describe('applyMovement', () => {
  it('moves position by speed * time in the given direction', () => {
    const result = applyMovement({ x: 0, y: 0 }, { x: 1, y: 0 }, 100, 1000);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(0);
  });

  it('does not move when direction is zero', () => {
    const result = applyMovement({ x: 5, y: 5 }, { x: 0, y: 0 }, 100, 1000);
    expect(result).toEqual({ x: 5, y: 5 });
  });

  it('scales distance with stepMs', () => {
    const result = applyMovement({ x: 0, y: 0 }, { x: 1, y: 0 }, 100, 16);
    expect(result.x).toBeCloseTo(1.6);
  });
});

describe('clampToArena', () => {
  const bounds: AABB = { x: 0, y: 0, width: 100, height: 100 };

  it('leaves position unchanged when inside bounds', () => {
    const result = clampToArena({ x: 50, y: 50 }, 20, 20, bounds);
    expect(result).toEqual({ x: 50, y: 50 });
  });

  it('clamps the left edge', () => {
    const result = clampToArena({ x: -10, y: 50 }, 20, 20, bounds);
    expect(result.x).toBe(0);
  });

  it('clamps the top edge', () => {
    const result = clampToArena({ x: 50, y: -10 }, 20, 20, bounds);
    expect(result.y).toBe(0);
  });

  it('clamps the right edge, accounting for box width', () => {
    const result = clampToArena({ x: 95, y: 50 }, 20, 20, bounds);
    expect(result.x).toBe(80);
  });

  it('clamps the bottom edge, accounting for box height', () => {
    const result = clampToArena({ x: 50, y: 95 }, 20, 20, bounds);
    expect(result.y).toBe(80);
  });
});
