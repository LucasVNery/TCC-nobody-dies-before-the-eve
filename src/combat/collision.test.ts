// src/combat/collision.test.ts
import { describe, it, expect } from 'vitest';
import { aabbOverlap, segmentIntersectsBox } from './collision';

describe('segmentIntersectsBox', () => {
  const box = { x: 100, y: 100, width: 20, height: 20 };

  it('crosses the box', () => {
    expect(segmentIntersectsBox({ x: 90, y: 110 }, { x: 130, y: 110 }, box, 0)).toBe(true);
  });

  it('misses a box off the line', () => {
    expect(segmentIntersectsBox({ x: 0, y: 0 }, { x: 200, y: 0 }, box, 0)).toBe(false);
  });

  it('a segment that stops short does not reach', () => {
    expect(segmentIntersectsBox({ x: 0, y: 110 }, { x: 90, y: 110 }, box, 0)).toBe(false);
  });

  it('the radius inflates the box: a line 5 above passes with radius 8 and misses with radius 4', () => {
    const a = { x: 90, y: 95 };
    const b = { x: 130, y: 95 };
    expect(segmentIntersectsBox(a, b, box, 8)).toBe(true);
    expect(segmentIntersectsBox(a, b, box, 4)).toBe(false);
  });

  it('tangent to the inflated edge counts as a hit', () => {
    expect(segmentIntersectsBox({ x: 90, y: 92 }, { x: 130, y: 92 }, box, 8)).toBe(true);
  });

  it('does not tunnel: endpoints on both sides of a thin box, neither inside it', () => {
    const thin = { x: 100, y: 100, width: 1, height: 20 };
    expect(segmentIntersectsBox({ x: 50, y: 110 }, { x: 150, y: 110 }, thin, 0)).toBe(true);
  });

  it('handles a diagonal segment near the corner', () => {
    expect(segmentIntersectsBox({ x: 80, y: 80 }, { x: 110, y: 110 }, box, 0)).toBe(true);
    expect(segmentIntersectsBox({ x: 80, y: 130 }, { x: 95, y: 140 }, box, 0)).toBe(false);
  });
});

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
