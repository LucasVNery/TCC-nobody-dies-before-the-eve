import { describe, it, expect } from 'vitest';
import { EntropyAccumulator } from './entropyAccumulator';

const LABELS = ['a', 'b', 'c', 'd', 'e'] as const;

function recordAndDecay(acc: EntropyAccumulator, label: string, times: number) {
  for (let i = 0; i < times; i++) acc.record(label);
}

describe('EntropyAccumulator', () => {
  it('domain() is null with zero samples', () => {
    const acc = new EntropyAccumulator(LABELS);
    acc.decayTrait(1);
    expect(acc.domain('trait')).toBeNull();
  });

  it('domain() is null with exactly one label used (n effective < 2)', () => {
    const acc = new EntropyAccumulator(LABELS);
    recordAndDecay(acc, 'a', 5);
    acc.decayTrait(1);
    expect(acc.domain('trait')).toBeNull();
  });

  it('domain() is 1 (within epsilon) for a uniform distribution over all 5 labels', () => {
    const acc = new EntropyAccumulator(LABELS);
    for (const label of LABELS) recordAndDecay(acc, label, 10);
    acc.decayTrait(1);
    expect(acc.domain('trait')).toBeCloseTo(1, 6);
  });

  it('domain() is ln(2)/ln(5) for a 50/50 split over 2 of the 5 labels', () => {
    const acc = new EntropyAccumulator(LABELS);
    recordAndDecay(acc, 'a', 10);
    recordAndDecay(acc, 'b', 10);
    acc.decayTrait(1);
    expect(acc.domain('trait')).toBeCloseTo(Math.log(2) / Math.log(5), 6);
  });

  it('deficit() is 1 - domain(), and null when domain() is null', () => {
    const acc = new EntropyAccumulator(LABELS);
    acc.decayTrait(1);
    expect(acc.deficit('trait')).toBeNull();

    recordAndDecay(acc, 'a', 10);
    recordAndDecay(acc, 'b', 10);
    acc.decayTrait(1);
    expect(acc.deficit('trait')).toBeCloseTo(1 - Math.log(2) / Math.log(5), 6);
  });

  it('confidence increases monotonically with more samples and approaches 1', () => {
    const acc = new EntropyAccumulator(LABELS);
    const readings: number[] = [];
    for (let i = 0; i < 5; i++) {
      recordAndDecay(acc, 'a', 25);
      acc.decayTrait(1);
      readings.push(acc.confidence('trait'));
    }
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeGreaterThan(readings[i - 1]);
    }
    expect(readings[readings.length - 1]).toBeGreaterThan(0.8);
  });

  it('record() with an unknown label throws', () => {
    const acc = new EntropyAccumulator(LABELS);
    expect(() => acc.record('unknown')).toThrow();
  });

  it('decayTrait() and decayState() are independent clocks', () => {
    const acc = new EntropyAccumulator(LABELS);
    recordAndDecay(acc, 'a', 10);
    recordAndDecay(acc, 'b', 10);

    acc.decayTrait(1);
    expect(acc.domain('trait')).toBeCloseTo(Math.log(2) / Math.log(5), 6);
    expect(acc.domain('state')).toBeNull(); // state clock not decayed yet

    acc.decayState(1);
    expect(acc.domain('state')).toBeCloseTo(Math.log(2) / Math.log(5), 6);
  });

  it('reset() clears both clocks', () => {
    const acc = new EntropyAccumulator(LABELS);
    recordAndDecay(acc, 'a', 10);
    recordAndDecay(acc, 'b', 10);
    acc.decayTrait(1);
    acc.decayState(1);
    acc.reset();
    expect(acc.domain('trait')).toBeNull();
    expect(acc.domain('state')).toBeNull();
    expect(acc.totalCount('trait')).toBe(0);
  });
});
