import { describe, it, expect } from 'vitest';
import { Stamina, STAMINA_MAX } from './stamina';

describe('Stamina', () => {
  it('starts full', () => {
    const s = new Stamina();
    expect(s.value).toBe(STAMINA_MAX);
    expect(s.exhausted).toBe(false);
  });

  it('spend subtracts', () => {
    const s = new Stamina();
    s.spend(12, 'attack');
    expect(s.value).toBe(88);
  });

  it('spend clamps at 0 and marks exhausted', () => {
    const s = new Stamina();
    s.spend(200, 'attack');
    expect(s.value).toBe(0);
    expect(s.exhausted).toBe(true);
  });

  it('waits 600 ms after a spend before regenerating', () => {
    const s = new Stamina();
    s.spend(50, 'attack');
    s.step(599, true);
    expect(s.value).toBe(50);
    s.step(2, true);
    expect(s.value).toBeCloseTo(50 + 0.035, 5);
  });

  it('waits 1200 ms after hitting zero', () => {
    const s = new Stamina();
    s.spend(100, 'dodge');
    s.step(1199, true);
    expect(s.value).toBe(0);
    s.step(1201, true);
    expect(s.value).toBeGreaterThan(0);
  });

  it('never regenerates nor counts the wait when canRegen is false', () => {
    const s = new Stamina();
    s.spend(50, 'attack');
    s.step(5000, false);
    expect(s.value).toBe(50);
    s.step(599, true); // wait still intact
    expect(s.value).toBe(50);
  });

  it('a single large step regenerates only the part after the wait', () => {
    const s = new Stamina();
    s.spend(50, 'attack');
    s.step(2000, true);
    expect(s.value).toBeCloseTo(50 + 49, 5);
    s.spend(50, 'attack');
    s.step(10000, true);
    expect(s.value).toBe(STAMINA_MAX);
  });

  it('refund clamps at max and does not touch the wait', () => {
    const s = new Stamina();
    s.spend(10, 'dodge');
    s.refund(30);
    expect(s.value).toBe(STAMINA_MAX);
    s.spend(50, 'attack');
    s.refund(10);
    s.step(601, true);
    expect(s.value).toBeGreaterThan(60);
  });

  it('takeSpent sums per kind and zeroes', () => {
    const s = new Stamina();
    s.spend(12, 'attack');
    s.spend(8, 'attack');
    s.spend(30, 'dodge');
    expect(s.takeSpent()).toEqual({ attack: 20, sprint: 0, dodge: 30, block: 0 });
    expect(s.takeSpent()).toEqual({ attack: 0, sprint: 0, dodge: 0, block: 0 });
  });

  it('takeSpent counts only what was actually taken', () => {
    const s = new Stamina();
    s.spend(60, 'attack');
    s.spend(60, 'block');
    expect(s.takeSpent()).toEqual({ attack: 60, sprint: 0, dodge: 0, block: 40 });
  });

  it('reset restores full', () => {
    const s = new Stamina();
    s.spend(100, 'attack');
    s.reset();
    expect(s.value).toBe(STAMINA_MAX);
    s.spend(10, 'attack');
    s.step(1, true);
    expect(s.value).toBe(90); // no leftover wait weirdness: wait restarted by the new spend
  });
});
