import { describe, it, expect } from 'vitest';
import { FloorView, type FloorScene, type FloorImage, type FloorContainer } from './floorView';
import { GROUND_PROJECTION, toScreen } from '../../visual/groundProjection';
import { FLOOR_TILE_IDS, FLOOR_TILE_KEYS } from '../../visual/floor/floorAssets';
import { SKIRT_TILES, type FloorLayout } from '../../visual/floor/composeFloor';
import { skirtTint } from '../../visual/floor/skirtTint';
import { worldCameraBounds } from '../../visual/cameraDefaults';
import { MIN_ZOOM } from '../../visual/cameraZoom';
import { ARENA_BOUNDS } from '../../combat/movementDefs';

class StubImage implements FloorImage {
  origin: [number, number] | null = null;
  size: [number, number] | null = null;
  depth: number | null = null;
  tint: number | null = null;
  constructor(readonly x: number, readonly y: number, readonly key: string) {}
  setOrigin(x: number, y: number): this { this.origin = [x, y]; return this; }
  setDisplaySize(w: number, h: number): this { this.size = [w, h]; return this; }
  setDepth(d: number): this { this.depth = d; return this; }
  setTint(c: number): this { this.tint = c; return this; }
}

class StubContainer implements FloorContainer {
  children: StubImage[] = [];
  removeAllCalls: (boolean | undefined)[] = [];
  destroyed = false;
  depth = 0;
  setDepth(d: number): this { this.depth = d; return this; }
  add(child: FloorImage): this { this.children.push(child as StubImage); return this; }
  removeAll(destroyChild?: boolean): this { this.removeAllCalls.push(destroyChild); this.children = []; return this; }
  destroy(): void { this.destroyed = true; }
  get length(): number { return this.children.length; }
}

function stubScene(missing: string[] = []) {
  const containers: StubContainer[] = [];
  const scene: FloorScene = {
    add: {
      container: () => { const c = new StubContainer(); containers.push(c); return c; },
      image: (x, y, key) => new StubImage(x, y, key),
    },
    textures: { exists: (key) => !missing.includes(key) },
  };
  return { scene, containers };
}

function layout(rows: number, cols: number, skirt: number): FloorLayout {
  const tiles = Array.from({ length: rows + 2 * skirt }, () => Array.from({ length: cols + 2 * skirt }, () => 'floor_base'));
  return { tiles, playable: { col0: skirt, row0: skirt, cols, rows } };
}

const ORIGIN = { x: 0, y: 0, width: 192, height: 192 };

/** Finds the child for layout cell (r, c) by its projected position (insertion order is diagonal). */
function grid(view: FloorView, bounds: { x: number; y: number }, col0: number, row0: number): (r: number, c: number) => StubImage {
  const children = (view.container as StubContainer).children;
  return (r, c) => {
    const p = toScreen({ x: bounds.x + (c - col0) * 64, y: bounds.y + (r - row0) * 64 }, GROUND_PROJECTION);
    const hit = children.find((img) => img.x === p.x && img.y === p.y);
    if (!hit) throw new Error(`no image at cell (${r},${c})`);
    return hit;
  };
}

describe('FloorView', () => {
  it('construction fails fast naming the missing texture', () => {
    const { scene } = stubScene([FLOOR_TILE_KEYS.floor_worn]);
    expect(() => new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS)).toThrow(/floor_worn/);
  });

  it('rebuild places one image per cell at the projected top vertex with origin (0.5,0) and display size 64x32', () => {
    const { scene } = stubScene();
    const view = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(3, 3, 0));
    const children = (view.container as StubContainer).children;
    expect(children).toHaveLength(9);
    const at = grid(view, ORIGIN, 0, 0);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const img = at(r, c);
        const p = toScreen({ x: c * 64, y: r * 64 }, GROUND_PROJECTION);
        expect([img.x, img.y]).toEqual([p.x, p.y]);
        expect(img.key).toBe(FLOOR_TILE_KEYS.floor_base);
        expect(img.origin).toEqual([0.5, 0]);
        expect(img.size).toEqual([64, 32]);
        expect(img.depth).toBe(-100000 + r + c);
      }
    }
  });

  it('rebuild inserts cells by increasing diagonal r + c, ties broken by increasing r', () => {
    const { scene } = stubScene();
    const view = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(3, 3, 0));
    const children = (view.container as StubContainer).children;
    const at = grid(view, ORIGIN, 0, 0);
    expect(children[0]).toBe(at(0, 0));
    expect(children[children.length - 1]).toBe(at(2, 2));
    const order: [number, number][] = [];
    for (let d = 0; d <= 4; d++) {
      for (let r = 0; r < 3; r++) {
        const c = d - r;
        if (c >= 0 && c < 3) order.push([r, c]);
      }
    }
    expect(children).toEqual(order.map(([r, c]) => at(r, c)));
  });

  it('cells outside the playable rectangle are tinted with skirtTint of their Chebyshev distance and playable cells are not', () => {
    const { scene } = stubScene();
    const view = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(3, 3, 2));
    const at = grid(view, ORIGIN, 2, 2);
    expect(at(0, 0).tint).toBe(skirtTint(2, 2));
    expect(at(1, 3).tint).toBe(skirtTint(1, 2));
    expect(at(0, 6).tint).toBe(skirtTint(2, 2));
    expect(at(6, 1).tint).toBe(skirtTint(2, 2));
    expect(at(2, 2).tint).toBeNull();
    expect(at(3, 3).tint).toBeNull();
    expect(at(4, 4).tint).toBeNull();
  });

  it('the layout origin is shifted by the skirt so the playable rectangle sits at the bounds', () => {
    const { scene } = stubScene();
    const bounds = { x: 128, y: 64, width: 192, height: 192 };
    const view = new FloorView(scene, bounds, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(3, 3, 2));
    const p = toScreen({ x: bounds.x, y: bounds.y }, GROUND_PROJECTION);
    const children = (view.container as StubContainer).children;
    // Cell (2,2) is the playable top-left: it sits at the projected bounds origin with depth base + 4.
    const cell = children.find((img) => img.x === p.x && img.y === p.y);
    expect(cell).toBeDefined();
    expect(cell?.depth).toBe(-100000 + 4);
    // The outer corner (0,0) is two tiles up-left in world space.
    const corner = toScreen({ x: bounds.x - 128, y: bounds.y - 128 }, GROUND_PROJECTION);
    expect([children[0].x, children[0].y]).toEqual([corner.x, corner.y]);
  });

  it('rebuilding twice leaves exactly rows x cols children', () => {
    const { scene, containers } = stubScene();
    const view = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(3, 3, 1));
    view.rebuild(layout(4, 3, 1));
    expect(view.container.length).toBe(6 * 5);
    expect(containers).toHaveLength(1);
    expect(containers[0].depth).toBe(-100000);
  });

  it('rebuild clears previous children with destroy', () => {
    const { scene } = stubScene();
    const view = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(3, 3, 0));
    view.rebuild(layout(3, 3, 0));
    expect((view.container as StubContainer).removeAllCalls).toContain(true);
  });

  it('unknown tile id in the layout throws naming the id', () => {
    const { scene } = stubScene();
    const view = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    const bad = layout(3, 3, 0);
    bad.tiles[1][1] = 'floor_lava';
    expect(() => view.rebuild(bad)).toThrow(/floor_lava/);
  });

  it('destroy removes the container', () => {
    const { scene } = stubScene();
    const view = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.destroy();
    expect((view.container as StubContainer).destroyed).toBe(true);
  });

  it('camera bounds with SKIRT_TILES cover the viewport at MIN_ZOOM', () => {
    const b = worldCameraBounds(ARENA_BOUNDS, GROUND_PROJECTION, SKIRT_TILES);
    expect(b.width).toBeGreaterThanOrEqual(1280 / MIN_ZOOM);
    expect(b.height).toBeGreaterThanOrEqual(720 / MIN_ZOOM);
  });
});
