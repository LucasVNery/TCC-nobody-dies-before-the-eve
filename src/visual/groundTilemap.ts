// src/visual/groundTilemap.ts
import type Phaser from 'phaser';
import type { AABB } from '../combat/types';
import { ASSET_KEYS } from './assetRegistry';

export function createGroundTilemap(
  scene: Phaser.Scene,
  bounds: AABB,
  tileSize: number,
): Phaser.Tilemaps.TilemapLayer {
  const widthInTiles = Math.ceil(bounds.width / tileSize);
  const heightInTiles = Math.ceil(bounds.height / tileSize);

  const tilemap = scene.make.tilemap({
    tileWidth: tileSize,
    tileHeight: tileSize,
    width: widthInTiles,
    height: heightInTiles,
  });

  const tileset = tilemap.addTilesetImage(ASSET_KEYS.ground, ASSET_KEYS.ground, tileSize, tileSize);
  if (!tileset) {
    throw new Error(`Failed to load tileset for key "${ASSET_KEYS.ground}"`);
  }

  const layer = tilemap.createBlankLayer('ground', tileset, bounds.x, bounds.y);
  if (!layer) {
    throw new Error('Failed to create ground tilemap layer');
  }

  layer.fill(0);
  layer.setDepth(-1);
  return layer;
}
