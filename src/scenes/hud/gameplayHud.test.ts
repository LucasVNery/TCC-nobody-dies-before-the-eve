import { describe, it, expect } from 'vitest';
import { staminaBar, encounterLine, runTag, statusLine, HELP_LINES } from './gameplayHud';

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

describe('encounterLine', () => {
  const m = { room: 1, enc: 1, encTotal: 2 };
  it('regular rooms show encontro (room) and inimigo (encounter)', () => {
    expect(encounterLine({ ...m, bossRoom: false })).toBe('ENCONTRO 1 · INIMIGO 1/2');
    expect(encounterLine(m)).toBe('ENCONTRO 1 · INIMIGO 1/2');
  });
  it('the boss room reads BOSS ROOM', () => {
    expect(encounterLine({ ...m, bossRoom: true })).toBe('BOSS ROOM');
  });
});

describe('runTag', () => {
  it('prefixes the run number', () => {
    expect(runTag(3)).toBe('run 3');
  });
});

describe('statusLine', () => {
  const m = { hp: 100, maxHp: 120, enemyHp: 400, enemyMaxHp: 400 };
  it('shows player and enemy HP outside the boss room', () => {
    expect(statusLine(m)).toBe('HP: 100/120 · inimigo: 400/400');
  });
  it('omits the enemy part in the boss room', () => {
    const s = statusLine({ ...m, bossRoom: true });
    expect(s).toBe('HP: 100/120');
    expect(s).not.toContain('inimigo');
  });
});

describe('HELP_LINES', () => {
  it('is exported', () => {
    expect(HELP_LINES[0]).toBe('Controls:');
  });
});
