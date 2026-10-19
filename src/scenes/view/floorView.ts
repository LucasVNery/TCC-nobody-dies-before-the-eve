// Draws the procedural floor (playable rectangle plus darkened skirt) into one
// container created once; rebuilds replace its children. Structural scene slice,
// no Phaser import, so it runs against an in-memory stub in tests.
import type { AABB } from '../../combat/types';
import { toScreen, type GroundProjection } from '../../visual/groundProjection';
import { FLOOR_TILE_KEYS } from '../../visual/floor/floorAssets';
import type { FloorLayout } from '../../visual/floor/composeFloor';
import { skirtTint } from '../../visual/floor/skirtTint';

const FLOOR_DEPTH_BASE = -100000;

export interface FloorImage {
  setOrigin(x: number, y: number): unknown;
  setDisplaySize(w: number, h: number): unknown;
  setDepth(d: number): unknown;
  setTint(color: number): unknown;
}

/** I is the concrete image type, so a Phaser container (whose add wants a GameObject) satisfies it. */
export interface FloorContainer<I extends FloorImage = FloorImage> {
  add(child: I): unknown;
  removeAll(destroyChild?: boolean): unknown;
  setDepth(d: number): unknown;
  destroy(): unknown;
  readonly length: number;
}

export interface FloorScene<I extends FloorImage = FloorImage> {
  add: { container(x: number, y: number): FloorContainer<I>; image(x: number, y: number, key: string): I };
  textures: { exists(key: string): boolean };
}

export class FloorView<I extends FloorImage = FloorImage> {
  readonly container: FloorContainer<I>;
  private readonly keys = new Map<string, string>();

  constructor(
    private readonly scene: FloorScene<I>,
    private readonly bounds: AABB,
    private readonly projection: GroundProjection,
    tileIds: readonly string[],
  ) {
    for (const id of tileIds) {
      const key = FLOOR_TILE_KEYS[id] ?? `floor:${id}`;
      if (!scene.textures.exists(key)) throw new Error(`FloorView: missing floor texture "${key}" (tile ${id})`);
      this.keys.set(id, key);
    }
    this.container = scene.add.container(0, 0);
    this.container.setDepth(FLOOR_DEPTH_BASE); // below every sprite (depth = world x + y >= 0)
  }

  rebuild(layout: FloorLayout): void {
    for (const row of layout.tiles) {
      for (const id of row) {
        if (!this.keys.has(id)) throw new Error(`FloorView: unknown floor tile id "${id}"`);
      }
    }
    this.container.removeAll(true);
    const p = this.projection;
    const { col0, row0, cols, rows } = layout.playable;
    // The ring width of this layout (SKIRT_TILES in the game): darkest at its outer edge.
    const skirt = Math.max(col0, row0);
    const T = p.tileWorldSize;
    const totalRows = layout.tiles.length;
    const totalCols = totalRows > 0 ? layout.tiles[0].length : 0;
    // Back-to-front: increasing diagonal r + c, ties by increasing r.
    for (let d = 0; d <= totalRows + totalCols - 2; d++) {
      for (let r = Math.max(0, d - totalCols + 1); r <= Math.min(totalRows - 1, d); r++) {
        const c = d - r;
        const id = layout.tiles[r][c];
        if (id === undefined) continue;
        // (x, y) is the cell's top world corner, i.e. the diamond's top vertex.
        const pos = toScreen({ x: this.bounds.x + (c - col0) * T, y: this.bounds.y + (r - row0) * T }, p);
        const img = this.scene.add.image(pos.x, pos.y, this.keys.get(id) as string);
        img.setOrigin(0.5, 0);
        img.setDisplaySize(p.tileScreenWidth, p.tileScreenHeight);
        img.setDepth(FLOOR_DEPTH_BASE + r + c);
        const dx = Math.max(col0 - c, c - (col0 + cols - 1), 0);
        const dy = Math.max(row0 - r, r - (row0 + rows - 1), 0);
        const distance = Math.max(dx, dy);
        if (distance > 0) img.setTint(skirtTint(distance, skirt));
        this.container.add(img);
      }
    }
  }

  destroy(): void {
    this.container.destroy();
  }
}
