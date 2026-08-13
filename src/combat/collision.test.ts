// src/combat/collision.test.ts
import { describe, it, expect } from 'vitest';
import { aabbOverlap } from './collision';

describe('aabbOverlap', () => {
  it('returns true for overlapping boxes', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('returns false for separated boxes', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 100, y: 100, width: 10, height: 10 };
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('returns false for boxes that only touch edges', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 10, y: 0, width: 10, height: 10 };
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('is symmetric', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    expect(aabbOverlap(a, b)).toBe(aabbOverlap(b, a));
  });
});
