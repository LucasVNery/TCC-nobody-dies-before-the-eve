import { describe, it, expect } from 'vitest';
import { sectorPoints, boxCorners, rangeEllipseSize } from './debugDraw';
import { GROUND_PROJECTION } from '../../visual/groundProjection';

describe('debugDraw geometry', () => {
  it('sectorPoints starts at the projected origin and samples the arc', () => {
    const pts = sectorPoints(
      { origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, reach: 64, halfAngleRad: Math.PI / 4 },
      GROUND_PROJECTION,
      2,
    );
    const expected = [[0, 0], [45.25, -33.94], [64, 0], [45.25, 33.94]];
    expect(pts).toHaveLength(4);
    expected.forEach(([x, y], i) => {
      expect(pts[i].x).toBeCloseTo(x, 1);
      expect(pts[i].y).toBeCloseTo(y, 1);
    });
  });

  it('boxCorners projects the four corners in order', () => {
    const c = boxCorners({ x: 0, y: 0, width: 64, height: 64 }, GROUND_PROJECTION);
    const expected = [[0, 0], [64, 0], [64, 48], [0, 48]];
    expect(c).toHaveLength(4);
    expected.forEach(([x, y], i) => {
      expect(c[i].x).toBeCloseTo(x, 1);
      expect(c[i].y).toBeCloseTo(y, 1);
    });
  });

  it('rangeEllipseSize foreshortens the vertical axis by the projection', () => {
    expect(rangeEllipseSize(60, GROUND_PROJECTION)).toEqual({ width: 120, height: 90 });
  });
});
