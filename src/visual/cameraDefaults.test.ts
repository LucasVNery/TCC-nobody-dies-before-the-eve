import { describe, expect, it } from 'vitest';
import { CAMERA_FOLLOW_LERP, VOID_COLOR, worldCameraBounds } from './cameraDefaults';
import { GROUND_PROJECTION, toScreen } from './groundProjection';

describe('worldCameraBounds', () => {
  const arena = { x: 0, y: 0, width: 1600, height: 1200 };

  it('is the bounding box of the four projected arena corners', () => {
    expect(worldCameraBounds(arena, GROUND_PROJECTION, 0)).toEqual({ x: -600, y: 0, width: 1400, height: 700 });
  });

  it('expands the arena by the margin in world tiles before projecting', () => {
    expect(worldCameraBounds(arena, GROUND_PROJECTION, 2)).toEqual({ x: -728, y: -64, width: 1656, height: 828 });
    expect(worldCameraBounds(arena, GROUND_PROJECTION, 10)).toEqual({ x: -1240, y: -320, width: 2680, height: 1340 });
  });

  it('shifts with an offset arena by the projection of the offset', () => {
    const base = worldCameraBounds(arena, GROUND_PROJECTION, 0);
    const b = worldCameraBounds({ x: 64, y: 64, width: 1600, height: 1200 }, GROUND_PROJECTION, 0);
    const shift = toScreen({ x: 64, y: 64 }, GROUND_PROJECTION);
    expect(shift).toEqual({ x: 0, y: 32 });
    expect(b).toEqual({ x: base.x + shift.x, y: base.y + shift.y, width: base.width, height: base.height });
  });
});

describe('camera constants', () => {
  it('camera constants are sane', () => {
    expect(CAMERA_FOLLOW_LERP).toBeGreaterThan(0);
    expect(CAMERA_FOLLOW_LERP).toBeLessThanOrEqual(1);
    expect(Number.isInteger(VOID_COLOR)).toBe(true);
    expect(VOID_COLOR).toBeGreaterThanOrEqual(0);
    expect(VOID_COLOR).toBeLessThanOrEqual(0xffffff);
  });
});
