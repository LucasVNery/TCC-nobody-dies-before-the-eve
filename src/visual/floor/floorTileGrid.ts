// Pure per-cell lookup for drawing a floor layout: the tileset index of each cell
// and the skirt darkening (null inside the playable rectangle).
import type { FloorLayout } from './composeFloor';
import { skirtTint } from './skirtTint';

export interface FloorTileGrid {
  /** indices[r][c] is the position of layout.tiles[r][c] in tileIds. */
  indices: number[][];
  /** skirtTint of the Chebyshev distance to the playable rectangle outside it; null inside. */
  tintFor: (r: number, c: number) => number | null;
}

export function floorTileGrid(layout: FloorLayout, tileIds: readonly string[]): FloorTileGrid {
  const indexOf = new Map<string, number>();
  tileIds.forEach((id, i) => {
    if (!indexOf.has(id)) indexOf.set(id, i);
  });
  const indices = layout.tiles.map((row) =>
    row.map((id) => {
      const i = indexOf.get(id);
      if (i === undefined) throw new Error(`floorTileGrid: unknown floor tile id "${id}"`);
      return i;
    }),
  );
  const { col0, row0, cols, rows } = layout.playable;
  // The ring width of this layout (SKIRT_TILES in the game): darkest at its outer edge.
  const skirt = Math.max(col0, row0);
  const tintFor = (r: number, c: number): number | null => {
    const dx = Math.max(col0 - c, c - (col0 + cols - 1), 0);
    const dy = Math.max(row0 - r, r - (row0 + rows - 1), 0);
    const distance = Math.max(dx, dy);
    return distance > 0 ? skirtTint(distance, skirt) : null;
  };
  return { indices, tintFor };
}
