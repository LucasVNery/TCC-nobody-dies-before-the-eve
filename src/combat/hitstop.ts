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
  /** Armed this step: no frozen step consumed yet, so a larger simultaneous request may still raise it. */
  private fresh = false;

  get active(): boolean {
    return this.remaining > 0;
  }

  request(steps: number): void {
    if (steps <= 0 || this.cooldown > 0) return;
    if (this.remaining > 0) {
      // Simultaneous impacts in the same step take the largest; a running freeze is never extended.
      if (this.fresh && steps > this.remaining) this.remaining = steps;
      return;
    }
    this.remaining = steps;
    this.fresh = true;
  }

  /** One frozen step. When the last one is consumed the cooldown starts. */
  consume(): void {
    if (this.remaining <= 0) return;
    this.remaining -= 1;
    this.fresh = false;
    if (this.remaining === 0) this.cooldown = HITSTOP_COOLDOWN_STEPS;
  }

  /** One free (simulated) step: counts the cooldown down. */
  tickFree(): void {
    if (this.cooldown > 0) this.cooldown -= 1;
  }

  reset(): void {
    this.remaining = 0;
    this.cooldown = 0;
    this.fresh = false;
  }
}
