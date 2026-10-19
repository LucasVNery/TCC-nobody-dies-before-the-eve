import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FLOOR_TILESET } from './composeFloor';
import { FLOOR_TILE_IDS, FLOOR_TILE_KEYS, FLOOR_TILE_URLS, loadFloorTiles } from './floorAssets';
import { readPngRgba } from './testing/readPng';

const TILE_W = 128;
const TILE_H = 64;

const TRANSPARENT_POINTS: [number, number][] = [[0, 0], [127, 0], [0, 63], [127, 63]];
const OPAQUE_POINTS: [number, number][] = [
  [64, 2], [64, 61], [4, 32], [123, 32], [64, 32],
  [32, 16], [96, 16], [32, 48], [96, 48],
  // mirrors of the probes above (pixel x ↔ 127 − x, y ↔ 63 − y): the bleed holds on all four edges
  [31, 48], [95, 48], [31, 15], [96, 15],
];

// Lattice composition: 6x6 cells at native resolution over a contrast colour.
const LATTICE_W = 640;
const LATTICE_H = 320;
const LATTICE_N = 6;
// The lattice is composited over two different backgrounds; a pixel inside a cell is covered
// only if both composites agree exactly (no background shows through, not even partially).
const BACKGROUNDS = [[255, 0, 255], [0, 255, 0]];

// Edge similarity along the shared diagonals.
const EDGE_INSET = 3; // px inside the diagonal (vertically)
const EDGE_TIP_SKIP = 4; // px skipped near the clipped tips

const MEAN_LUMA_MIN = 40;
const MEAN_LUMA_MAX = 140;
const MEAN_LUMA_SPREAD_MAX = 30;
const BRIGHT_LUMA = 200;
const BRIGHT_FRACTION_MAX = 0.05;
const EDGE_DIFF_MAX = 25;

function publicPath(url: string): string {
  return fileURLToPath(new URL(`../../../public${url}`, import.meta.url));
}

function luma(data: Uint8Array, i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

function loadTile(id: string) {
  return readPngRgba(publicPath(FLOOR_TILE_URLS[id]));
}

type Png = ReturnType<typeof loadTile>;

function alpha(png: Png, x: number, y: number): number {
  return png.data[(y * png.width + x) * 4 + 3];
}

/** Luminance of an opaque pixel, or null when the pixel is outside the image or not opaque. */
function sample(png: Png, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return null;
  const i = (y * png.width + x) * 4;
  return png.data[i + 3] === 255 ? luma(png.data, i) : null;
}

/** Top-left pixel of cell (c, r) on the lattice canvas: ((c − r)·64 + 320 − 64, (c + r)·32). */
function cellOrigin(c: number, r: number): [number, number] {
  return [(c - r) * (TILE_W / 2) + LATTICE_W / 2 - TILE_W / 2, (c + r) * (TILE_H / 2)];
}

type Pick = (c: number, r: number) => number;
type Offset = (c: number, r: number) => [number, number];

/** True when the pixel centre (x + 0.5, y + 0.5) lies inside the exact cell diamond |dx|/64 + |dy|/32 <= 1. */
function inExactDiamond(x: number, y: number, scale = 1): boolean {
  const dx = Math.abs(x + 0.5 - TILE_W / 2);
  const dy = Math.abs(y + 0.5 - TILE_H / 2);
  return dx / (TILE_W / 2) + dy / (TILE_H / 2) <= scale;
}

let EXACT_DIAMOND_PIXELS = 0;
for (let y = 0; y < TILE_H; y++) for (let x = 0; x < TILE_W; x++) if (inExactDiamond(x, y)) EXACT_DIAMOND_PIXELS++;

/** Composite a LATTICE_N x LATTICE_N lattice over `bg` in the game's painter's order (diagonal c + r). */
function compositeLattice(pngs: Png[], pick: Pick, bg: number[], offset: Offset): Float64Array {
  const canvas = new Float64Array(LATTICE_W * LATTICE_H * 3);
  for (let i = 0; i < LATTICE_W * LATTICE_H; i++) canvas.set(bg, i * 3);
  for (let d = 0; d <= 2 * (LATTICE_N - 1); d++) {
    for (let c = 0; c < LATTICE_N; c++) {
      const r = d - c;
      if (r < 0 || r >= LATTICE_N) continue;
      const [ox, oy] = cellOrigin(c, r);
      const [sx, sy] = offset(c, r);
      const { data } = pngs[pick(c, r)];
      for (let y = 0; y < TILE_H; y++) {
        for (let x = 0; x < TILE_W; x++) {
          const cx = ox + sx + x;
          const cy = oy + sy + y;
          if (cx < 0 || cy < 0 || cx >= LATTICE_W || cy >= LATTICE_H) continue;
          const s = (y * TILE_W + x) * 4;
          const a = data[s + 3] / 255;
          if (a === 0) continue;
          const t = (cy * LATTICE_W + cx) * 3;
          for (let ch = 0; ch < 3; ch++) canvas[t + ch] = data[s + ch] * a + canvas[t + ch] * (1 - a);
        }
      }
    }
  }
  return canvas;
}

/**
 * Pixels inside the exact diamond of an interior cell (all four neighbours present) where the
 * background shows: the composites over the two backgrounds differ there.
 */
function latticeLeaks(pngs: Png[], pick: Pick, offset: Offset = () => [0, 0]): { leaks: number; checked: number } {
  const [a, b] = BACKGROUNDS.map((bg) => compositeLattice(pngs, pick, bg, offset));
  let leaks = 0;
  let checked = 0;
  for (let r = 1; r < LATTICE_N - 1; r++) {
    for (let c = 1; c < LATTICE_N - 1; c++) {
      const [ox, oy] = cellOrigin(c, r);
      for (let y = 0; y < TILE_H; y++) {
        for (let x = 0; x < TILE_W; x++) {
          if (!inExactDiamond(x, y)) continue;
          checked++;
          const t = ((oy + y) * LATTICE_W + ox + x) * 3;
          if (a[t] !== b[t] || a[t + 1] !== b[t + 1] || a[t + 2] !== b[t + 2]) leaks++;
        }
      }
    }
  }
  return { leaks, checked };
}

/** A copy of `png` made transparent outside |dx|/64 + |dy|/32 <= scale (for the detector self-check). */
function clipDiamond(png: Png, scale: number): Png {
  const data = new Uint8Array(png.data);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) if (!inExactDiamond(x, y, scale)) data[(y * png.width + x) * 4 + 3] = 0;
  }
  return { ...png, data };
}

const allTilesetIds = [...FLOOR_TILESET.border, ...FLOOR_TILESET.interior.map((t) => t.id)];

describe('floor tile assets', () => {
  it('every tileset id has a texture key, a url and a PNG file', () => {
    for (const id of allTilesetIds) {
      expect(FLOOR_TILE_IDS).toContain(id);
      expect(FLOOR_TILE_KEYS[id]).toBe(`floor:${id}`);
      expect(FLOOR_TILE_URLS[id]).toBe(`/assets/tiles/floor/${id}.png`);
      expect(existsSync(publicPath(FLOOR_TILE_URLS[id])), `${id}.png exists`).toBe(true);
    }
    expect([...FLOOR_TILE_IDS].sort()).toEqual([...allTilesetIds].sort());
  });

  it('loadFloorTiles queues one image per tile id', () => {
    const calls: [string, string][] = [];
    loadFloorTiles({ load: { image: (key: string, url: string) => calls.push([key, url]) } });
    expect(calls).toEqual(FLOOR_TILE_IDS.map((id) => [FLOOR_TILE_KEYS[id], FLOOR_TILE_URLS[id]]));
  });

  it('each tile is 128x64 with transparent corners and an opaque diamond', () => {
    for (const id of FLOOR_TILE_IDS) {
      const png = loadTile(id);
      expect([png.width, png.height], id).toEqual([TILE_W, TILE_H]);
      expect(png.data.length).toBe(TILE_W * TILE_H * 4);
      for (const [x, y] of TRANSPARENT_POINTS) {
        expect(alpha(png, x, y), `${id} alpha at (${x},${y})`).toBe(0);
      }
      for (const [x, y] of OPAQUE_POINTS) {
        expect(alpha(png, x, y), `${id} alpha at (${x},${y})`).toBe(255);
      }
    }
  });

  it('tiles compose into a lattice with no gaps', () => {
    const tiles = FLOOR_TILE_IDS.map((id) => ({ id, png: loadTile(id) }));
    for (const { id, png } of tiles) expect([png.width, png.height], id).toEqual([TILE_W, TILE_H]);
    const pngs = tiles.map((t) => t.png);
    // One lattice per tile id (uniform floor) plus one mixing all ids.
    const layouts: [string, Pick][] = [
      ...tiles.map((t, k): [string, Pick] => [t.id, () => k]),
      ['mixed', (c, r) => (c * 7 + r * 3) % tiles.length],
    ];
    for (const [name, pick] of layouts) {
      const { leaks, checked } = latticeLeaks(pngs, pick);
      expect(checked, `${name} lattice checked pixels`).toBe(EXACT_DIAMOND_PIXELS * (LATTICE_N - 2) ** 2);
      expect(leaks, `${name} lattice pixels showing the background inside interior cells`).toBe(0);
    }
  });

  it('the lattice gap detector catches clipped and misplaced tiles', () => {
    const pngs = FLOOR_TILE_IDS.map(loadTile);
    const mixed: Pick = (c, r) => (c * 7 + r * 3) % pngs.length;
    // Every tile clipped to 0.94 of its diamond leaves a ~2 px gap all around each cell.
    const clipped = pngs.map((png) => clipDiamond(png, 0.94));
    expect(latticeLeaks(clipped, mixed).leaks, 'clipped tiles').toBeGreaterThan(0);
    // One interior tile drawn 3 px too low opens a gap along its upper edges.
    const shifted = latticeLeaks(pngs, mixed, (c, r) => (c === 2 && r === 2 ? [0, 3] : [0, 0]));
    expect(shifted.leaks, 'one tile shifted 3 px').toBeGreaterThan(0);
  });

  it('tiles are close in brightness so none competes with telegraphs', () => {
    const means: number[] = [];
    for (const id of FLOOR_TILE_IDS) {
      const { data } = loadTile(id);
      let n = 0;
      let sum = 0;
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] !== 255) continue;
        const l = luma(data, i);
        n++;
        sum += l;
        if (l > BRIGHT_LUMA) bright++;
      }
      expect(n, `${id} opaque pixels`).toBeGreaterThan(0);
      const mean = sum / n;
      means.push(mean);
      expect(mean, `${id} mean luminance`).toBeGreaterThanOrEqual(MEAN_LUMA_MIN);
      expect(mean, `${id} mean luminance`).toBeLessThanOrEqual(MEAN_LUMA_MAX);
      expect(bright / n, `${id} bright fraction`).toBeLessThanOrEqual(BRIGHT_FRACTION_MAX);
    }
    expect(Math.max(...means) - Math.min(...means)).toBeLessThanOrEqual(MEAN_LUMA_SPREAD_MAX);
  });

  it('neighbouring tile edges are similar so tiles do not show seams', () => {
    // Two lattice neighbours share a diagonal: the upper-right edge of one tile meets the
    // lower-left edge of the next (and upper-left meets lower-right). Compare the opaque pixels
    // just inside both edges at the same position along the diagonal, for every pair of ids.
    const tiles = FLOOR_TILE_IDS.map((id) => ({ id, png: loadTile(id) }));
    const half = TILE_H / 2;
    for (const a of tiles) {
      for (const b of tiles) {
        let urSum = 0;
        let urN = 0;
        let ulSum = 0;
        let ulN = 0;
        for (let x = EDGE_TIP_SKIP; x < TILE_W / 2 - EDGE_TIP_SKIP; x++) {
          const y = Math.floor((x + 0.5) / 2);
          // Upper-right edge of a: (64 + x, y + inset); lower-left edge of b: (x, 32 + y - inset).
          const ur = sample(a.png, TILE_W / 2 + x, y + EDGE_INSET);
          const ll = sample(b.png, x, half + y - EDGE_INSET);
          if (ur !== null && ll !== null) {
            urSum += Math.abs(ur - ll);
            urN++;
          }
          // Upper-left edge of a: (63 - x, y + inset); lower-right edge of b: (127 - x, 32 + y - inset).
          const ul = sample(a.png, TILE_W / 2 - 1 - x, y + EDGE_INSET);
          const lr = sample(b.png, TILE_W - 1 - x, half + y - EDGE_INSET);
          if (ul !== null && lr !== null) {
            ulSum += Math.abs(ul - lr);
            ulN++;
          }
        }
        expect(urN, `${a.id}/${b.id} upper-right samples`).toBeGreaterThan(TILE_W / 4);
        expect(ulN, `${a.id}/${b.id} upper-left samples`).toBeGreaterThan(TILE_W / 4);
        expect(urSum / urN, `${a.id} upper-right vs ${b.id} lower-left`).toBeLessThanOrEqual(EDGE_DIFF_MAX);
        expect(ulSum / ulN, `${a.id} upper-left vs ${b.id} lower-right`).toBeLessThanOrEqual(EDGE_DIFF_MAX);
      }
    }
  });

  it('readPngRgba fails clearly for a missing file', () => {
    expect(() => readPngRgba(publicPath('/assets/tiles/floor/does_not_exist.png'))).toThrow(/not found/);
  });

  it('readPngRgba fails clearly for a file that is not a PNG', () => {
    expect(() => readPngRgba(fileURLToPath(new URL('../../../package.json', import.meta.url)))).toThrow(/not a PNG/);
  });
});
