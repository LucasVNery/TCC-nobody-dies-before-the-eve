// Draws the procedural floor (playable rectangle plus darkened skirt) pre-rendered into a
// few dozen dynamic-texture chunks at the tiles' native resolution, so a frame costs one
// quad per chunk instead of one per cell. The chunk images live in one container created
// at construction (before CameraRig.attach, so the UI camera ignores it). A rebuild with
// the same chunk geometry (every room of the game) clears and redraws the same textures;
// otherwise it replaces them. The textures live in the game-wide texture manager, so the
// view frees them itself on scene shutdown/destroy, and redraws the last layout after a
// WebGL context restore (which empties render targets). Structural scene slice, no
// Phaser import, so it runs against a stub in tests.
import type { AABB } from '../../combat/types';
import type { GroundProjection } from '../../visual/groundProjection';
import { FLOOR_TILE_KEYS, FLOOR_TILE_TEXTURE } from '../../visual/floor/floorAssets';
import type { FloorLayout } from '../../visual/floor/composeFloor';
import { planFloorChunks, type FloorChunk } from '../../visual/floor/floorChunks';

const FLOOR_DEPTH_BASE = -100000;

/** The slice of a Phaser DynamicTexture the floor draws into. */
export interface FloorChunkTexture {
  readonly key: string;
  clear(): unknown;
  beginDraw(): unknown;
  batchDrawFrame(key: string, frame?: string | number, x?: number, y?: number, alpha?: number, tint?: number): unknown;
  endDraw(): unknown;
  destroy(): unknown;
}

/** The slice of a Phaser Image that shows one chunk. */
export interface FloorChunkImage {
  setOrigin(x: number, y: number): unknown;
  setScale(s: number): unknown;
  setCrop(x: number, y: number, width: number, height: number): unknown;
}

/** I is the concrete image type, so a Phaser container (whose add wants a GameObject) satisfies it. */
export interface FloorContainer<I extends FloorChunkImage = FloorChunkImage> {
  add(child: I): unknown;
  removeAll(destroyChild?: boolean): unknown;
  setDepth(d: number): unknown;
  destroy(): unknown;
  readonly length: number;
}

export interface FloorScene<I extends FloorChunkImage = FloorChunkImage, T extends FloorChunkTexture = FloorChunkTexture> {
  add: { container(x: number, y: number): FloorContainer<I>; image(x: number, y: number, key: string): I };
  textures: { exists(key: string): boolean; addDynamicTexture(key: string, width: number, height: number): T | null };
  /** Scene lifecycle: the chunk textures live in the game-wide texture manager, so they are freed on shutdown. */
  events: { once(event: string, fn: () => void): unknown };
  /** WebGL renderer events (absent or inert under Canvas): a context restore empties every render target. */
  renderer?: { on(event: string, fn: () => void): unknown; off(event: string, fn: () => void): unknown };
}

/** Phaser.Scenes.Events.SHUTDOWN / DESTROY and Phaser.Renderer.Events.RESTORE_WEBGL (no Phaser import here). */
export const SCENE_SHUTDOWN_EVENT = 'shutdown';
export const SCENE_DESTROY_EVENT = 'destroy';
export const RESTORE_WEBGL_EVENT = 'restorewebgl';

let chunkSeq = 0;

export class FloorView<I extends FloorChunkImage = FloorChunkImage, T extends FloorChunkTexture = FloorChunkTexture> {
  readonly container: FloorContainer<I>;
  private readonly keys: string[];
  private chunks: { geometry: string; texture: T }[] = [];
  private lastLayout: FloorLayout | null = null;
  private destroyed = false;
  private readonly onRestore = (): void => {
    if (this.destroyed || !this.lastLayout) return;
    try {
      this.rebuild(this.lastLayout);
    } catch (err) {
      console.warn('[floor] failed to redraw after a WebGL context restore', err);
    }
  };

  constructor(
    private readonly scene: FloorScene<I, T>,
    private readonly bounds: AABB,
    private readonly projection: GroundProjection,
    private readonly tileIds: readonly string[],
  ) {
    this.keys = tileIds.map((id) => {
      const key = FLOOR_TILE_KEYS[id] ?? `floor:${id}`;
      if (!scene.textures.exists(key)) throw new Error(`FloorView: missing floor texture "${key}" (tile ${id})`);
      return key;
    });
    this.container = scene.add.container(0, 0);
    this.container.setDepth(FLOOR_DEPTH_BASE); // below every sprite (depth = world x + y >= 0)
    scene.events.once(SCENE_SHUTDOWN_EVENT, () => this.destroy());
    scene.events.once(SCENE_DESTROY_EVENT, () => this.destroy());
    scene.renderer?.on(RESTORE_WEBGL_EVENT, this.onRestore);
  }

  rebuild(layout: FloorLayout): void {
    if (this.destroyed) throw new Error('FloorView: rebuild after destroy');
    // Plan first: an unknown id throws here and leaves the current floor in place.
    const plan = planFloorChunks(layout, this.tileIds, this.bounds, this.projection, FLOOR_TILE_TEXTURE);
    this.lastLayout = layout;
    const geometry = plan.chunks.map(geometryOf);
    const reuse = geometry.length === this.chunks.length && geometry.every((g, i) => g === this.chunks[i].geometry);
    if (!reuse) {
      this.releaseChunks();
      plan.chunks.forEach((chunk, i) => {
        const key = `floor:chunk:${chunkSeq++}`;
        const texture = this.scene.textures.addDynamicTexture(key, chunk.width, chunk.height);
        if (!texture) throw new Error(`FloorView: could not create floor chunk texture "${key}"`);
        this.chunks.push({ geometry: geometry[i], texture }); // tracked at once, so a later failure still frees it
        const img = this.scene.add.image(chunk.x, chunk.y, key);
        img.setOrigin(0, 0);
        img.setScale(plan.scale);
        img.setCrop(chunk.crop.x, chunk.crop.y, chunk.crop.width, chunk.crop.height);
        this.container.add(img);
      });
    }
    plan.chunks.forEach((chunk, i) => {
      const t = this.chunks[i].texture;
      t.clear();
      t.beginDraw();
      for (const s of chunk.stamps) t.batchDrawFrame(this.keys[s.index], undefined, s.x, s.y, 1, s.tint);
      t.endDraw();
    });
  }

  /** Frees every chunk image and texture and the container. Idempotent; also runs on scene shutdown/destroy. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.renderer?.off(RESTORE_WEBGL_EVENT, this.onRestore);
    this.releaseChunks();
    this.container.destroy();
    this.lastLayout = null;
  }

  private releaseChunks(): void {
    this.container.removeAll(true); // images first, then the textures they show
    for (const c of this.chunks) c.texture.destroy();
    this.chunks = [];
  }
}

function geometryOf(c: FloorChunk): string {
  return `${c.x},${c.y},${c.width},${c.height},${c.crop.x},${c.crop.y},${c.crop.width},${c.crop.height}`;
}
