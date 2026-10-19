import { describe, it, expect } from 'vitest';
import { sectorPoints, boxCorners, rangeEllipseSize } from './debugDraw';
import { GROUND_PROJECTION, toScreen } from '../../visual/groundProjection';

describe('debugDraw geometry', () => {
  it('sectorPoints starts at the projected origin and samples the arc', () => {
    const pts = sectorPoints(
      { origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, reach: 64, halfAngleRad: Math.PI / 4 },
      GROUND_PROJECTION,
      2,
    );
    const worldExpected = [[0, 0], [45.25, -45.25], [64, 0], [45.25, 45.25]];
    expect(pts).toHaveLength(4);
    worldExpected.forEach(([x, y], i) => {
      const s = toScreen({ x, y }, GROUND_PROJECTION);
      expect(pts[i].x).toBeCloseTo(s.x, 1);
      expect(pts[i].y).toBeCloseTo(s.y, 1);
    });
    // Explicit projected numbers, independent of toScreen.
    const projected = [[0, 0], [45.25, 0], [32, 16], [0, 22.63]];
    projected.forEach(([x, y], i) => {
      expect(pts[i].x).toBeCloseTo(x, 1);
      expect(pts[i].y).toBeCloseTo(y, 1);
    });
  });

  it('boxCorners projects the four corners as a diamond, in order', () => {
    const c = boxCorners({ x: 0, y: 0, width: 64, height: 64 }, GROUND_PROJECTION);
    const expected = [[0, 0], [32, 16], [0, 32], [-32, 16]];
    expect(c).toHaveLength(4);
    expected.forEach(([x, y], i) => {
      expect(c[i].x).toBeCloseTo(x, 1);
      expect(c[i].y).toBeCloseTo(y, 1);
    });
  });

  it('rangeEllipseSize is the exact projection of a world circle of radius R', () => {
    const s = rangeEllipseSize(60, GROUND_PROJECTION);
    expect(s.width).toBeCloseTo(84.85, 2);
    expect(s.height).toBeCloseTo(42.43, 2);
  });
});
