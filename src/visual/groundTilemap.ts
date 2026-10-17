// src/visual/groundTilemap.ts
// Temporary: lays the old square placeholder tiles on the screen-aligned
// projection grid so the arena stays visible until the Blender tile arena
// replaces this file (E2 Task 8).
import type Phaser from 'phaser';
import type { AABB, Vec2 } from '../combat/types';
import { ASSET_KEYS } from './assetRegistry';
import { toScreen, type GroundProjection } from './groundProjection';

const GROUND_DEPTH_BASE = -100000;

export function createGroundTilemap(scene: Phaser.Scene, bounds: AABB, config: GroundProjection): void {
  const widthInTiles = Math.ceil(bounds.width / config.tileWorldSize);
  const heightInTiles = Math.ceil(bounds.height / config.tileWorldSize);
  const origin = toScreen({ x: bounds.x, y: bounds.y }, config);

  for (let row = 0; row < heightInTiles; row++) {
    for (let col = 0; col < widthInTiles; col++) {
      const onEdge = row === 0 || row === heightInTiles - 1 || col === 0 || col === widthInTiles - 1;
      const textureKey = onEdge ? ASSET_KEYS.groundWater : ASSET_KEYS.groundGrass;

      const screenPos: Vec2 = {
        x: origin.x + col * config.tileScreenWidth,
        y: origin.y + row * config.tileScreenHeight,
      };

      const tile = scene.add.image(screenPos.x, screenPos.y, textureKey);
      tile.setOrigin(0, 0);
      tile.setDisplaySize(config.tileScreenWidth, config.tileScreenHeight);
      tile.setDepth(GROUND_DEPTH_BASE + row);
    }
  }
}
