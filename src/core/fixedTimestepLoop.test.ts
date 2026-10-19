import { describe, it, expect, vi } from 'vitest';
import { createFixedTimestepLoop } from './fixedTimestepLoop';

describe('createFixedTimestepLoop', () => {
  it('does not step when accumulated time is below stepMs', () => {
    const onStep = vi.fn();
    const loop = createFixedTimestepLoop(16, onStep);
    loop.advance(15);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('steps once when accumulated time equals stepMs', () => {
    const onStep = vi.fn();
    const loop = createFixedTimestepLoop(16, onStep);
    loop.advance(16);
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenCalledWith(16);
  });

  it('steps multiple times for a large delta, carrying the remainder', () => {
    const onStep = vi.fn();
    const loop = createFixedTimestepLoop(16, onStep);
    loop.advance(35); // 2 steps (32ms), 3ms leftover
    expect(onStep).toHaveBeenCalledTimes(2);
    loop.advance(13); // accumulator 3 + 13 = 16 -> 1 more step
    expect(onStep).toHaveBeenCalledTimes(3);
  });

  it('exposes alpha as the leftover fraction of a step', () => {
    const onStep = vi.fn();
    const step = 1000 / 60;
    const loop = createFixedTimestepLoop(step, onStep);
    expect(loop.alpha).toBe(0);
    loop.advance(40);
    expect(onStep).toHaveBeenCalledTimes(2);
    expect(loop.alpha).toBeCloseTo((40 - 2 * step) / step, 10);
    expect(loop.alpha).toBeCloseTo(0.4, 10);
  });

  it('keeps alpha in [0,1) across arbitrary deltas', () => {
    const loop = createFixedTimestepLoop(1000 / 60, () => {});
    for (const d of [0, 1, 16.6, 16.7, 33.4, 7, 250, 1000 / 60, 0.0001]) {
      loop.advance(d);
      expect(loop.alpha).toBeGreaterThanOrEqual(0);
      expect(loop.alpha).toBeLessThan(1);
    }
  });

  it('exposes the configured stepMs', () => {
    const loop = createFixedTimestepLoop(16, () => {});
    expect(loop.stepMs).toBe(16);
  });
});
