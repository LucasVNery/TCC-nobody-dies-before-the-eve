// src/combat/hitstop.test.ts
import { describe, it, expect } from 'vitest';
import { HitStop, HITSTOP_STEPS, HITSTOP_COOLDOWN_STEPS } from './hitstop';

function freeze(h: HitStop): number {
  let n = 0;
  while (h.active) {
    h.consume();
    n++;
  }
  return n;
}

describe('HitStop', () => {
  it('pins the step table and the cooldown', () => {
    expect(HITSTOP_STEPS).toEqual({ light: 2, heavy: 4, charged: 5, hurt: 4, parry: 5, perfect: 5 });
    expect(HITSTOP_COOLDOWN_STEPS).toBe(6);
  });

  it('request(4) stays active for exactly 4 consume() calls', () => {
    const h = new HitStop();
    expect(h.active).toBe(false);
    h.request(4);
    for (let i = 0; i < 4; i++) {
      expect(h.active).toBe(true);
      h.consume();
    }
    expect(h.active).toBe(false);
  });

  it('a request while active is ignored and never adds up', () => {
    const h = new HitStop();
    h.request(4);
    h.consume();
    h.request(5);
    expect(freeze(h)).toBe(3);
  });

  it('is ignored until 6 free steps pass after the previous freeze, then accepted', () => {
    const h = new HitStop();
    h.request(2);
    freeze(h);
    for (let i = 0; i < HITSTOP_COOLDOWN_STEPS - 1; i++) {
      h.tickFree();
      h.request(4);
      expect(h.active).toBe(false);
    }
    h.tickFree();
    h.request(4);
    expect(freeze(h)).toBe(4);
  });

  it('the cooldown does not run while frozen steps are consumed', () => {
    const h = new HitStop();
    h.request(3);
    h.consume();
    h.tickFree(); // not a real flow, but a free tick during a freeze must not start a cooldown
    freeze(h);
    h.request(2);
    expect(h.active).toBe(false);
  });

  it('reset() clears the freeze and the cooldown', () => {
    const h = new HitStop();
    h.request(5);
    h.reset();
    expect(h.active).toBe(false);
    h.request(2);
    freeze(h);
    h.reset();
    h.request(3);
    expect(freeze(h)).toBe(3);
  });
});
