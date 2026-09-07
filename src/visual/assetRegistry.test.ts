import { describe, it, expect } from 'vitest';
import { ASSET_KEYS } from './assetRegistry';

describe('ASSET_KEYS', () => {
  it('defines a unique texture key for every visual role', () => {
    const keys = Object.values(ASSET_KEYS);
    expect(keys).toEqual([
      'player_idle',
      'player_walk',
      'assaltante_idle',
      'assaltante_walk',
      'ground_grass',
      'ground_water',
      'placeholder_direction_arrow',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
