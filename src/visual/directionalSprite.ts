import type Phaser from 'phaser';
import type { Vec2 } from '../combat/types';
import { toScreen, screenDepth, type IsoConfig } from './isometricProjection';
import { directionBucket, DIRECTION_COUNT } from './spriteDirection';

export interface DirectionalSpriteTextures {
  idleTextureKey: string;
  walkTextureKey: string;
  walkFrameCount: number;
}

/**
 * Maps a directionBucket() index (0=east, clockwise, per spriteDirection.ts)
 * to the sprite sheet's actual row. tools/blender/render_character.py's
 * compose step writes direction d to image row (DIRECTION_COUNT-1-d) from
 * the top (Blender's pixel buffer origin is bottom-left, so the composer
 * flips vertically to land in a normal top-down PNG) — that part is a known,
 * provable fact from the render script, not a guess. ROW_ROTATION_OFFSET is
 * the empirical part: which of the 8 rendered rows lines up with
 * directionBucket's "east" (0) doesn't follow from the flip math alone.
 * Calibrated 2026-09-07 by pausing the scene and driving syncDirection()
 * directly for all 4 cardinal directions, screenshotting each: offset 6
 * makes south (0,1) show the front of the character, north (0,-1) the
 * back, and east/west mirror each other — confirmed correct and
 * consistent, not just "one direction looks okay". Re-verify this if the
 * render pipeline's camera azimuth convention
 * (tools/blender/render_character.py) ever changes.
 */
const ROW_ROTATION_OFFSET = 6;

function spriteRowForDirection(bucket: number): number {
  const rotated = (bucket + ROW_ROTATION_OFFSET) % DIRECTION_COUNT;
  return DIRECTION_COUNT - 1 - rotated;
}

export class DirectionalSprite {
  private readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly config: IsoConfig;
  private readonly textures: DirectionalSpriteTextures;
  private readonly scene: Phaser.Scene;
  private currentAnimKey = '';

  constructor(
    scene: Phaser.Scene,
    textures: DirectionalSpriteTextures,
    width: number,
    height: number,
    initialPosition: Vec2,
    config: IsoConfig,
  ) {
    this.scene = scene;
    this.config = config;
    this.textures = textures;
    this.registerAnimations();

    const centerOffset = toScreen({ x: width / 2, y: height / 2 }, config);
    this.sprite = scene.add.sprite(centerOffset.x, centerOffset.y, textures.idleTextureKey).setOrigin(0.5, 0.5);
    // The rendered sprite sheet's per-frame size is whatever the Blender
    // pipeline produced (currently 128x128, see tools/blender/README.md) —
    // not necessarily the game's placeholder-era visual size. Scale
    // uniformly by height so the character reads at a consistent size
    // against the tile grid, regardless of the source frame's raw pixels.
    const scale = height / this.sprite.height;
    this.sprite.setScale(scale);
    const initialScreenPos = toScreen(initialPosition, config);
    this.container = scene.add.container(initialScreenPos.x, initialScreenPos.y, [this.sprite]);
    this.container.setDepth(screenDepth(initialPosition, config));
  }

  get gameObject(): Phaser.GameObjects.Container {
    return this.container;
  }

  syncPosition(pos: Vec2): void {
    const screenPos = toScreen(pos, this.config);
    this.container.setPosition(screenPos.x, screenPos.y);
    this.container.setDepth(screenDepth(pos, this.config));
  }

  syncDirection(dir: Vec2, isMoving: boolean): void {
    // toScreen is linear (no additive offset), so projecting a direction
    // vector directly gives the correct on-screen angle.
    const screenDir = toScreen(dir, this.config);
    const row = spriteRowForDirection(directionBucket(screenDir));
    const animKey = `${isMoving ? this.textures.walkTextureKey : this.textures.idleTextureKey}_${row}`;
    if (animKey !== this.currentAnimKey) {
      this.sprite.play(animKey);
      this.currentAnimKey = animKey;
    }
  }

  setTint(color: number): void {
    this.sprite.setTint(color);
  }

  private registerAnimations(): void {
    for (let row = 0; row < DIRECTION_COUNT; row++) {
      const idleKey = `${this.textures.idleTextureKey}_${row}`;
      if (!this.scene.anims.exists(idleKey)) {
        this.scene.anims.create({
          key: idleKey,
          frames: this.scene.anims.generateFrameNumbers(this.textures.idleTextureKey, {
            start: row,
            end: row,
          }),
          frameRate: 1,
          repeat: -1,
        });
      }

      const walkKey = `${this.textures.walkTextureKey}_${row}`;
      if (!this.scene.anims.exists(walkKey)) {
        this.scene.anims.create({
          key: walkKey,
          frames: this.scene.anims.generateFrameNumbers(this.textures.walkTextureKey, {
            start: row * this.textures.walkFrameCount,
            end: row * this.textures.walkFrameCount + (this.textures.walkFrameCount - 1),
          }),
          frameRate: 8,
          repeat: -1,
        });
      }
    }
  }
}
