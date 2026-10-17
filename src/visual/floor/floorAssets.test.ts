import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FLOOR_TILESET } from './composeFloor';
import { FLOOR_TILE_IDS, FLOOR_TILE_KEYS, FLOOR_TILE_URLS, loadFloorTiles } from './floorAssets';
import { readPngRgba } from './testing/readPng';

const TILE_W = 128;
const TILE_H = 96;

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

  it('each tile is 128x96 and fully opaque', () => {
    for (const id of FLOOR_TILE_IDS) {
      const png = loadTile(id);
      expect([png.width, png.height], id).toEqual([TILE_W, TILE_H]);
      expect(png.data.length).toBe(TILE_W * TILE_H * 4);
      let nonOpaque = 0;
      for (let i = 3; i < png.data.length; i += 4) if (png.data[i] !== 255) nonOpaque++;
      expect(nonOpaque, `${id} non-opaque pixels`).toBe(0);
    }
  });

  it('tiles are close in brightness so none competes with telegraphs', () => {
    const means: number[] = [];
    for (const id of FLOOR_TILE_IDS) {
      const { data } = loadTile(id);
      const n = data.length / 4;
      let sum = 0;
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) {
        const l = luma(data, i);
        sum += l;
        if (l > BRIGHT_LUMA) bright++;
      }
      const mean = sum / n;
      means.push(mean);
      expect(mean, `${id} mean luminance`).toBeGreaterThanOrEqual(MEAN_LUMA_MIN);
      expect(mean, `${id} mean luminance`).toBeLessThanOrEqual(MEAN_LUMA_MAX);
      expect(bright / n, `${id} bright fraction`).toBeLessThanOrEqual(BRIGHT_FRACTION_MAX);
    }
    expect(Math.max(...means) - Math.min(...means)).toBeLessThanOrEqual(MEAN_LUMA_SPREAD_MAX);
  });

  it('neighbouring tile edges are similar so tiles do not show seams', () => {
    for (const id of FLOOR_TILE_IDS) {
      const { data, width, height } = loadTile(id);
      let colDiff = 0;
      for (let y = 0; y < height; y++) {
        colDiff += Math.abs(luma(data, (y * width) * 4) - luma(data, (y * width + width - 1) * 4));
      }
      let rowDiff = 0;
      for (let x = 0; x < width; x++) {
        rowDiff += Math.abs(luma(data, x * 4) - luma(data, ((height - 1) * width + x) * 4));
      }
      expect(colDiff / height, `${id} left/right edge`).toBeLessThanOrEqual(EDGE_DIFF_MAX);
      expect(rowDiff / width, `${id} top/bottom edge`).toBeLessThanOrEqual(EDGE_DIFF_MAX);
    }
  });

  it('readPngRgba fails clearly for a missing file', () => {
    expect(() => readPngRgba(publicPath('/assets/tiles/floor/does_not_exist.png'))).toThrow(/not found/);
  });

  it('readPngRgba fails clearly for a file that is not a PNG', () => {
    expect(() => readPngRgba(fileURLToPath(new URL('../../../package.json', import.meta.url)))).toThrow(/not a PNG/);
  });
});
