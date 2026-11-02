import { describe, expect, it } from 'vitest';
import { advanceMult, barrageParams, dashCooldownMs } from './responses';
import { BOSS_CONFIG } from './bossConfig';
import { MAX_DODGE_COOLDOWN_MS } from '../combat/playerController';

describe('barrageParams', () => {
  it('has anchor values at 0, 0.6 and 1', () => {
    expect(barrageParams(0)).toEqual({ chance: 0, durationMult: 1 });
    expect(barrageParams(0.6)).toEqual({ chance: 0.5, durationMult: 1 });
    expect(barrageParams(1)).toEqual({ chance: 0.5, durationMult: 1.5 });
  });
  it('interpolates linearly', () => {
    expect(barrageParams(0.3).chance).toBeCloseTo(0.25);
    expect(barrageParams(0.8).durationMult).toBeCloseTo(1.25);
  });
  it('clamps the level', () => {
    for (let l = -1; l <= 2; l += 0.1) expect(barrageParams(l).chance).toBeLessThanOrEqual(0.5);
  });
});

describe('advanceMult', () => {
  it('spans 1..1.4, monotonic and clamped', () => {
    expect(advanceMult(0)).toBe(1);
    expect(advanceMult(1)).toBeCloseTo(1.4);
    expect(advanceMult(0.7)).toBeGreaterThan(advanceMult(0.3));
    expect(advanceMult(-3)).toBe(1);
    expect(advanceMult(9)).toBeCloseTo(1.4);
  });
});

describe('dashCooldownMs', () => {
  it('spans 2500..4000 and never exceeds the max', () => {
    expect(dashCooldownMs(0)).toBe(2500);
    expect(dashCooldownMs(1)).toBe(4000);
    expect(dashCooldownMs(5)).toBeLessThanOrEqual(4000);
  });

  it("the player's clamp equals the boss cap, so the logged dash_cooldown_ms is never silently clamped", () => {
    expect(MAX_DODGE_COOLDOWN_MS).toBe(BOSS_CONFIG.dashCooldownMaxMs);
    expect(dashCooldownMs(1)).toBe(MAX_DODGE_COOLDOWN_MS);
  });
});
