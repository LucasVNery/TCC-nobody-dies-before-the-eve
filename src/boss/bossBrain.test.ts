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
  it('fires 4 strikes at level 1.0 (floor of 3 x 1.5: never above the 1.5x cap)', () => {
    const { brain, calls } = make(1, fakePrng(0));
    run(brain, 1200);
    expect(brain.windowsSeen).toBe(1);
    expect(brain.barragesFired).toBe(1);
    expect(calls[0].strikes).toBe(4);
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
  ])('the player-side condition must be contiguous: one step of %s resets', (_n, bad) => {
    const { brain } = make(1, fakePrng(0));
    run(brain, 1100);
    brain.step(STEP, { ...PASSIVE, ...bad });
    run(brain, 1100);
    expect(brain.windowsSeen).toBe(0);
    run(brain, 100);
    expect(brain.windowsSeen).toBe(1);
  });

  it('the boss being busy neither resets nor pauses the passive time', () => {
    const { brain, calls } = make(1, fakePrng(0));
    run(brain, 500);
    run(brain, 600, { ...PASSIVE, bossFree: false }); // an attack pattern in the middle
    run(brain, 100);
    expect(brain.windowsSeen).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('a window completed while the boss is busy stays pending and is decided on the first free tick', () => {
    const prng = fakePrng(0);
    const { brain, calls } = make(1, prng);
    run(brain, 2000, { ...PASSIVE, bossFree: false });
    expect(brain.windowsSeen).toBe(0);
    expect(calls).toHaveLength(0);
    expect(prng.draws).toBe(0);
    brain.step(STEP, PASSIVE);
    expect(brain.windowsSeen).toBe(1);
    expect(calls).toHaveLength(1);
    expect(prng.draws).toBe(1);
    // Decided once: staying passive does not decide it again.
    run(brain, 3000);
    expect(brain.windowsSeen).toBe(1);
  });

  it('a player-side break clears a pending window', () => {
    const { brain, calls } = make(1, fakePrng(0));
    run(brain, 1500, { ...PASSIVE, bossFree: false }); // pending
    brain.step(STEP, { ...PASSIVE, playerBlocking: false, bossFree: false });
    brain.step(STEP, PASSIVE); // boss free now, but the pending window is gone
    expect(brain.windowsSeen).toBe(0);
    expect(calls).toHaveLength(0);
    run(brain, 1000); // 1100 ms of new passive time: still short of a window
    expect(brain.windowsSeen).toBe(0);
    run(brain, 100);
    expect(brain.windowsSeen).toBe(1);
  });

  it('level 0 decides a pending window without drawing', () => {
    const prng = fakePrng(0);
    const { brain, calls } = make(0, prng);
    run(brain, 1500, { ...PASSIVE, bossFree: false });
    brain.step(STEP, PASSIVE);
    expect(brain.windowsSeen).toBe(1);
    expect(calls).toHaveLength(0);
    expect(prng.draws).toBe(0);
  });

  it.each([0.6, 0.8, 1])('strikes never exceed base x barrageDurationMaxMult at level %s; duration_mult agrees', (level) => {
    const { brain, calls } = make(level, fakePrng(0));
    run(brain, 1200);
    expect(calls).toHaveLength(1);
    const { strikes, info } = calls[0];
    expect(strikes).toBeGreaterThanOrEqual(1);
    expect(strikes).toBeLessThanOrEqual(BOSS_CONFIG.barrageBaseStrikes * BOSS_CONFIG.barrageDurationMaxMult);
    expect(info.durationMult).toBeLessThanOrEqual(BOSS_CONFIG.barrageDurationMaxMult);
    expect(strikes).toBeLessThanOrEqual(BOSS_CONFIG.barrageBaseStrikes * info.durationMult);
    expect(strikes).toBe(Math.floor(BOSS_CONFIG.barrageBaseStrikes * info.durationMult));
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
