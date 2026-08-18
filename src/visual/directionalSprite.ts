import type Phaser from 'phaser';
import type { Vec2 } from '../combat/types';
import { ASSET_KEYS } from './assetRegistry';

export class DirectionalSprite {
  private readonly container: Phaser.GameObjects.Container;
  private readonly base: Phaser.GameObjects.Image;
  private readonly arrow: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    baseTextureKey: string,
    width: number,
    height: number,
    initialPosition: Vec2,
  ) {
    this.base = scene.add.image(width / 2, height / 2, baseTextureKey).setOrigin(0.5, 0.5);
    this.arrow = scene.add
      .image(width / 2, height / 2, ASSET_KEYS.directionArrow)
      .setOrigin(0, 0.5);
    this.container = scene.add.container(initialPosition.x, initialPosition.y, [this.base, this.arrow]);
  }

  get gameObject(): Phaser.GameObjects.Container {
    return this.container;
  }

  syncPosition(pos: Vec2): void {
    this.container.setPosition(pos.x, pos.y);
    this.container.setDepth(pos.y);
  }

  syncDirection(dir: Vec2): void {
    this.arrow.setRotation(Math.atan2(dir.y, dir.x));
  }

  setTint(color: number): void {
    this.base.setTint(color);
  }
}
