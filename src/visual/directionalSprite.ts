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
 * provable fact from the render script, not a guess. ROW_ROTATION_OFFSET
 * below is the still-empirical part: which of the 8 rows is Blender-world
 * azimuth 0 doesn't necessarily line up with directionBucket's "east" (0)
 * without checking the actual rendered image against real gameplay
 * movement — adjust this single constant (0-7) if Task 9's visual check
 * shows the sprite facing 90/180/etc degrees off from the movement
 * direction; do not change the flip math above, which is independent of it.
 */
const ROW_ROTATION_OFFSET = 0;

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
