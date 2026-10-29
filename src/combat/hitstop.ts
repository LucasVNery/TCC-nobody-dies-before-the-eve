// src/combat/hitstop.ts

/** Simulation steps frozen per impact (fixed 16.67 ms steps). */
export const HITSTOP_STEPS = { light: 2, heavy: 4, charged: 5, hurt: 4, parry: 5, perfect: 5 } as const;
/** Free steps (100 ms) that must run after a freeze before another may start. */
export const HITSTOP_COOLDOWN_STEPS = 6;

/**
 * Simulation hit-stop: a short freeze of the whole simulation on impacts.
 * Requests are ignored while a freeze is active or the cooldown after the
 * previous one runs, so overlapping impacts never add up.
 */
export class HitStop {
  private remaining = 0;
  private cooldown = 0;

  get active(): boolean {
    return this.remaining > 0;
  }

  request(steps: number): void {
    if (this.remaining > 0 || this.cooldown > 0 || steps <= 0) return;
    this.remaining = steps;
  }

  /** One frozen step. When the last one is consumed the cooldown starts. */
  consume(): void {
    if (this.remaining <= 0) return;
    this.remaining -= 1;
    if (this.remaining === 0) this.cooldown = HITSTOP_COOLDOWN_STEPS;
  }

  /** One free (simulated) step: counts the cooldown down. */
  tickFree(): void {
    if (this.cooldown > 0) this.cooldown -= 1;
  }

  reset(): void {
    this.remaining = 0;
    this.cooldown = 0;
  }
}
