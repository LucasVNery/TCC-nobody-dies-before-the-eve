// src/profile/profileAccumulator.test.ts
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
    for (let i = 0; i < 9; i++) acc.recordOutcome('punish', 'taken');
    acc.recordOutcome('punish', 'missed');
    acc.applyRoomBoundary();
    expect(acc.domain('punish', 'trait')).toBeCloseTo((9 + 1) / (10 + 2));
    expect(acc.confidence('punish', 'trait')).toBeCloseTo(10 / (10 + 10));
  });

  it('applyRoomBoundary decays existing totals by gamma even with no new records', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 10; i++) acc.recordOutcome('punish', 'taken');
    acc.applyRoomBoundary(); // total = {10, 10}
    acc.applyRoomBoundary(); // no new pending: total = {0.87*10, 0.87*10} = {8.7, 8.7}
    expect(acc.domain('punish', 'trait')).toBeCloseTo((8.7 + 1) / (8.7 + 2));
    expect(acc.confidence('punish', 'trait')).toBeCloseTo(8.7 / (8.7 + 10));
  });

  it('applyEncounterBoundary decays existing totals by its own gamma', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 10; i++) acc.recordOutcome('dodge', 'taken');
    acc.applyEncounterBoundary(); // total = {10, 10}
    acc.applyEncounterBoundary(); // total = {0.55*10, 0.55*10} = {5.5, 5.5}
    expect(acc.domain('dodge', 'state')).toBeCloseTo((5.5 + 1) / (5.5 + 2));
  });

  it('the trait and state clocks are independent: only their own boundary call decays them', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 5; i++) acc.recordOutcome('dodge', 'taken');
    acc.applyRoomBoundary();
    expect(acc.domain('dodge', 'state')).toBeCloseTo(0.5);
    expect(acc.confidence('dodge', 'state')).toBe(0);

    acc.applyEncounterBoundary();
    expect(acc.domain('dodge', 'state')).toBeCloseTo((5 + 1) / (5 + 2));
    expect(acc.domain('dodge', 'trait')).toBeCloseTo((5 + 1) / (5 + 2));
  });

  it('multiple room boundaries accumulate rather than reset between calls', () => {
    const acc = new ProfileAccumulator();
    acc.recordOutcome('dodge', 'taken');
    acc.applyRoomBoundary(); // total = {1, 1}
    acc.recordOutcome('dodge', 'taken');
    acc.applyRoomBoundary(); // total = {0.87*1 + 1, 0.87*1 + 1} = {1.87, 1.87}
    expect(acc.domain('dodge', 'trait')).toBeCloseTo((1.87 + 1) / (1.87 + 2));
  });

  it('resetSession zeroes both clocks and pending buffers', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 5; i++) acc.recordOutcome('dodge', 'taken');
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
    for (let i = 0; i < 3; i++) acc.recordOutcome('punish', 'taken');
    acc.recordOutcome('punish', 'expired');
    acc.applyRoomBoundary();
    acc.applyEncounterBoundary();

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
    acc.recordOutcome('dodge', 'taken');
    acc.recordOutcome('punish', 'expired');
    acc.applyRoomBoundary();
    const snap = acc.snapshot('boss.entry');
    expect(Object.keys(snap.counts).sort()).toEqual(['dodge', 'punish']);
  });

  it('record() accepts a continuous numerator/denominator pair, not just boolean outcomes', () => {
    const acc = new ProfileAccumulator();
    acc.record('distance', 3.5, 10); // e.g. 3.5s in melee range out of 10s of combat
    acc.applyRoomBoundary();
    expect(acc.domain('distance', 'trait')).toBeCloseTo((3.5 + 1) / (10 + 2));
  });

  it('omission() distinguishes expired from missed within the not-taken bucket', () => {
    const acc = new ProfileAccumulator();
    acc.recordOutcome('dodge', 'expired');
    acc.recordOutcome('dodge', 'expired');
    acc.recordOutcome('dodge', 'missed');
    acc.applyRoomBoundary();
    expect(acc.omission('dodge', 'trait')).toBeCloseTo(2 / 3);
  });

  it('omission() is null when no missed/expired outcome has been recorded yet', () => {
    const acc = new ProfileAccumulator();
    acc.recordOutcome('dodge', 'taken');
    acc.applyRoomBoundary();
    expect(acc.omission('dodge', 'trait')).toBeNull();
  });

  it('snapshot() omits a skill whose only evidence is still pending (not yet folded by a boundary)', () => {
    const acc = new ProfileAccumulator();
    acc.recordOutcome('dodge', 'taken'); // no applyRoomBoundary() yet
    const snap = acc.snapshot('boss.entry');
    expect(snap.counts.dodge).toBeUndefined();
  });

  it('deficit() reflects 1 - domain() after real records, on both clocks', () => {
    const acc = new ProfileAccumulator();
    for (let i = 0; i < 4; i++) acc.recordOutcome('punish', 'taken');
    acc.recordOutcome('punish', 'expired');
    acc.applyRoomBoundary();
    acc.applyEncounterBoundary();
    expect(acc.deficit('punish', 'trait')).toBeCloseTo(1 - acc.domain('punish', 'trait'));
    expect(acc.deficit('punish', 'state')).toBeCloseTo(1 - acc.domain('punish', 'state'));
  });

  it('confidence kappa is constructor-injectable', () => {
    const acc = new ProfileAccumulator(25);
    for (let i = 0; i < 25; i++) acc.recordOutcome('weapon-entropy', 'taken');
    acc.applyRoomBoundary();
    expect(acc.confidence('weapon-entropy', 'trait')).toBeCloseTo(25 / (25 + 25));
  });
});
