import { describe, expect, it } from 'vitest';
import {
  FLOOR_TILESET,
  SKIRT_TILES,
  composeFloor,
  composeFloorWithSkirt,
  type TileSet,
} from './composeFloor';

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const INTERIOR_IDS = FLOOR_TILESET.interior.map((t) => t.id);
const NON_REPEATABLE = new Set(FLOOR_TILESET.interior.filter((t) => !t.repeatable).map((t) => t.id));

describe('composeFloor', () => {
  it('is deterministic and differs between seeds', () => {
    expect(composeFloor(7, 25, 19, FLOOR_TILESET)).toEqual(composeFloor(7, 25, 19, FLOOR_TILESET));
    const grids = [1, 2, 3, 4, 5].map((s) => JSON.stringify(composeFloor(s, 25, 19, FLOOR_TILESET)));
    for (let i = 0; i < grids.length; i++) {
      for (let j = i + 1; j < grids.length; j++) expect(grids[i]).not.toBe(grids[j]);
    }
  });

  it('has linhas x colunas dimensions', () => {
    for (const [c, l] of [[25, 19], [40, 30]]) {
      const g = composeFloor(3, c, l, FLOOR_TILESET);
      expect(g).toHaveLength(l);
      for (const row of g) expect(row).toHaveLength(c);
    }
  });

  it('puts only border tiles on the frame and never inside', () => {
    const c = 25;
    const l = 19;
    const g = composeFloor(9, c, l, FLOOR_TILESET);
    for (let r = 0; r < l; r++) {
      for (let k = 0; k < c; k++) {
        const onFrame = r === 0 || k === 0 || r === l - 1 || k === c - 1;
        expect(FLOOR_TILESET.border.includes(g[r][k])).toBe(onFrame);
      }
    }
  });

  it('never repeats a non-repeatable id next to its left or top neighbour', () => {
    for (const seed of range(1, 50)) {
      const g = composeFloor(seed, 25, 19, FLOOR_TILESET);
      for (let r = 1; r < 18; r++) {
        for (let k = 1; k < 24; k++) {
          const id = g[r][k];
          if (!NON_REPEATABLE.has(id)) continue;
          expect(g[r][k - 1]).not.toBe(id);
          expect(g[r - 1][k]).not.toBe(id);
        }
      }
    }
  });

  it('allows floor_base beside floor_base and uses all interior ids across seeds', () => {
    const seen = new Set<string>();
    let baseBeside = false;
    for (const seed of range(1, 50)) {
      const g = composeFloor(seed, 25, 19, FLOOR_TILESET);
      for (let r = 1; r < 18; r++) {
        for (let k = 1; k < 24; k++) {
          seen.add(g[r][k]);
          if (g[r][k] === 'floor_base' && g[r][k - 1] === 'floor_base') baseBeside = true;
        }
      }
    }
    expect(baseBeside).toBe(true);
    for (const id of INTERIOR_IDS) expect(seen.has(id)).toBe(true);
  });

  it('keeps border positions when the tileset changes', () => {
    const other: TileSet = {
      border: ['wall'],
      interior: [{ id: 'q', weight: 1, repeatable: true }],
    };
    const a = composeFloor(4, 12, 9, FLOOR_TILESET);
    const b = composeFloor(4, 12, 9, other);
    for (let r = 0; r < 9; r++) {
      for (let k = 0; k < 12; k++) {
        expect(FLOOR_TILESET.border.includes(a[r][k])).toBe(other.border.includes(b[r][k]));
      }
    }
  });

  it('does not throw with a single non-repeatable interior tile', () => {
    const only: TileSet = {
      border: ['b'],
      interior: [{ id: 'x', weight: 1, repeatable: false }],
    };
    const g = composeFloor(2, 5, 5, only);
    for (let r = 1; r < 4; r++) for (let k = 1; k < 4; k++) expect(g[r][k]).toBe('x');
  });

  it('rejects invalid dimensions', () => {
    for (const bad of [2, 0, -1, 2.5, NaN]) {
      expect(() => composeFloor(1, bad, 5, FLOOR_TILESET)).toThrow(/dimens/);
      expect(() => composeFloor(1, 5, bad, FLOOR_TILESET)).toThrow(/dimens/);
    }
  });

  it('rejects empty border or interior', () => {
    expect(() => composeFloor(1, 5, 5, { border: [], interior: FLOOR_TILESET.interior })).toThrow(/empty/);
    expect(() => composeFloor(1, 5, 5, { border: ['e'], interior: [] })).toThrow(/empty/);
  });

  it('rejects non-positive or non-finite weights', () => {
    for (const w of [0, -1, NaN]) {
      const ts: TileSet = { border: ['e'], interior: [{ id: 'a', weight: w, repeatable: true }] };
      expect(() => composeFloor(1, 5, 5, ts)).toThrow(/weight/);
    }
  });

  it('rejects duplicate ids across border/interior or within interior', () => {
    expect(() =>
      composeFloor(1, 5, 5, { border: ['a'], interior: [{ id: 'a', weight: 1, repeatable: true }] }),
    ).toThrow(/duplicate/);
    expect(() =>
      composeFloor(1, 5, 5, {
        border: ['e'],
        interior: [
          { id: 'a', weight: 1, repeatable: true },
          { id: 'a', weight: 2, repeatable: false },
        ],
      }),
    ).toThrow(/duplicate/);
  });

  it('matches the frozen golden matrix', () => {
    // Golden: changing this changes the arenas of old logs. Do not edit casually.
    expect(composeFloor(1, 5, 4, FLOOR_TILESET)).toEqual(GOLDEN);
  });
});

const GOLDEN: string[][] = [
  ['floor_edge', 'floor_edge', 'floor_edge', 'floor_edge', 'floor_edge'],
  ['floor_edge', 'floor_a', 'floor_b', 'floor_base', 'floor_edge'],
  ['floor_edge', 'floor_base', 'floor_base', 'floor_base', 'floor_edge'],
  ['floor_edge', 'floor_edge', 'floor_edge', 'floor_edge', 'floor_edge'],
];

describe('composeFloorWithSkirt', () => {
  it('has the expanded size and playable rectangle', () => {
    const f = composeFloorWithSkirt(5, 25, 19, SKIRT_TILES, FLOOR_TILESET);
    expect(f.tiles).toHaveLength(19 + 2 * SKIRT_TILES);
    for (const row of f.tiles) expect(row).toHaveLength(25 + 2 * SKIRT_TILES);
    expect(f.playable).toEqual({ col0: 10, row0: 10, cols: 25, rows: 19 });
  });

  it('keeps the playable crop identical to composeFloor', () => {
    const f = composeFloorWithSkirt(5, 25, 19, SKIRT_TILES, FLOOR_TILESET);
    const crop = f.tiles
      .slice(f.playable.row0, f.playable.row0 + f.playable.rows)
      .map((row) => row.slice(f.playable.col0, f.playable.col0 + f.playable.cols));
    expect(crop).toEqual(composeFloor(5, 25, 19, FLOOR_TILESET));
  });

  it('is deterministic and has no floor_edge in the ring', () => {
    const a = composeFloorWithSkirt(8, 25, 19, SKIRT_TILES, FLOOR_TILESET);
    expect(a).toEqual(composeFloorWithSkirt(8, 25, 19, SKIRT_TILES, FLOOR_TILESET));
    const p = a.playable;
    for (let r = 0; r < a.tiles.length; r++) {
      for (let k = 0; k < a.tiles[r].length; k++) {
        const inside = r >= p.row0 && r < p.row0 + p.rows && k >= p.col0 && k < p.col0 + p.cols;
        if (!inside) expect(a.tiles[r][k]).not.toBe('floor_edge');
      }
    }
  });

  it('with skirt 0 equals composeFloor', () => {
    const f = composeFloorWithSkirt(6, 25, 19, 0, FLOOR_TILESET);
    expect(f.tiles).toEqual(composeFloor(6, 25, 19, FLOOR_TILESET));
    expect(f.playable).toEqual({ col0: 0, row0: 0, cols: 25, rows: 19 });
  });

  it('rejects negative or fractional skirt', () => {
    expect(() => composeFloorWithSkirt(1, 25, 19, -1, FLOOR_TILESET)).toThrow(/skirt/);
    expect(() => composeFloorWithSkirt(1, 25, 19, 1.5, FLOOR_TILESET)).toThrow(/skirt/);
  });
});
