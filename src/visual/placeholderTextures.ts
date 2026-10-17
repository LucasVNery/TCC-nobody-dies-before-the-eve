import type Phaser from 'phaser';
import { ASSET_KEYS } from './assetRegistry';

export { GROUND_TILE_SIZE } from './groundProjection';
export const ENTITY_SIZE = 20; // hurtbox/collision size — combat's AABB, unrelated to how big the sprite draws
export const ENTITY_VISUAL_WIDTH = 20;
// Taller than wide — standing-character silhouette, purely visual. 40 (was 32)
// makes the character read better against the 64x48 tiles without drawing it
// much larger than its 20-unit hurtbox (hits "outside the body" confuse reads).
export const ENTITY_VISUAL_HEIGHT = 40;
// Long enough that the tip clears the entity's half-extent in every
// direction (max(width, height) / 2 = 16) and still reads as "poking out",
// not "painted over the block".
const DIRECTION_ARROW_SIZE = 20;
const DIRECTION_ARROW_COLOR = 0xffeb3b; // bright yellow — readable over both blue and red

export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  generateArrowTexture(scene, ASSET_KEYS.directionArrow, DIRECTION_ARROW_SIZE, DIRECTION_ARROW_COLOR);
}

function generateRectTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  fillColor: number,
  strokeColor: number,
): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(fillColor, 1);
  graphics.fillRect(0, 0, width, height);
  graphics.lineStyle(2, strokeColor, 1);
  graphics.strokeRect(1, 1, width - 2, height - 2);
  graphics.generateTexture(key, width, height);
  graphics.destroy();
}

function generateArrowTexture(scene: Phaser.Scene, key: string, size: number, color: number): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(color, 1);
  graphics.fillTriangle(0, 0, 0, size, size, size / 2);
  graphics.lineStyle(1, 0x000000, 0.6);
  graphics.strokeTriangle(0, 0, 0, size, size, size / 2);
  graphics.generateTexture(key, size, size);
  graphics.destroy();
}
