export interface FixedTimestepLoop {
  advance(realDeltaMs: number): void;
  readonly stepMs: number;
  /** Leftover fraction of a step after the last advance, in [0,1): how far presentation is past the last step. */
  readonly alpha: number;
}

export function createFixedTimestepLoop(
  stepMs: number,
  onStep: (stepMs: number) => void,
): FixedTimestepLoop {
  let accumulator = 0;

  function advance(realDeltaMs: number): void {
    accumulator += realDeltaMs;
    while (accumulator >= stepMs) {
      onStep(stepMs);
      accumulator -= stepMs;
    }
  }

  return {
    advance,
    stepMs,
    get alpha(): number {
      return Math.max(0, accumulator / stepMs);
    },
  };
}
