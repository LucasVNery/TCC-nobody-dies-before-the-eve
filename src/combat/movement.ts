import type { AABB, Vec2 } from './types';

export function normalizeVelocity(dx: number, dy: number): Vec2 {
  if (dx === 0 && dy === 0) return { x: 0, y: 0 };
  const length = Math.hypot(dx, dy);
  return { x: dx / length, y: dy / length };
}

export function applyMovement(
  position: Vec2,
  direction: Vec2,
  speedPxPerSec: number,
  stepMs: number,
): Vec2 {
  const distance = speedPxPerSec * (stepMs / 1000);
  return { x: position.x + direction.x * distance, y: position.y + direction.y * distance };
}

export function clampToArena(position: Vec2, width: number, height: number, bounds: AABB): Vec2 {
  const minX = bounds.x;
  const minY = bounds.y;
  const maxX = bounds.x + bounds.width - width;
  const maxY = bounds.y + bounds.height - height;
  return {
    x: Math.min(Math.max(position.x, minX), maxX),
    y: Math.min(Math.max(position.y, minY), maxY),
  };
}

export function directionalHitbox(
  position: Vec2,
  width: number,
  height: number,
  direction: Vec2,
  reach: number,
): AABB {
  if (Math.abs(direction.x) >= Math.abs(direction.y)) {
    const x = direction.x < 0 ? position.x - reach : position.x + width;
    return { x, y: position.y, width: reach, height };
  }
  const y = direction.y < 0 ? position.y - reach : position.y + height;
  return { x: position.x, y, width, height: reach };
}
