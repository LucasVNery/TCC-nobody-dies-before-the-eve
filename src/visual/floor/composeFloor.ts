// Pure procedural floor composition. One private PRNG per call, consumed in row-major order.
import { createFloorRng, floorSeed } from './floorSeed';

export interface TileChoice {
  id: string;
  weight: number;
  repeatable: boolean;
}

export interface TileSet {
  border: string[];
  interior: TileChoice[];
}

export interface FloorLayout {
  tiles: string[][];
  playable: { col0: number; row0: number; cols: number; rows: number };
}

export const FLOOR_TILESET: TileSet = {
  border: ['floor_edge'],
  interior: [
    { id: 'floor_base', weight: 6, repeatable: true },
    { id: 'floor_a', weight: 2, repeatable: false },
    { id: 'floor_b', weight: 2, repeatable: false },
    { id: 'floor_worn', weight: 1, repeatable: false },
  ],
};

export const SKIRT_TILES = 10;

function validateDims(colunas: number, linhas: number): void {
  for (const n of [colunas, linhas]) {
    if (!Number.isInteger(n) || n < 3) {
      throw new Error(`composeFloor: invalid dimensions (${colunas}x${linhas}), integers >= 3 required`);
    }
  }
}

function validateTileset(ts: TileSet, allowBorderOverlap: boolean): void {
  if (ts.border.length === 0) throw new Error('composeFloor: empty border set');
  if (ts.interior.length === 0) throw new Error('composeFloor: empty interior set');
  const seen = new Set<string>();
  for (const t of ts.interior) {
    if (!Number.isFinite(t.weight) || t.weight <= 0) {
      throw new Error(`composeFloor: invalid weight for tile "${t.id}", finite > 0 required`);
    }
    if (seen.has(t.id)) throw new Error(`composeFloor: duplicate tile id "${t.id}"`);
    seen.add(t.id);
  }
  if (!allowBorderOverlap) {
    for (const id of ts.border) {
      if (seen.has(id)) throw new Error(`composeFloor: duplicate tile id "${id}"`);
      seen.add(id);
    }
  }
}

function compose(seed: number, colunas: number, linhas: number, ts: TileSet): string[][] {
  const rng = createFloorRng(seed);
  const grid: string[][] = [];
  for (let r = 0; r < linhas; r++) {
    const row: string[] = [];
    for (let c = 0; c < colunas; c++) {
      const onFrame = r === 0 || c === 0 || r === linhas - 1 || c === colunas - 1;
      if (onFrame) {
        row.push(ts.border[Math.floor(rng() * ts.border.length)]);
        continue;
      }
      const left = c > 0 ? row[c - 1] : undefined;
      const top = r > 0 ? grid[r - 1][c] : undefined;
      let cands = ts.interior.filter((t) => t.repeatable || (t.id !== left && t.id !== top));
      if (cands.length === 0) cands = ts.interior;
      let total = 0;
      for (const t of cands) total += t.weight;
      let x = rng() * total;
      let pick = cands[cands.length - 1];
      for (const t of cands) {
        if (x < t.weight) {
          pick = t;
          break;
        }
        x -= t.weight;
      }
      row.push(pick.id);
    }
    grid.push(row);
  }
  return grid;
}

export function composeFloor(seed: number, colunas: number, linhas: number, tileset: TileSet): string[][] {
  validateDims(colunas, linhas);
  validateTileset(tileset, false);
  return compose(seed, colunas, linhas, tileset);
}

export function composeFloorWithSkirt(
  seed: number,
  colunas: number,
  linhas: number,
  skirt: number,
  tileset: TileSet,
): FloorLayout {
  if (!Number.isInteger(skirt) || skirt < 0) {
    throw new Error(`composeFloorWithSkirt: invalid skirt ${skirt}, integer >= 0 required`);
  }
  const playableTiles = composeFloor(seed, colunas, linhas, tileset);
  if (skirt === 0) {
    return { tiles: playableTiles, playable: { col0: 0, row0: 0, cols: colunas, rows: linhas } };
  }
  const skirtSet: TileSet = { border: tileset.interior.map((t) => t.id), interior: tileset.interior };
  validateTileset(skirtSet, true);
  const tiles = compose(floorSeed(seed, 0x5eed), colunas + 2 * skirt, linhas + 2 * skirt, skirtSet);
  for (let r = 0; r < linhas; r++) {
    for (let c = 0; c < colunas; c++) tiles[skirt + r][skirt + c] = playableTiles[r][c];
  }
  return { tiles, playable: { col0: skirt, row0: skirt, cols: colunas, rows: linhas } };
}
