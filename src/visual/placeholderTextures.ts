import type Phaser from 'phaser';
import { ASSET_KEYS } from './assetRegistry';

export const GROUND_TILE_SIZE = 64;
const ENTITY_SIZE = 20;
const DIRECTION_ARROW_SIZE = 10;

export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  generateSquareTexture(scene, ASSET_KEYS.player, ENTITY_SIZE, 0x4caf50);
  generateSquareTexture(scene, ASSET_KEYS.assaltante, ENTITY_SIZE, 0xf44336);
  generateSquareTexture(scene, ASSET_KEYS.ground, GROUND_TILE_SIZE, 0x2b2b2b);
  generateArrowTexture(scene, ASSET_KEYS.directionArrow, DIRECTION_ARROW_SIZE);
}

function generateSquareTexture(scene: Phaser.Scene, key: string, size: number, color: number): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(color, 1);
  graphics.fillRect(0, 0, size, size);
  graphics.generateTexture(key, size, size);
  graphics.destroy();
}

function generateArrowTexture(scene: Phaser.Scene, key: string, size: number): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(0xffffff, 1);
  graphics.fillTriangle(0, 0, 0, size, size, size / 2);
  graphics.generateTexture(key, size, size);
  graphics.destroy();
}
