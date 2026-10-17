import { describe, expect, it } from 'vitest';
import { CAMERA_FOLLOW_LERP, VOID_COLOR, worldCameraBounds } from './cameraDefaults';
import { GROUND_PROJECTION } from './groundProjection';

describe('worldCameraBounds', () => {
  const arena = { x: 0, y: 0, width: 1600, height: 1200 };

  it('expands the projected arena by the margin in tiles', () => {
    expect(worldCameraBounds(arena, GROUND_PROJECTION, 2)).toEqual({ x: -128, y: -96, width: 1856, height: 1092 });
    expect(worldCameraBounds(arena, GROUND_PROJECTION, 10)).toEqual({ x: -640, y: -480, width: 2880, height: 1860 });
  });

  it('shifts with an offset arena', () => {
    const b = worldCameraBounds({ x: 64, y: 64, width: 1600, height: 1200 }, GROUND_PROJECTION, 2);
    expect(b).toEqual({ x: -64, y: -48, width: 1856, height: 1092 });
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
