import { describe, it, expect } from 'vitest';
import { shakeFor, telegraphFill, SHAKE_PX, SHAKE_DECAY_MS, FLASH_MS, DAMAGE_NUMBER_MS } from './feedbackDefs';

describe('feedbackDefs', () => {
  it('pins the constants', () => {
    expect(SHAKE_PX).toEqual({ light: 4, heavy: 9 });
    expect(SHAKE_DECAY_MS).toBe(250);
    expect(FLASH_MS).toBe(100);
    expect(DAMAGE_NUMBER_MS).toBe(700);
  });

  it('shakeFor maps the hit kind to amplitude and decay', () => {
    expect(shakeFor('light')).toEqual({ px: 4, decayMs: 250 });
    expect(shakeFor('heavy')).toEqual({ px: 9, decayMs: 250 });
  });

  it('telegraphFill clamps to 0..1', () => {
    expect(telegraphFill(-0.5)).toBe(0);
    expect(telegraphFill(0)).toBe(0);
    expect(telegraphFill(0.4)).toBe(0.4);
    expect(telegraphFill(1)).toBe(1);
    expect(telegraphFill(3)).toBe(1);
    expect(telegraphFill(Number.NaN)).toBe(0);
  });
});
