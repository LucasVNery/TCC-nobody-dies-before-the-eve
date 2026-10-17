/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { createFloorRng, floorSeed } from './floorSeed';

describe('floorSeed', () => {
  it('floorSeed is deterministic and returns an unsigned 32-bit integer', () => {
    for (const [a, b] of [[1, 0], [0, 0], [0xdeadbeef, 7]] as const) {
      const s = floorSeed(a, b);
      expect(floorSeed(a, b)).toBe(s);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('rooms of the same run get different seeds', () => {
    expect(new Set([0, 1, 2, 3, 4, 5].map((r) => floorSeed(42, r))).size).toBe(6);
    expect(floorSeed(1, 0)).not.toBe(floorSeed(2, 0));
  });

  it('bad inputs never throw and are normalized', () => {
    for (const [a, b] of [[NaN, 0], [Infinity, 0], [-5, 0], [1.9, 0.9], [0, NaN], [0, -Infinity]] as const) {
      expect(() => floorSeed(a, b)).not.toThrow();
      const s = floorSeed(a, b);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
    expect(floorSeed(-1, 0)).toBe(floorSeed(0xffffffff, 0));
  });
});

describe('createFloorRng', () => {
  it('createFloorRng is deterministic, in [0,1) and not constant', () => {
    const a = createFloorRng(123);
    const b = createFloorRng(123);
    const va: number[] = [];
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      va.push(x);
    }
    expect(new Set(va).size).toBeGreaterThan(90);
  });
});

describe('frozen algorithm', () => {
  it('golden values freeze the algorithm', () => {
    // Changing the algorithm changes the arena of old logs; only with the author's decision.
    expect(floorSeed(1, 0)).toBe(3305310087);
    expect(floorSeed(1, 1)).toBe(3524936969);
    expect(floorSeed(0xdeadbeef, 7)).toBe(230670917);
    const rng = createFloorRng(1);
    expect([rng(), rng(), rng(), rng(), rng()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849,
    ]);
  });
});

describe('dependency rule', () => {
  it('floor modules do not import the game, core, combat or phaser', () => {
    // Non-recursive glob: excludes the testing/ subfolder and *.test.ts.
    const files = import.meta.glob(['./*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(files).length).toBeGreaterThan(0);
    for (const [f, src] of Object.entries(files)) {
      const specs = [...src.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of specs) expect(s, `${f} imports ${s}`).not.toMatch(/(phaser|\/core\/|\/game\/|\/combat\/|testing\/)/);
    }
  });
});
