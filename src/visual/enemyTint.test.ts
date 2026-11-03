import { describe, expect, it } from 'vitest';
import { BOSS_BASE_TINT, enemyTint } from './enemyTint';

describe('enemyTint', () => {
  it('swing telegraph is orange', () => {
    expect(enemyTint({ lunge: null, attacking: true, boss: false })).toBe(0xff9800);
  });
  it('lunge preparing is cyan, in progress is red', () => {
    expect(enemyTint({ lunge: 'telegraph', attacking: false, boss: false })).toBe(0x00bcd4);
    expect(enemyTint({ lunge: 'charge', attacking: false, boss: false })).toBe(0xf44336);
  });
  it('boss without telegraph uses the base tint', () => {
    expect(enemyTint({ lunge: null, attacking: false, boss: true })).toBe(BOSS_BASE_TINT);
  });
  it('boss with a telegraph keeps the telegraph colour', () => {
    expect(enemyTint({ lunge: null, attacking: true, boss: true })).toBe(0xff9800);
    expect(enemyTint({ lunge: 'telegraph', attacking: false, boss: true })).toBe(0x00bcd4);
    expect(enemyTint({ lunge: 'charge', attacking: true, boss: true })).toBe(0xf44336);
  });
  it('ordinary enemy without telegraph is white', () => {
    expect(enemyTint({ lunge: null, attacking: false, boss: false })).toBe(0xffffff);
  });
});
