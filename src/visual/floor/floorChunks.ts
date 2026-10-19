// Pure plan for pre-rendering a floor layout into a few large chunks at the tiles'
// native resolution: each chunk lists the tile stamps that overlap it (apron included),
// back to front, so a chunk's pixels equal what the per-cell images drew over that
// rectangle; the displayed crops tile the floor without gaps or overlaps.
import type { FloorLayout } from './composeFloor';
import { floorTileGrid } from './floorTileGrid';
import { toScreen, type GroundProjection } from '../groundProjection';

/**
 * Max chunk side in native (texture) pixels, apron included. 1024 keeps the game floor at
 * ~15 textures (~51 MB; at most ~12 on screen at the minimum zoom, one batch) and a room
 * rebuild cheap: each render target costs a fixed setup, so fewer, larger chunks rebuild faster.
 */
export const FLOOR_CHUNK_SIZE = 1024;

/**
 * Extra native pixels each chunk renders past its cell of the chunk grid on every side.
 * Only the cell (the chunk's crop) is displayed, so neighbouring crops abut exactly while
 * linear filtering at a crop edge still reads the true neighbouring texels from the apron.
 * Without it a faint 1px line shows at chunk edges whenever the camera sits at a
 * fractional position (the edge texel is clamped instead of blended with the next chunk).
 */
export const FLOOR_CHUNK_APRON = 2;

export interface FloorStamp {
  /** Layout cell. */
  r: number;
  c: number;
  /** Index into tileIds. */
  index: number;
  /** Texture top-left inside the chunk, native pixels. */
  x: number;
  y: number;
  /** Multiplicative tint (0xffffff = untinted). */
  tint: number;
}

export interface FloorChunk {
  /** Top-left of the render texture (apron included) in screen (world) space. */
  x: number;
  y: number;
  /** Render texture size in native pixels (displayed at width * scale). */
  width: number;
  height: number;
  /** The displayed part of the texture (its grid cell, without the apron), native pixels. */
  crop: { x: number; y: number; width: number; height: number };
  stamps: FloorStamp[];
}

export interface FloorChunkPlan {
  /** Display scale of every chunk (screen px per native px). */
  scale: number;
  chunks: FloorChunk[];
}

export function planFloorChunks(
  layout: FloorLayout,
  tileIds: readonly string[],
  origin: { x: number; y: number },
  p: GroundProjection,
  texture: { width: number; height: number },
  chunkSize: number = FLOOR_CHUNK_SIZE,
): FloorChunkPlan {
  const k = texture.width / p.tileScreenWidth; // native px per screen px
  if (!(k > 0) || texture.height / p.tileScreenHeight !== k) {
    throw new Error(`planFloorChunks: tile texture ${texture.width}x${texture.height} does not match the projection scale`);
  }
  const { indices, tintFor } = floorTileGrid(layout, tileIds);
  const { col0, row0 } = layout.playable;
  const T = p.tileWorldSize;
  const rows = indices.length;
  const cols = rows > 0 ? indices[0].length : 0;

  // Texture top-left of every cell in native pixels, back to front (diagonal r + c, ties by r).
  const cells: { r: number; c: number; x: number; y: number }[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let d = 0; d <= rows + cols - 2; d++) {
    for (let r = Math.max(0, d - cols + 1); r <= Math.min(rows - 1, d); r++) {
      const c = d - r;
      // The cell's top world corner is the diamond's top vertex (texture top-centre).
      const top = toScreen({ x: origin.x + (c - col0) * T, y: origin.y + (r - row0) * T }, p);
      const x = Math.round(k * top.x - texture.width / 2);
      const y = Math.round(k * top.y);
      cells.push({ r, c, x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + texture.width);
      maxY = Math.max(maxY, y + texture.height);
    }
  }
  if (cells.length === 0) return { scale: 1 / k, chunks: [] };

  // Chunk grid anchored at the floor's top-left; k-aligned so chunks sit on whole screen pixels too.
  const ax = Math.floor(minX / k) * k;
  const ay = Math.floor(minY / k) * k;
  // Each chunk renders its grid cell plus an apron on every side (see FLOOR_CHUNK_APRON).
  const apron = Math.ceil(FLOOR_CHUNK_APRON / k) * k;
  const step = Math.max(k, Math.floor((chunkSize - 2 * apron) / k) * k);
  const nx = Math.ceil((maxX - ax) / step);
  const ny = Math.ceil((maxY - ay) / step);
  const clamp = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));
  /** Grid cells i whose apron-extended span [a + i*step - apron, a + (i+1)*step + apron) overlaps [lo, hi). */
  const span = (lo: number, hi: number, a: number, n: number): [number, number] => [
    clamp(Math.floor((lo - apron - a) / step), n),
    clamp(Math.ceil((hi + apron - a) / step) - 1, n),
  ];
  const grid: FloorStamp[][] = Array.from({ length: nx * ny }, () => []);
  for (const cell of cells) {
    const [i0, i1] = span(cell.x, cell.x + texture.width, ax, nx);
    const [j0, j1] = span(cell.y, cell.y + texture.height, ay, ny);
    const index = indices[cell.r][cell.c];
    const tint = tintFor(cell.r, cell.c) ?? 0xffffff;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = cell.x - (ax + i * step - apron);
        const y = cell.y - (ay + j * step - apron);
        grid[j * nx + i].push({ r: cell.r, c: cell.c, index, x, y, tint });
      }
    }
  }
  const chunks: FloorChunk[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const stamps = grid[j * nx + i];
      if (stamps.length === 0) continue;
      const x0 = ax + i * step;
      const y0 = ay + j * step;
      const w = Math.min(step, maxX - x0);
      const h = Math.min(step, maxY - y0);
      chunks.push({
        x: (x0 - apron) / k,
        y: (y0 - apron) / k,
        width: w + 2 * apron,
        height: h + 2 * apron,
        crop: { x: apron, y: apron, width: w, height: h },
        stamps,
      });
    }
  }
  return { scale: 1 / k, chunks };
}
