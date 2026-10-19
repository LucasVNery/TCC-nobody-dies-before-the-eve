import { describe, it, expect } from 'vitest';
import { planFloorChunks, FLOOR_CHUNK_SIZE, FLOOR_CHUNK_APRON, type FloorChunkPlan } from './floorChunks';
import { FLOOR_TILE_IDS, FLOOR_TILE_TEXTURE } from './floorAssets';
import { SKIRT_TILES, type FloorLayout } from './composeFloor';
import { skirtTint } from './skirtTint';
import { GROUND_PROJECTION, toScreen } from '../groundProjection';

function layout(rows: number, cols: number, skirt: number): FloorLayout {
  const ids = ['floor_base', 'floor_a', 'floor_b', 'floor_worn', 'floor_edge'];
  const tiles = Array.from({ length: rows + 2 * skirt }, (_, r) =>
    Array.from({ length: cols + 2 * skirt }, (_, c) => ids[(r * 7 + c * 3) % ids.length]),
  );
  return { tiles, playable: { col0: skirt, row0: skirt, cols, rows } };
}

const ORIGIN = { x: 0, y: 0 };
const W = FLOOR_TILE_TEXTURE.width;
const H = FLOOR_TILE_TEXTURE.height;

/** Where the old one-image-per-cell floor put the texture's top-left, in native (texture) pixels. */
function nativeTopLeft(r: number, c: number, l: FloorLayout, origin = ORIGIN): [number, number] {
  const T = GROUND_PROJECTION.tileWorldSize;
  const p = toScreen({ x: origin.x + (c - l.playable.col0) * T, y: origin.y + (r - l.playable.row0) * T }, GROUND_PROJECTION);
  return [2 * p.x - W / 2, 2 * p.y];
}

function plan(l: FloorLayout, origin = ORIGIN): FloorChunkPlan {
  return planFloorChunks(l, FLOOR_TILE_IDS, origin, GROUND_PROJECTION, FLOOR_TILE_TEXTURE);
}

const GAME_LAYOUT = layout(19, 25, SKIRT_TILES);

describe('planFloorChunks', () => {
  it('chunks are drawn at half scale so 128x64 tiles show as 64x32 diamonds', () => {
    expect(FLOOR_TILE_TEXTURE).toEqual({ width: 128, height: 64 });
    expect(plan(layout(3, 3, 0)).scale).toBe(0.5);
  });

  it('a small layout fits one chunk whose stamps reproduce the per-cell placement, ids and back-to-front order', () => {
    const l = layout(3, 3, 0);
    const { chunks, scale } = plan(l);
    expect(chunks).toHaveLength(1);
    const [ch] = chunks;
    expect(ch.stamps).toHaveLength(9);
    const order = ch.stamps.map((s) => [s.r, s.c]);
    const expected: number[][] = [];
    for (let d = 0; d <= 4; d++) for (let r = 0; r < 3; r++) if (d - r >= 0 && d - r < 3) expected.push([r, d - r]);
    expect(order).toEqual(expected);
    for (const s of ch.stamps) {
      const [nx, ny] = nativeTopLeft(s.r, s.c, l);
      expect([ch.x / scale + s.x, ch.y / scale + s.y]).toEqual([nx, ny]);
      expect(FLOOR_TILE_IDS[s.index]).toBe(l.tiles[s.r][s.c]);
    }
    // The chunk is the bounding box of the tiles plus the apron on every side.
    expect([ch.width, ch.height]).toEqual([3 * W + 2 * FLOOR_CHUNK_APRON, 3 * H + 2 * FLOOR_CHUNK_APRON]);
  });

  it('the layout origin is shifted by the skirt so the playable top-left cell sits at the projected bounds origin', () => {
    const l = layout(3, 3, 2);
    const origin = { x: 128, y: 64 };
    const { chunks, scale } = plan(l, origin);
    const p = toScreen(origin, GROUND_PROJECTION);
    const s = chunks.flatMap((ch) => ch.stamps.map((st) => ({ st, ch }))).find(({ st }) => st.r === 2 && st.c === 2);
    expect(s).toBeDefined();
    if (!s) return;
    expect([(s.ch.x / scale + s.st.x + W / 2) * scale, (s.ch.y / scale + s.st.y) * scale]).toEqual([p.x, p.y]);
  });

  it('skirt cells carry skirtTint of their Chebyshev distance and playable cells are untinted (white)', () => {
    const l = layout(3, 3, 2);
    const stamps = plan(l).chunks.flatMap((ch) => ch.stamps);
    const at = (r: number, c: number) => stamps.find((s) => s.r === r && s.c === c);
    expect(at(0, 0)?.tint).toBe(skirtTint(2, 2));
    expect(at(1, 3)?.tint).toBe(skirtTint(1, 2));
    expect(at(6, 1)?.tint).toBe(skirtTint(2, 2));
    expect(at(3, 3)?.tint).toBe(0xffffff);
    expect(at(2, 4)?.tint).toBe(0xffffff);
  });

  it('the game-sized floor splits into a few dozen chunks of at most FLOOR_CHUNK_SIZE native pixels on an integer grid', () => {
    const { chunks, scale } = plan(GAME_LAYOUT);
    const cells = GAME_LAYOUT.tiles.length * GAME_LAYOUT.tiles[0].length;
    expect(cells).toBe(45 * 39);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(cells / 20);
    for (const ch of chunks) {
      expect(ch.width).toBeLessThanOrEqual(FLOOR_CHUNK_SIZE);
      expect(ch.height).toBeLessThanOrEqual(FLOOR_CHUNK_SIZE);
      expect(ch.stamps.length).toBeGreaterThan(0);
      // Native-pixel exact: chunk corners land on whole texture pixels and whole half-scale world pixels.
      for (const v of [ch.x / scale, ch.y / scale, ch.width, ch.height]) expect(Number.isInteger(v)).toBe(true);
      for (const v of [ch.x, ch.y]) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('every cell is stamped wherever its texture rectangle overlaps a chunk, at its per-cell position, back to front', () => {
    const l = GAME_LAYOUT;
    const { chunks, scale } = plan(l);
    const seen = new Set<string>();
    for (const ch of chunks) {
      const x0 = ch.x / scale;
      const y0 = ch.y / scale;
      let last = -1;
      for (const s of ch.stamps) {
        const [nx, ny] = nativeTopLeft(s.r, s.c, l);
        expect([x0 + s.x, y0 + s.y]).toEqual([nx, ny]);
        // overlaps the chunk rectangle
        expect(s.x < ch.width && s.x + W > 0 && s.y < ch.height && s.y + H > 0).toBe(true);
        const key = (s.r + s.c) * 1000 + s.r;
        expect(key).toBeGreaterThan(last);
        last = key;
        seen.add(`${s.r},${s.c}`);
      }
      // and no cell overlapping this chunk is missing from it
      for (let r = 0; r < l.tiles.length; r++) {
        for (let c = 0; c < l.tiles[0].length; c++) {
          const [nx, ny] = nativeTopLeft(r, c, l);
          const overlaps = nx < x0 + ch.width && nx + W > x0 && ny < y0 + ch.height && ny + H > y0;
          if (overlaps) expect(ch.stamps.some((s) => s.r === r && s.c === c), `(${r},${c}) in chunk`).toBe(true);
        }
      }
    }
    expect(seen.size).toBe(l.tiles.length * l.tiles[0].length);
  });

  it('each chunk displays only its crop, an apron inside the render texture on every side', () => {
    expect(FLOOR_CHUNK_APRON).toBeGreaterThan(0);
    for (const ch of plan(GAME_LAYOUT).chunks) {
      expect([ch.crop.x, ch.crop.y]).toEqual([FLOOR_CHUNK_APRON, FLOOR_CHUNK_APRON]);
      expect(ch.crop.x + ch.crop.width + FLOOR_CHUNK_APRON).toBe(ch.width);
      expect(ch.crop.y + ch.crop.height + FLOOR_CHUNK_APRON).toBe(ch.height);
    }
  });

  it('neighbouring crops abut exactly (no gap, no overlap) and cover the whole floor', () => {
    const l = GAME_LAYOUT;
    const { chunks, scale } = plan(l);
    const shown = chunks.map((ch) => ({
      x0: ch.x + ch.crop.x * scale,
      y0: ch.y + ch.crop.y * scale,
      x1: ch.x + (ch.crop.x + ch.crop.width) * scale,
      y1: ch.y + (ch.crop.y + ch.crop.height) * scale,
    }));
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i];
        const b = shown[j];
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlap, `crops ${i} and ${j}`).toBe(false);
      }
    }
    const xs = [...new Set(shown.map((s) => s.x0))].sort((a, b) => a - b);
    const ys = [...new Set(shown.map((s) => s.y0))].sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThan(2);
    expect(ys.length).toBeGreaterThan(2);
    for (const s of shown) {
      const right = shown.find((o) => o.y0 === s.y0 && o.x0 === xs[xs.indexOf(s.x0) + 1]);
      if (right) expect(right.x0).toBe(s.x1);
      const below = shown.find((o) => o.x0 === s.x0 && o.y0 === ys[ys.indexOf(s.y0) + 1]);
      if (below) expect(below.y0).toBe(s.y1);
    }
    // Every cell's diamond centre is shown by some crop.
    for (let r = 0; r < l.tiles.length; r++) {
      for (let c = 0; c < l.tiles[0].length; c++) {
        const [nx, ny] = nativeTopLeft(r, c, l);
        const cx = (nx + W / 2) * scale;
        const cy = (ny + H / 2) * scale;
        expect(shown.some((s) => cx >= s.x0 && cx < s.x1 && cy >= s.y0 && cy < s.y1), `(${r},${c}) shown`).toBe(true);
      }
    }
  });

  it('an unknown id throws naming the id', () => {
    const l = layout(3, 3, 0);
    l.tiles[2][2] = 'floor_lava';
    expect(() => plan(l)).toThrow(/floor_lava/);
  });

  it('rejects a texture whose size does not match the projection scale on both axes', () => {
    expect(() =>
      planFloorChunks(layout(3, 3, 0), FLOOR_TILE_IDS, ORIGIN, GROUND_PROJECTION, { width: 128, height: 48 }),
    ).toThrow(/texture/);
  });
});
