import { describe, it, expect } from 'vitest';
import { floorTileGrid } from './floorTileGrid';
import { skirtTint } from './skirtTint';
import { FLOOR_TILE_IDS } from './floorAssets';
import type { FloorLayout } from './composeFloor';

function layout(rows: number, cols: number, skirt: number, id = 'floor_base'): FloorLayout {
  const tiles = Array.from({ length: rows + 2 * skirt }, () => Array.from({ length: cols + 2 * skirt }, () => id));
  return { tiles, playable: { col0: skirt, row0: skirt, cols, rows } };
}

describe('floorTileGrid', () => {
  it('maps every cell of a 3x3 layout with skirt 0 to the index of its id in tileIds', () => {
    const l = layout(3, 3, 0);
    l.tiles[0][1] = 'floor_a';
    l.tiles[1][2] = 'floor_worn';
    l.tiles[2][0] = 'floor_edge';
    const { indices } = floorTileGrid(l, FLOOR_TILE_IDS);
    expect(indices).toEqual([
      [0, 1, 0],
      [0, 0, 3],
      [4, 0, 0],
    ]);
  });

  it('follows the order of the given tileIds, not a fixed one', () => {
    const l = layout(3, 3, 0);
    l.tiles[1][1] = 'floor_b';
    const { indices } = floorTileGrid(l, ['floor_b', 'floor_base']);
    expect(indices[1][1]).toBe(0);
    expect(indices[0][0]).toBe(1);
  });

  it('with skirt 2, tintFor is null inside the playable rectangle and skirtTint of the Chebyshev distance outside', () => {
    const { tintFor } = floorTileGrid(layout(3, 3, 2), FLOOR_TILE_IDS);
    for (let r = 2; r <= 4; r++) for (let c = 2; c <= 4; c++) expect(tintFor(r, c), `(${r},${c})`).toBeNull();
    expect(tintFor(0, 0)).toBe(skirtTint(2, 2));
    expect(tintFor(6, 6)).toBe(skirtTint(2, 2));
    expect(tintFor(0, 6)).toBe(skirtTint(2, 2));
    expect(tintFor(6, 1)).toBe(skirtTint(2, 2));
    expect(tintFor(1, 3)).toBe(skirtTint(1, 2));
    expect(tintFor(3, 1)).toBe(skirtTint(1, 2));
    expect(tintFor(1, 1)).toBe(skirtTint(1, 2));
    expect(tintFor(5, 4)).toBe(skirtTint(1, 2));
  });

  it('an unknown id throws naming the id', () => {
    const l = layout(3, 3, 0);
    l.tiles[1][1] = 'floor_lava';
    expect(() => floorTileGrid(l, FLOOR_TILE_IDS)).toThrow(/floor_lava/);
  });

  it('tint is never NaN, for any cell of layouts with and without skirt', () => {
    for (const [rows, cols, skirt] of [[3, 3, 0], [3, 4, 1], [19, 25, 10]] as const) {
      const l = layout(rows, cols, skirt);
      const { tintFor } = floorTileGrid(l, FLOOR_TILE_IDS);
      for (let r = 0; r < l.tiles.length; r++) {
        for (let c = 0; c < l.tiles[0].length; c++) {
          const t = tintFor(r, c);
          if (t !== null) {
            expect(Number.isNaN(t)).toBe(false);
            expect(Number.isInteger(t)).toBe(true);
            expect(t).toBeGreaterThanOrEqual(0);
            expect(t).toBeLessThanOrEqual(0xffffff);
          }
        }
      }
    }
  });
});
