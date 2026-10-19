import { describe, it, expect } from 'vitest';
import { FloorView, type FloorScene, type FloorChunkImage, type FloorChunkTexture, type FloorContainer } from './floorView';
import { GROUND_PROJECTION } from '../../visual/groundProjection';
import { FLOOR_TILE_IDS, FLOOR_TILE_KEYS, FLOOR_TILE_TEXTURE } from '../../visual/floor/floorAssets';
import { SKIRT_TILES, type FloorLayout } from '../../visual/floor/composeFloor';
import { planFloorChunks } from '../../visual/floor/floorChunks';
import { worldCameraBounds } from '../../visual/cameraDefaults';
import { MIN_ZOOM } from '../../visual/cameraZoom';
import { ARENA_BOUNDS } from '../../combat/movementDefs';

interface Draw { key: string; frame: string | number | undefined; x: number; y: number; alpha: number; tint: number }

class StubTexture implements FloorChunkTexture {
  draws: Draw[] = [];
  drawing = false;
  batches = 0;
  clears = 0;
  destroyed = false;
  constructor(readonly key: string, readonly width: number, readonly height: number) {}
  clear(): this { this.clears++; this.draws = []; return this; }
  beginDraw(): this { this.drawing = true; this.batches++; return this; }
  batchDrawFrame(key: string, frame?: string | number, x = 0, y = 0, alpha = 1, tint = 0xffffff): this {
    if (!this.drawing) throw new Error('batchDrawFrame outside beginDraw/endDraw');
    this.draws.push({ key, frame, x, y, alpha, tint });
    return this;
  }
  endDraw(): this { this.drawing = false; return this; }
  destroy(): void { this.destroys++; this.destroyed = true; }
  destroys = 0;
}

/** Minimal emitter with Phaser's once/on/off semantics for the events FloorView uses. */
class StubEmitter {
  private listeners: { event: string; fn: () => void; once: boolean }[] = [];
  once(event: string, fn: () => void): this { this.listeners.push({ event, fn, once: true }); return this; }
  on(event: string, fn: () => void): this { this.listeners.push({ event, fn, once: false }); return this; }
  off(event: string, fn: () => void): this { this.listeners = this.listeners.filter((l) => !(l.event === event && l.fn === fn)); return this; }
  emit(event: string): void {
    const hit = this.listeners.filter((l) => l.event === event);
    this.listeners = this.listeners.filter((l) => !(l.event === event && l.once));
    for (const l of hit) l.fn();
  }
  count(event: string): number { return this.listeners.filter((l) => l.event === event).length; }
}

class StubImage implements FloorChunkImage {
  origin: [number, number] | null = null;
  scale: number | null = null;
  crop: [number, number, number, number] | null = null;
  destroyed = false;
  constructor(readonly x: number, readonly y: number, readonly key: string) {}
  setOrigin(x: number, y: number): this { this.origin = [x, y]; return this; }
  setScale(s: number): this { this.scale = s; return this; }
  setCrop(x: number, y: number, w: number, h: number): this { this.crop = [x, y, w, h]; return this; }
}

class StubContainer implements FloorContainer<StubImage> {
  children: StubImage[] = [];
  removeAllCalls: (boolean | undefined)[] = [];
  destroyed = false;
  depth = 0;
  setDepth(d: number): this { this.depth = d; return this; }
  add(child: StubImage): this { this.children.push(child); return this; }
  removeAll(destroyChild?: boolean): this {
    this.removeAllCalls.push(destroyChild);
    if (destroyChild) for (const c of this.children) c.destroyed = true;
    this.children = [];
    return this;
  }
  destroy(): void { this.destroyed = true; }
  get length(): number { return this.children.length; }
}

function stubScene(missing: string[] = []) {
  const containers: StubContainer[] = [];
  const textures = new Map<string, StubTexture>();
  const created: StubTexture[] = [];
  const events = new StubEmitter();
  const renderer = new StubEmitter();
  const scene: FloorScene<StubImage, StubTexture> = {
    events,
    renderer,
    add: {
      container: () => { const c = new StubContainer(); containers.push(c); return c; },
      image: (x, y, key) => new StubImage(x, y, key),
    },
    textures: {
      exists: (key) => !missing.includes(key),
      addDynamicTexture: (key, w, h) => {
        if (textures.has(key)) return null;
        const t = new StubTexture(key, w, h);
        textures.set(key, t);
        created.push(t);
        return t;
      },
    },
  };
  return { scene, containers, created, events, renderer, textureOf: (key: string) => textures.get(key) as StubTexture };
}

function layout(rows: number, cols: number, skirt: number): FloorLayout {
  const tiles = Array.from({ length: rows + 2 * skirt }, () => Array.from({ length: cols + 2 * skirt }, () => 'floor_base'));
  return { tiles, playable: { col0: skirt, row0: skirt, cols, rows } };
}

const ORIGIN = { x: 0, y: 0, width: 192, height: 192 };
type View = FloorView<StubImage, StubTexture>;
const stubContainer = (v: View) => v.container as StubContainer;

describe('FloorView', () => {
  it('construction fails fast naming the missing texture', () => {
    const { scene } = stubScene([FLOOR_TILE_KEYS.floor_worn]);
    expect(() => new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS)).toThrow(/floor_worn/);
  });

  it('creates its one container at construction, at the floor depth, before any rebuild (so CameraRig.attach sees it)', () => {
    const { scene, containers } = stubScene();
    const view = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    expect(containers).toHaveLength(1);
    expect(view.container).toBe(containers[0]);
    expect(containers[0].depth).toBe(-100000);
  });

  it('rebuild draws each planned chunk once into its own texture, shown by an image at the chunk, origin (0,0), half scale, cropped to its cell', () => {
    const { scene, textureOf } = stubScene();
    const view: View = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    const l = layout(19, 25, SKIRT_TILES);
    l.tiles[12][14] = 'floor_worn';
    view.rebuild(l);
    const expected = planFloorChunks(l, FLOOR_TILE_IDS, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_TEXTURE);
    const children = stubContainer(view).children;
    expect(children).toHaveLength(expected.chunks.length);
    expect(new Set(children.map((c) => c.key)).size).toBe(children.length);
    children.forEach((img, i) => {
      const plan = expected.chunks[i];
      const tex = textureOf(img.key);
      expect([img.x, img.y]).toEqual([plan.x, plan.y]);
      expect([tex.width, tex.height]).toEqual([plan.width, plan.height]);
      expect(img.origin).toEqual([0, 0]);
      expect(img.scale).toBe(0.5);
      expect(img.crop).toEqual([plan.crop.x, plan.crop.y, plan.crop.width, plan.crop.height]);
      expect(tex.batches).toBe(1);
      expect(tex.drawing).toBe(false);
      expect(tex.draws).toEqual(
        plan.stamps.map((s) => ({ key: FLOOR_TILE_KEYS[FLOOR_TILE_IDS[s.index]], frame: undefined, x: s.x, y: s.y, alpha: 1, tint: s.tint })),
      );
    });
    const keys = new Set(children.flatMap((img) => textureOf(img.key).draws.map((d) => d.key)));
    expect(keys).toEqual(new Set([FLOOR_TILE_KEYS.floor_base, FLOOR_TILE_KEYS.floor_worn]));
    // The darkened skirt reaches the chunks: some stamps are untinted, the darkest at the outer ring.
    const tints = children.flatMap((img) => textureOf(img.key).draws.map((d) => d.tint));
    expect(tints).toContain(0xffffff);
    expect(tints).toContain(0x666666);
  });

  it('rebuilding with the same chunk geometry (a new room) redraws the same textures without creating objects', () => {
    const { scene, containers, created } = stubScene();
    const view: View = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(19, 25, SKIRT_TILES));
    const firstChildren = [...stubContainer(view).children];
    const firstTextures = created.length;
    const other = layout(19, 25, SKIRT_TILES);
    other.tiles[5][5] = 'floor_a';
    view.rebuild(other);
    expect(created).toHaveLength(firstTextures);
    expect(stubContainer(view).children).toEqual(firstChildren);
    expect(containers).toHaveLength(1);
    expect(created.every((t) => !t.destroyed && t.clears === 2 && t.batches === 2 && !t.drawing)).toBe(true);
    // The redraw replaced the content: the new id is drawn somewhere, and no texture kept old draws on top.
    expect(created.some((t) => t.draws.some((d) => d.key === FLOOR_TILE_KEYS.floor_a))).toBe(true);
  });

  it('rebuilding with a different geometry destroys the old images and textures and leaves exactly the new chunks', () => {
    const { scene, containers, created } = stubScene();
    const view: View = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(19, 25, SKIRT_TILES));
    const old = [...created];
    const oldImages = [...stubContainer(view).children];
    view.rebuild(layout(3, 3, 0));
    expect(view.container.length).toBe(1);
    expect(containers).toHaveLength(1);
    expect(old.every((t) => t.destroyed)).toBe(true);
    expect(oldImages.every((img) => img.destroyed)).toBe(true);
    expect(created.filter((t) => !t.destroyed)).toHaveLength(1);
    expect(stubContainer(view).removeAllCalls.every((d) => d === true)).toBe(true);
  });

  it('an unknown tile id throws naming the id and leaves the previous floor in place', () => {
    const { scene, created } = stubScene();
    const view: View = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(3, 3, 0));
    const before = [...stubContainer(view).children];
    const draws = created.map((t) => [...t.draws]);
    const bad = layout(3, 3, 0);
    bad.tiles[1][1] = 'floor_lava';
    expect(() => view.rebuild(bad)).toThrow(/floor_lava/);
    expect(stubContainer(view).children).toEqual(before);
    expect(created.map((t) => t.draws)).toEqual(draws);
  });

  it('destroy removes the container and frees the chunk textures', () => {
    const { scene, created } = stubScene();
    const view: View = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(19, 25, SKIRT_TILES));
    view.destroy();
    expect(stubContainer(view).destroyed).toBe(true);
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((t) => t.destroyed)).toBe(true);
  });

  it('scene shutdown destroys every chunk texture exactly once, plus the images and the container', () => {
    const { scene, created, events, renderer } = stubScene();
    const view: View = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(19, 25, SKIRT_TILES));
    view.rebuild(layout(3, 3, 0)); // a geometry change in between: the first set is already freed
    const images = [...stubContainer(view).children];
    expect(renderer.count('restorewebgl')).toBe(1);
    events.emit('shutdown');
    expect(created.length).toBeGreaterThan(1);
    expect(created.map((t) => t.destroys)).toEqual(created.map(() => 1));
    expect(images.every((img) => img.destroyed)).toBe(true);
    expect(stubContainer(view).destroyed).toBe(true);
    expect(renderer.count('restorewebgl')).toBe(0);
    // A later scene destroy (game teardown) is harmless.
    events.emit('destroy');
    expect(created.map((t) => t.destroys)).toEqual(created.map(() => 1));
  });

  it('destroy twice is safe and frees each texture once', () => {
    const { scene, created } = stubScene();
    const view: View = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(19, 25, SKIRT_TILES));
    view.destroy();
    expect(() => view.destroy()).not.toThrow();
    expect(created.map((t) => t.destroys)).toEqual(created.map(() => 1));
  });

  it('rebuild after destroy throws a clear error and creates nothing', () => {
    const { scene, created, events } = stubScene();
    const view: View = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    events.emit('shutdown');
    expect(() => view.rebuild(layout(3, 3, 0))).toThrow(/after destroy/);
    expect(created).toHaveLength(0);
  });

  it('a WebGL context restore redraws the last layout into the same textures', () => {
    const { scene, created, renderer } = stubScene();
    const view: View = new FloorView(scene, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    renderer.emit('restorewebgl'); // nothing built yet: no-op
    expect(created).toHaveLength(0);
    const l = layout(19, 25, SKIRT_TILES);
    l.tiles[4][4] = 'floor_worn';
    view.rebuild(l);
    const before = created.map((t) => [...t.draws]);
    for (const t of created) t.draws = []; // what a context loss leaves: empty render targets
    renderer.emit('restorewebgl');
    expect(created.map((t) => t.draws)).toEqual(before);
    expect(created.every((t) => t.batches === 2 && !t.destroyed)).toBe(true);
  });

  it('works without a renderer slice (Canvas or tests): no restore hook', () => {
    const { scene } = stubScene();
    const noRenderer: FloorScene<StubImage, StubTexture> = { ...scene, renderer: undefined };
    const view: View = new FloorView(noRenderer, ORIGIN, GROUND_PROJECTION, FLOOR_TILE_IDS);
    view.rebuild(layout(3, 3, 0));
    expect(() => view.destroy()).not.toThrow();
  });

  it('camera bounds with SKIRT_TILES cover the viewport at MIN_ZOOM', () => {
    const b = worldCameraBounds(ARENA_BOUNDS, GROUND_PROJECTION, SKIRT_TILES);
    expect(b.width).toBeGreaterThanOrEqual(1280 / MIN_ZOOM);
    expect(b.height).toBeGreaterThanOrEqual(720 / MIN_ZOOM);
  });
});
