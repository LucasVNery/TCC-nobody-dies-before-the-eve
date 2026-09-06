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

export function fromScreen(delta: Vec2, config: IsoConfig): Vec2 {
  const col = (delta.x / config.halfWidth + delta.y / config.halfHeight) / 2;
  const row = (delta.y / config.halfHeight - delta.x / config.halfWidth) / 2;
  return {
    x: col * config.tileWorldSize,
    y: row * config.tileWorldSize,
  };
}

export function screenDepth(pos: Vec2, _config: IsoConfig): number {
  return pos.x + pos.y;
}
