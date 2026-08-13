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

  it('exposes the configured stepMs', () => {
    const loop = createFixedTimestepLoop(16, () => {});
    expect(loop.stepMs).toBe(16);
  });
});
