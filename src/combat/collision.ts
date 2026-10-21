// src/combat/collision.ts
import type { AABB, Vec2 } from './types';

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Swept test: does the segment a→b touch `box` inflated by `radius` on every
 * side? Slab method, boundary inclusive (a tangent graze counts). Used so a
 * fast projectile cannot tunnel through a thin target between two steps.
 */
export function segmentIntersectsBox(a: Vec2, b: Vec2, box: AABB, radius: number): boolean {
  const min = { x: box.x - radius, y: box.y - radius };
  const max = { x: box.x + box.width + radius, y: box.y + box.height + radius };
  let tMin = 0;
  let tMax = 1;
  const axes: Array<['x' | 'y']> = [['x'], ['y']];
  for (const [k] of axes) {
    const d = b[k] - a[k];
    if (d === 0) {
      if (a[k] < min[k] || a[k] > max[k]) return false;
    } else {
      let t1 = (min[k] - a[k]) / d;
      let t2 = (max[k] - a[k]) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
  }
  return true;
}
