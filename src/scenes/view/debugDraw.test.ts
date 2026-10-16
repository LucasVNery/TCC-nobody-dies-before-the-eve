import { describe, it, expect } from 'vitest';
import { sectorPoints, boxCorners } from './debugDraw';
import { ISO_CONFIG } from '../../visual/placeholderTextures';

describe('debugDraw geometry', () => {
  it('sectorPoints starts at the projected origin and samples the arc', () => {
    const pts = sectorPoints(
      { origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, reach: 64, halfAngleRad: Math.PI / 4 },
      ISO_CONFIG,
      2,
    );
    expect(pts).toHaveLength(4);
    expect(pts[0].x).toBeCloseTo(0, 1);
    expect(pts[0].y).toBeCloseTo(0, 1);
    expect(pts[1].x).toBeCloseTo(45.25, 1);
    expect(pts[1].y).toBeCloseTo(0, 1);
    expect(pts[2].x).toBeCloseTo(32, 1);
    expect(pts[2].y).toBeCloseTo(16, 1);
    expect(pts[3].x).toBeCloseTo(0, 1);
    expect(pts[3].y).toBeCloseTo(22.63, 1);
  });

  it('boxCorners projects the four corners in order', () => {
    const c = boxCorners({ x: 0, y: 0, width: 64, height: 64 }, ISO_CONFIG);
    const expected = [[0, 0], [32, 16], [0, 32], [-32, 16]];
    expect(c).toHaveLength(4);
    expected.forEach(([x, y], i) => {
      expect(c[i].x).toBeCloseTo(x, 1);
      expect(c[i].y).toBeCloseTo(y, 1);
    });
  });
});
