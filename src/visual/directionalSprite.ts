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
 * to the sprite sheet's actual row.
 *
 * **image_row_from_top(render_direction) == render_direction, directly, no
 * reversal.** This was the actual bug behind three straight miscalibrations
 * (2026-09-07 through 2026-09-13): every earlier version of this function
 * (and its doc comment) assumed `render_character.py`'s compose step writes
 * render direction `d` to image row `(DIRECTION_COUNT-1-d)` — i.e. reversed
 * top-to-bottom — and built a `DIRECTION_COUNT-1-rotated` flip into this
 * function to match. That assumption was wrong. Re-derived directly from
 * `compose_sheet()`: `row_from_bottom = (DIRECTIONS-1)-direction` is a count
 * of rows *up from the bottom of the final saved PNG* (Blender's
 * `image.pixels` array is bottom-up, and pixel-array row index 0 always
 * lands at the bottom of whatever gets saved to disk) — converting that
 * "from bottom" count to a normal "from top" row index requires a SECOND
 * `(DIRECTION_COUNT-1) - row_from_bottom` flip, which cancels the first
 * one out: `(D-1) - ((D-1)-d) == d`. Confirmed empirically too, independent
 * of that derivation: the composited `idle.png` row unambiguously showing
 * the character's back (bare cape, zero face — no room for misjudgment)
 * is row 2, and the individual per-direction render at azimuth 90°
 * (render direction 2) is *also* the unambiguous back view — same index,
 * no flip between them.
 *
 * A `DIRECTION_COUNT-1-X` reversal happens to preserve any single
 * antipodal pair's own front/back symmetry (which is why the front/back
 * axis kept looking approximately plausible across every wrong version of
 * this code) while silently swapping which *pair* of opposite rows lines
 * up with which screen axis — which is why every previous calibration
 * attempt (offsets 6, then 7) still showed the character facing screen-
 * right when the mouse was on the left. Removing the reversal and rotating
 * directly fixes it for every axis at once, not just front/back.
 *
 * ROW_ROTATION_OFFSET = 4, derived 2026-09-13 with a deterministic method
 * (no pixel-judgment): a one-off Blender script projected the character's
 * own world-space forward vector into each camera's screen space, and
 * separately, 512px renders of the 4 cardinal render directions were
 * visually inspected directly (not through the composited sheet) to
 * confirm render direction 0 = character facing screen-left, direction 4 =
 * screen-right, direction 2 = back, direction 6 = front, with zero room
 * for misjudgment at that resolution. Solving `(bucket + OFFSET) % 8 ==
 * render_direction` for all four cardinal buckets gives OFFSET = 4
 * consistently, and the four diagonal buckets check out too.
 *
 * Re-verify this (both the offset AND the no-reversal formula shape) if
 * `render_character.py`'s camera azimuth convention or `compose_sheet()`'s
 * row-write logic ever changes — see tools/blender/README.md's
 * "Direction-row convention" section for the full history.
 */
const ROW_ROTATION_OFFSET = 4;

function spriteRowForDirection(bucket: number): number {
  return (bucket + ROW_ROTATION_OFFSET) % DIRECTION_COUNT;
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
