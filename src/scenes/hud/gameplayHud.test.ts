import { describe, it, expect } from 'vitest';
import { staminaBar } from './gameplayHud';

describe('staminaBar', () => {
  it('150 of 150 is a full 15-cell bar', () => {
    expect(staminaBar(150)).toBe(`[${'#'.repeat(15)}]`);
  });
  it('0 is empty', () => {
    expect(staminaBar(0)).toBe(`[${'-'.repeat(15)}]`);
  });
  it('75 is about half (ceil: 7.5 -> 8 cells)', () => {
    expect(staminaBar(75)).toBe(`[${'#'.repeat(8)}${'-'.repeat(7)}]`);
  });
  it('a tiny positive value shows one cell, not a full bar; a drop below max is not full', () => {
    expect(staminaBar(0.1)).toBe(`[#${'-'.repeat(14)}]`);
    expect(staminaBar(138)).toBe(`[${'#'.repeat(14)}-]`);
  });
  it('clamps above max and below zero', () => {
    expect(staminaBar(999)).toBe(`[${'#'.repeat(15)}]`);
    expect(staminaBar(-5)).toBe(`[${'-'.repeat(15)}]`);
  });
});
