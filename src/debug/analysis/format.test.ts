import { describe, it, expect } from 'vitest';
import { fmtNum, fmtMs, fmtPercent, fmtSample } from './format';

describe('format', () => {
  it('uses a decimal comma and no thousands separator', () => {
    expect(fmtNum(0.85)).toBe('0,85');
    expect(fmtNum(1234.5, 1)).toBe('1234,5');
  });
  it('renders absent values as a dash', () => {
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum(NaN)).toBe('—');
    expect(fmtNum(Infinity)).toBe('—');
    expect(fmtNum(-Infinity)).toBe('—');
    expect(fmtMs(null)).toBe('—');
    expect(fmtPercent(NaN)).toBe('—');
    expect(fmtSample(null)).toBe('—');
  });
  it('formats ms, percent and sample', () => {
    expect(fmtMs(250.4)).toBe('250 ms');
    expect(fmtPercent(0.5)).toBe('50%');
    expect(fmtSample(12)).toBe('n=12');
  });
});
