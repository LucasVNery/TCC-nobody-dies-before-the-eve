// src/combat/projectile.ts
import type { AABB, Vec2 } from './types';
import { segmentIntersectsBox } from './collision';
import { PROJECTILE } from './movementDefs';

export interface ProjectileLaunch {
  origin: Vec2;
  dir: Vec2;
  actionId: string;
}

export interface Projectile {
  id: number;
  pos: Vec2;
  dir: Vec2;
  travelled: number;
}

/**
 * Straight-line projectiles. Each step sweeps the segment from the previous to
 * the new position against the target (inflated by the projectile radius), so
 * no step length can tunnel through it. A projectile that hits is removed and
 * reported once; one that reaches the range expires.
 */
export class ProjectileSystem {
  private projectiles: Projectile[] = [];
  private nextId = 1;

  get active(): readonly Projectile[] {
    return this.projectiles;
  }

  spawn(l: ProjectileLaunch): number {
    const id = this.nextId++;
    this.projectiles.push({
      id,
      pos: { x: l.origin.x, y: l.origin.y },
      dir: { x: l.dir.x, y: l.dir.y },
      travelled: 0,
    });
    return id;
  }

  step(stepMs: number, target: AABB): { hits: number[]; expired: number[] } {
    const hits: number[] = [];
    const expired: number[] = [];
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      const dist = Math.min((PROJECTILE.speed * stepMs) / 1000, PROJECTILE.range - p.travelled);
      const next = { x: p.pos.x + p.dir.x * dist, y: p.pos.y + p.dir.y * dist };
      if (segmentIntersectsBox(p.pos, next, target, PROJECTILE.radius)) {
        hits.push(p.id);
        continue;
      }
      p.pos = next;
      p.travelled += dist;
      if (p.travelled >= PROJECTILE.range) expired.push(p.id);
      else keep.push(p);
    }
    this.projectiles = keep;
    return { hits, expired };
  }

  clear(): void {
    this.projectiles = [];
  }
}
