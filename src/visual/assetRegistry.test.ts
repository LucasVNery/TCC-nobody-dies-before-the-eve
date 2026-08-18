import { describe, it, expect } from 'vitest';
import { ASSET_KEYS } from './assetRegistry';

describe('ASSET_KEYS', () => {
  it('defines a unique texture key for every visual role', () => {
    const keys = Object.values(ASSET_KEYS);
    expect(keys).toEqual([
      'placeholder_player',
      'placeholder_assaltante',
      'placeholder_ground_tile',
      'placeholder_direction_arrow',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
