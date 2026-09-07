// src/combat/sector.ts
import type { AABB, Vec2 } from './types';

export interface AttackSector {
  origin: Vec2;
  direction: Vec2; // deve chegar normalizado
  reach: number;
  halfAngleRad: number;
}

export function directionalSector(
  origin: Vec2,
  direction: Vec2,
  reach: number,
  halfAngleRad: number,
): AttackSector {
  return { origin, direction, reach, halfAngleRad };
}

export function sectorOverlapsBox(sector: AttackSector, box: AABB): boolean {
  const points: Vec2[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  ];
  return points.some((p) => pointInSector(sector, p));
}

function pointInSector(sector: AttackSector, point: Vec2): boolean {
  const dx = point.x - sector.origin.x;
  const dy = point.y - sector.origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist > sector.reach) return false;
  if (dist === 0) return true;
  const cosAngle = (dx * sector.direction.x + dy * sector.direction.y) / dist;
  return cosAngle >= Math.cos(sector.halfAngleRad);
}
