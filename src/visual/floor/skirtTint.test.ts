import { describe, expect, it } from 'vitest';
import { skirtTint } from './skirtTint';

describe('skirtTint', () => {
  it('maps distance to a grey that darkens towards the outer ring', () => {
    expect(skirtTint(0, 10)).toBe(0xffffff);
    expect(skirtTint(1, 10)).toBe(0xf0f0f0);
    expect(skirtTint(5, 10)).toBe(0xb3b3b3);
    expect(skirtTint(10, 10)).toBe(0x666666);
  });

  it('clamps out-of-range distances', () => {
    expect(skirtTint(20, 10)).toBe(0x666666);
    expect(skirtTint(-3, 10)).toBe(0xffffff);
  });

  it('does not throw for skirt 0', () => {
    expect(skirtTint(0, 0)).toBe(0xffffff);
  });
});
