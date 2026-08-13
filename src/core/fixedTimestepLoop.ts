export interface FixedTimestepLoop {
  advance(realDeltaMs: number): void;
  readonly stepMs: number;
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

  return { advance, stepMs };
}
