import { describe, it, expect } from 'vitest';
import { createPrng } from '../../core/prng';
import { DEFAULT_HUMANIZER, Humanizer } from './humanizer';

const N = 20000;

describe('Humanizer', () => {
  it('has log-normal reaction delays matching the configured mean and sd, min 80 ms', () => {
    const h = new Humanizer(DEFAULT_HUMANIZER, createPrng(7).next);
    const xs = Array.from({ length: N }, () => h.sampleReactionMs());
    const mean = xs.reduce((a, b) => a + b, 0) / N;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (N - 1));
    expect(Math.abs(mean - DEFAULT_HUMANIZER.reactionMeanMs) / DEFAULT_HUMANIZER.reactionMeanMs).toBeLessThan(0.03);
    expect(Math.abs(sd - DEFAULT_HUMANIZER.reactionSdMs) / DEFAULT_HUMANIZER.reactionSdMs).toBeLessThan(0.1);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(80);
  });

  it('is deterministic for the same seed', () => {
    const a = new Humanizer(DEFAULT_HUMANIZER, createPrng(3).next);
    const b = new Humanizer(DEFAULT_HUMANIZER, createPrng(3).next);
    for (let i = 0; i < 50; i++) expect(a.sampleReactionMs()).toBe(b.sampleReactionMs());
  });

  it('lapses at the configured probability', () => {
    const h = new Humanizer({ ...DEFAULT_HUMANIZER, lapseProb: 0.05 }, createPrng(11).next);
    let n = 0;
    for (let i = 0; i < N; i++) if (h.lapses()) n++;
    expect(Math.abs(n / N - 0.05)).toBeLessThan(0.005);
  });

  it('never lapses at 0 and always at 1', () => {
    const z = new Humanizer({ ...DEFAULT_HUMANIZER, lapseProb: 0 }, createPrng(1).next);
    const o = new Humanizer({ ...DEFAULT_HUMANIZER, lapseProb: 1 }, createPrng(1).next);
    for (let i = 0; i < 1000; i++) {
      expect(z.lapses()).toBe(false);
      expect(o.lapses()).toBe(true);
    }
  });

  it('noisyAim preserves length, has the configured angular sd, and keeps zero', () => {
    const cfg = { ...DEFAULT_HUMANIZER, aimNoiseRad: 0.2 };
    const h = new Humanizer(cfg, createPrng(5).next);
    const angles: number[] = [];
    for (let i = 0; i < N; i++) {
      const v = h.noisyAim({ x: 3, y: 4 });
      expect(Math.abs(Math.hypot(v.x, v.y) - 5)).toBeLessThan(1e-9);
      let d = Math.atan2(v.y, v.x) - Math.atan2(4, 3);
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      angles.push(d);
    }
    const m = angles.reduce((a, b) => a + b, 0) / N;
    const sd = Math.sqrt(angles.reduce((a, b) => a + (b - m) ** 2, 0) / (N - 1));
    expect(Math.abs(sd - 0.2) / 0.2).toBeLessThan(0.05);
    expect(h.noisyAim({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});
