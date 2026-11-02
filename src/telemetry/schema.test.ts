import { describe, it, expect } from 'vitest';
import { GAME_VERSION, CONFIG_VERSION, windowsMs } from './schema';
import { DODGE } from '../combat/actionDefs';

describe('dash cooldown and versions', () => {
  it('uses a 2.5 s base dash cooldown', () => {
    expect(DODGE.cooldownMs).toBe(2500);
    expect(windowsMs().dodge_cooldown).toBe(2500);
  });
  it('carries the 0.0.6 versions', () => {
    expect(GAME_VERSION).toBe('0.0.6');
    expect(CONFIG_VERSION).toBe('0.0.6-c1');
  });
});
