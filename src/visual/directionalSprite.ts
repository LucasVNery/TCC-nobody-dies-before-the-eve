import type Phaser from 'phaser';
import type { Vec2 } from '../combat/types';
import { ASSET_KEYS } from './assetRegistry';
import { toScreen, screenDepth, type IsoConfig } from './isometricProjection';

export class DirectionalSprite {
  private readonly container: Phaser.GameObjects.Container;
  private readonly base: Phaser.GameObjects.Image;
  private readonly arrow: Phaser.GameObjects.Image;
  private readonly config: IsoConfig;

  constructor(
    scene: Phaser.Scene,
    baseTextureKey: string,
    width: number,
    height: number,
    initialPosition: Vec2,
    config: IsoConfig,
  ) {
    this.config = config;
    this.base = scene.add.image(width / 2, height / 2, baseTextureKey).setOrigin(0.5, 0.5);
    this.arrow = scene.add
      .image(width / 2, height / 2, ASSET_KEYS.directionArrow)
      .setOrigin(0, 0.5);
    const initialScreenPos = toScreen(initialPosition, config);
    this.container = scene.add.container(initialScreenPos.x, initialScreenPos.y, [this.base, this.arrow]);
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

  syncDirection(dir: Vec2): void {
    this.arrow.setRotation(Math.atan2(dir.y, dir.x));
  }

  setTint(color: number): void {
    this.base.setTint(color);
  }
}
