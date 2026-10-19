import { describe, it, expect } from 'vitest';
import { lerpPosition, PositionHistory, followLerp } from './stepInterpolation';

describe('lerpPosition', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 20 };
  it('returns prev at alpha 0, curr at alpha 1 and the midpoint at 0.5', () => {
    expect(lerpPosition(a, b, 0)).toEqual({ x: 0, y: 0 });
    expect(lerpPosition(a, b, 1)).toEqual({ x: 10, y: 20 });
    expect(lerpPosition(a, b, 0.5)).toEqual({ x: 5, y: 10 });
  });
});

describe('PositionHistory', () => {
  it('returns the origin without throwing before any push', () => {
    expect(new PositionHistory().at(0.5)).toEqual({ x: 0, y: 0 });
  });

  it('returns the only position after a single push', () => {
    const h = new PositionHistory();
    h.push({ x: 7, y: 3 });
    expect(h.at(0.5)).toEqual({ x: 7, y: 3 });
  });

  it('interpolates between the last two pushes', () => {
    const h = new PositionHistory();
    h.push({ x: 0, y: 0 });
    h.push({ x: 10, y: 0 });
    expect(h.at(0.5)).toEqual({ x: 5, y: 0 });
  });

  it('snaps to the current position on a jump larger than snapDistance', () => {
    const h = new PositionHistory();
    h.push({ x: 0, y: 0 });
    h.push({ x: 100, y: 0 });
    expect(h.at(0.5)).toEqual({ x: 100, y: 0 });
  });

  it('copies pushed positions (a mutated source does not move the history)', () => {
    const h = new PositionHistory();
    const p = { x: 0, y: 0 };
    h.push(p);
    p.x = 10;
    h.push(p);
    expect(h.at(0)).toEqual({ x: 0, y: 0 });
  });

  it('clamps alpha to [0,1] and treats NaN as the current position', () => {
    const h = new PositionHistory();
    h.push({ x: 0, y: 0 });
    h.push({ x: 10, y: 0 });
    expect(h.at(-1)).toEqual({ x: 0, y: 0 });
    expect(h.at(2)).toEqual({ x: 10, y: 0 });
    expect(h.at(Number.NaN)).toEqual({ x: 10, y: 0 });
  });
});

describe('followLerp', () => {
  it('equals the base lerp at the reference frame time', () => {
    expect(followLerp(0.12, 1000 / 60)).toBeCloseTo(0.12, 10);
  });

  it('compounds over two reference frames', () => {
    expect(followLerp(0.12, 2000 / 60)).toBeCloseTo(1 - 0.88 ** 2, 10);
  });

  it('is 0 for zero or negative delta', () => {
    expect(followLerp(0.12, 0)).toBe(0);
    expect(followLerp(0.12, -5)).toBe(0);
  });

  it('approaches but never exceeds 1 for huge deltas', () => {
    const v = followLerp(0.12, 100000);
    expect(v).toBeLessThanOrEqual(1);
    expect(v).toBeGreaterThanOrEqual(0.99);
  });

  it('never returns NaN for NaN or Infinity deltas', () => {
    expect(followLerp(0.12, Number.NaN)).toBe(0);
    expect(followLerp(0.12, Number.POSITIVE_INFINITY)).toBe(1);
  });
});
