// src/visual/groundTilemap.ts
import type Phaser from 'phaser';
import type { AABB, Vec2 } from '../combat/types';
import { ASSET_KEYS } from './assetRegistry';
import { toScreen, type IsoConfig } from './isometricProjection';

const GROUND_DEPTH_BASE = -100000;

export function createGroundTilemap(scene: Phaser.Scene, bounds: AABB, config: IsoConfig): void {
  const widthInTiles = Math.ceil(bounds.width / config.tileWorldSize);
  const heightInTiles = Math.ceil(bounds.height / config.tileWorldSize);
  const tileDisplaySize = config.halfWidth * 2;

  for (let row = 0; row < heightInTiles; row++) {
    for (let col = 0; col < widthInTiles; col++) {
      const onEdge = row === 0 || row === heightInTiles - 1 || col === 0 || col === widthInTiles - 1;
      const textureKey = onEdge ? ASSET_KEYS.groundWater : ASSET_KEYS.groundGrass;

      const worldPos: Vec2 = {
        x: bounds.x + col * config.tileWorldSize,
        y: bounds.y + row * config.tileWorldSize,
      };
      const screenPos = toScreen(worldPos, config);

      const tile = scene.add.image(screenPos.x, screenPos.y, textureKey);
      tile.setDisplaySize(tileDisplaySize, tileDisplaySize);
      tile.setDepth(GROUND_DEPTH_BASE + row + col);
    }
  }
}
