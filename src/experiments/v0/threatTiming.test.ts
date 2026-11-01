import { describe, it, expect } from 'vitest';
import { strikeDelayMs } from './threatTiming';

describe('strikeDelayMs', () => {
  it('melee patterns: the telegraph alone (swing 450, combo 450 then 320, slam 700)', () => {
    expect(strikeDelayMs({ kind: 'swing' }, 40)).toBe(450);
    expect(strikeDelayMs({ kind: 'combo', hit: 1 }, 40)).toBe(450);
    expect(strikeDelayMs({ kind: 'combo', hit: 2 }, 40)).toBe(320);
    expect(strikeDelayMs({ kind: 'slam' }, 40)).toBe(700);
  });

  it('a lunge adds the travel from the aim lock to contact distance (60 u) at 450 u/s', () => {
    // 500 + (200 - 60) / 450 * 1000 = 811.1
    expect(strikeDelayMs({ kind: 'lunge' }, 200)).toBeCloseTo(500 + (140 / 450) * 1000, 6);
    expect(strikeDelayMs({ kind: 'lunge' }, 200)).toBeCloseTo(811.1, 1);
    // exactly at LUNGE.maxDistance it is still the short lunge
    expect(strikeDelayMs({ kind: 'lunge' }, 260)).toBeCloseTo(500 + (200 / 450) * 1000, 6);
  });

  it('a lunge seen beyond 260 u is the long charge: 650 ms telegraph plus the travel', () => {
    // 650 + (400 - 60) / 450 * 1000 = 1405.6
    expect(strikeDelayMs({ kind: 'lunge' }, 400)).toBeCloseTo(650 + (340 / 450) * 1000, 6);
    expect(strikeDelayMs({ kind: 'lunge' }, 400)).toBeCloseTo(1405.6, 1);
  });

  it('within contact distance (<= 60 u) no travel is added', () => {
    expect(strikeDelayMs({ kind: 'lunge' }, 60)).toBe(500);
    expect(strikeDelayMs({ kind: 'lunge' }, 10)).toBe(500);
    expect(strikeDelayMs({ kind: 'lunge' }, 0)).toBe(500);
  });
});
