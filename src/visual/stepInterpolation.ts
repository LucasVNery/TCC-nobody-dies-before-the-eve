import type { Vec2 } from '../combat/types';

/** Presentation-only interpolation between fixed simulation steps. Logic never reads these values. */

export function lerpPosition(prev: Vec2, curr: Vec2, alpha: number): Vec2 {
  return { x: prev.x + (curr.x - prev.x) * alpha, y: prev.y + (curr.y - prev.y) * alpha };
}

/**
 * Last two step positions of one entity. `at(alpha)` draws between them; a jump
 * longer than `snapDistance` (respawn, new run) is shown at once instead of sliding.
 */
export class PositionHistory {
  private prev: Vec2 | null = null;
  private curr: Vec2 | null = null;

  constructor(private readonly snapDistance = 64) {}

  push(pos: Vec2): void {
    this.prev = this.curr;
    this.curr = { x: pos.x, y: pos.y };
  }

  at(alpha: number): Vec2 {
    const curr = this.curr;
    if (!curr) return { x: 0, y: 0 };
    const prev = this.prev;
    if (!prev || Number.isNaN(alpha)) return { x: curr.x, y: curr.y };
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > this.snapDistance) return { x: curr.x, y: curr.y };
    return lerpPosition(prev, curr, Math.min(1, Math.max(0, alpha)));
  }
}

/**
 * Per-frame follow factor that converges at the same rate per second whatever the
 * frame time: `base` is the factor for one `referenceMs` frame. Clamped to [0,1].
 */
export function followLerp(base: number, deltaMs: number, referenceMs = 1000 / 60): number {
  if (!(deltaMs > 0)) return 0;
  const v = 1 - Math.pow(1 - base, deltaMs / referenceMs);
  return Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v));
}
