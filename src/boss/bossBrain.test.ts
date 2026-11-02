import { describe, it, expect } from 'vitest';
import { BossBrain, type BrainView } from './bossBrain';
import { BOSS_CONFIG } from './bossConfig';
import { createPrng, type Prng } from '../core/prng';

const STEP = 100;
const PASSIVE: BrainView = { playerBlocking: true, playerSpeed: 0, distance: 50, bossFree: true };

function fakePrng(value: number): Prng & { draws: number } {
  const p = {
    draws: 0,
    next() { p.draws += 1; return value; },
    nextInt() { p.draws += 1; return 0; },
  };
  return p;
}

function run(brain: BossBrain, ms: number, view: BrainView = PASSIVE): void {
  for (let t = 0; t < ms; t += STEP) brain.step(STEP, view);
}

function make(level: number, prng: Prng, config = BOSS_CONFIG) {
  const calls: Array<{ strikes: number; info: { chance: number; durationMult: number; level: number } }> = [];
  const brain = new BossBrain({
    barrageLevel: level,
    prng,
    config,
    onBarrage: (strikes, info) => calls.push({ strikes, info }),
  });
  return { brain, calls };
}

describe('BossBrain', () => {
  it('fires 5 strikes at level 1.0', () => {
    const { brain, calls } = make(1, fakePrng(0));
    run(brain, 1200);
    expect(brain.windowsSeen).toBe(1);
    expect(brain.barragesFired).toBe(1);
    expect(calls[0].strikes).toBe(5);
    expect(calls[0].info.level).toBe(1);
  });

  it('fires 3 strikes at level 0.6', () => {
    const { brain, calls } = make(0.6, fakePrng(0));
    run(brain, 1200);
    expect(calls[0].strikes).toBe(3);
  });

  it('does not fire before the window completes', () => {
    const { brain, calls } = make(1, fakePrng(0));
    run(brain, 1100);
    expect(brain.windowsSeen).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('level 0 counts windows but never fires and never draws', () => {
    const prng = fakePrng(0);
    const { brain, calls } = make(0, prng);
    run(brain, 1200);
    expect(brain.windowsSeen).toBe(1);
    expect(calls).toHaveLength(0);
    expect(prng.draws).toBe(0);
  });

  it('a draw at or above the chance does not fire', () => {
    const { brain, calls } = make(1, fakePrng(0.5));
    run(brain, 1200);
    expect(brain.windowsSeen).toBe(1);
    expect(brain.barragesFired).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['not blocking', { playerBlocking: false }],
    ['too fast', { playerSpeed: 21 }],
    ['too far', { distance: 121 }],
    ['boss busy', { bossFree: false }],
  ])('window must be contiguous: one step of %s resets', (_n, bad) => {
    const { brain } = make(1, fakePrng(0));
    run(brain, 1100);
    brain.step(STEP, { ...PASSIVE, ...bad });
    run(brain, 1100);
    expect(brain.windowsSeen).toBe(0);
    run(brain, 100);
    expect(brain.windowsSeen).toBe(1);
  });

  it('boundary values still count as passive', () => {
    const { brain } = make(1, fakePrng(0));
    run(brain, 1200, { playerBlocking: true, playerSpeed: 20, distance: 120, bossFree: true });
    expect(brain.windowsSeen).toBe(1);
  });

  it('a found window is not re-found until the condition breaks and rebuilds', () => {
    const { brain } = make(1, fakePrng(0.99));
    run(brain, 5000);
    expect(brain.windowsSeen).toBe(1);
    brain.step(STEP, { ...PASSIVE, playerBlocking: false });
    run(brain, 1200);
    expect(brain.windowsSeen).toBe(2);
  });

  it('respects the cooldown between barrages', () => {
    const { brain, calls } = make(1, fakePrng(0));
    const rebuild = () => {
      brain.step(STEP, { ...PASSIVE, playerBlocking: false });
      run(brain, 1200);
    };
    run(brain, 1200); // fires at ~1.2 s
    rebuild(); // ~2.5 s: window, in cooldown
    expect(brain.windowsSeen).toBe(2);
    expect(calls).toHaveLength(1);
    for (let i = 0; i < 3; i++) rebuild(); // windows at ~3.8, 5.1 and 6.4 s: 5.2 s since the first
    expect(calls).toHaveLength(1);
    rebuild(); // ~7.7 s: past 6 s
    expect(calls).toHaveLength(2);
  });

  it('fires on at most 55% of 1000 windows at level 1 (seed 4242)', () => {
    const { brain } = make(1, createPrng(4242), { ...BOSS_CONFIG, barrageCooldownMs: 0 });
    for (let i = 0; i < 1000; i++) {
      brain.step(STEP, { ...PASSIVE, playerBlocking: false });
      run(brain, 1200);
    }
    expect(brain.windowsSeen).toBe(1000);
    expect(brain.barragesFired / brain.windowsSeen).toBeLessThanOrEqual(0.55);
    expect(brain.barragesFired).toBeGreaterThan(0);
  });
});
