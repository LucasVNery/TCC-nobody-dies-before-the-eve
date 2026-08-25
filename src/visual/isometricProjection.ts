import type { Vec2 } from '../combat/types';

export interface IsoConfig {
  tileWorldSize: number;
  halfWidth: number;
  halfHeight: number;
}

export function toScreen(pos: Vec2, config: IsoConfig): Vec2 {
  const col = pos.x / config.tileWorldSize;
  const row = pos.y / config.tileWorldSize;
  return {
    x: (col - row) * config.halfWidth,
    y: (col + row) * config.halfHeight,
  };
}

export function screenDepth(pos: Vec2, _config: IsoConfig): number {
  return pos.x + pos.y;
}
