import { describe, it, expect } from 'vitest';
import { ProfileAccumulator } from './profileAccumulator';

describe('ProfileAccumulator', () => {
  it('a skill never recorded starts with domain 0.5 (uniform prior), confidence 0, deficit 0.5', () => {
    const acc = new ProfileAccumulator();
    expect(acc.domain('punish', 'trait')).toBeCloseTo(0.5);
    expect(acc.confidence('punish', 'trait')).toBe(0);
    expect(acc.deficit('punish', 'trait')).toBeCloseTo(0.5);
  });

  it('recordOutcome followed by applyRoomBoundary updates trait domain and confidence', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 9; i++) acc.recordOutcome('punish', true);
    acc.recordOutcome('punish', false);
    acc.applyRoomBoundary();
    // pending folded into a zero total: aproveitadas=9, oportunidades=10
    expect(acc.domain('punish', 'trait')).toBeCloseTo((9 + 1) / (10 + 2));
    expect(acc.confidence('punish', 'trait')).toBeCloseTo(10 / (10 + 10));
  });

  it('applyRoomBoundary decays existing totals by gamma even with no new records', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 10; i++) acc.recordOutcome('punish', true);
    acc.applyRoomBoundary(); // total = {10, 10}
    acc.applyRoomBoundary(); // no new pending: total = {0.87*10, 0.87*10} = {8.7, 8.7}
    expect(acc.domain('punish', 'trait')).toBeCloseTo((8.7 + 1) / (8.7 + 2));
    expect(acc.confidence('punish', 'trait')).toBeCloseTo(8.7 / (8.7 + 10));
  });

  it('applyEncounterBoundary decays existing totals by its own gamma', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 10; i++) acc.recordOutcome('dodge', true);
    acc.applyEncounterBoundary(); // total = {10, 10}
    acc.applyEncounterBoundary(); // total = {0.55*10, 0.55*10} = {5.5, 5.5}
    expect(acc.domain('dodge', 'state')).toBeCloseTo((5.5 + 1) / (5.5 + 2));
  });

  it('the trait and state clocks are independent: only their own boundary call decays them', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 5; i++) acc.recordOutcome('dodge', true);
    acc.applyRoomBoundary();
    // state clock untouched: applyEncounterBoundary was never called
    expect(acc.domain('dodge', 'state')).toBeCloseTo(0.5);
    expect(acc.confidence('dodge', 'state')).toBe(0);

    acc.applyEncounterBoundary();
    // now the state clock folds in the same pending the trait clock already consumed
    expect(acc.domain('dodge', 'state')).toBeCloseTo((5 + 1) / (5 + 2));
    // the trait clock (already boundary'd earlier) is unaffected by this call
    expect(acc.domain('dodge', 'trait')).toBeCloseTo((5 + 1) / (5 + 2));
  });

  it('multiple room boundaries accumulate rather than reset between calls', () => {
    const acc = new ProfileAccumulator();
    acc.recordOutcome('dodge', true);
    acc.applyRoomBoundary(); // total = {1, 1}
    acc.recordOutcome('dodge', true);
    acc.applyRoomBoundary(); // total = {0.87*1 + 1, 0.87*1 + 1} = {1.87, 1.87}
    expect(acc.domain('dodge', 'trait')).toBeCloseTo((1.87 + 1) / (1.87 + 2));
  });

  it('resetSession zeroes both clocks and pending buffers', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 5; i++) acc.recordOutcome('dodge', true);
    acc.applyRoomBoundary();
    acc.applyEncounterBoundary();
    acc.resetSession();
    expect(acc.domain('dodge', 'trait')).toBeCloseTo(0.5);
    expect(acc.domain('dodge', 'state')).toBeCloseTo(0.5);
    expect(acc.confidence('dodge', 'trait')).toBe(0);
    expect(acc.confidence('dodge', 'state')).toBe(0);
  });

  it('snapshot() reflects only the trait clock, with target null and lambda 0', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 3; i++) acc.recordOutcome('punish', true);
    acc.recordOutcome('punish', false);
    acc.applyRoomBoundary();
    acc.applyEncounterBoundary(); // state clock also updated — must not leak into the snapshot

    const snap = acc.snapshot('room.exit');
    expect(snap.at).toBe('room.exit');
    expect(snap.counts.punish).toEqual([3, 4]);
    expect(snap.domain.punish).toBeCloseTo((3 + 1) / (4 + 2));
    expect(snap.confidence.punish).toBeCloseTo(4 / (4 + 10));
    expect(snap.target).toBeNull();
    expect(snap.lambda).toBe(0);
  });

  it('snapshot() includes multiple skills simultaneously', () => {
    const acc = new ProfileAccumulator();
    acc.recordOutcome('dodge', true);
    acc.recordOutcome('punish', false);
    acc.applyRoomBoundary();
    const snap = acc.snapshot('boss.entry');
    expect(Object.keys(snap.counts).sort()).toEqual(['dodge', 'punish']);
  });
});
