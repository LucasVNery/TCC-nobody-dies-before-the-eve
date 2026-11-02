import { describe, expect, it } from 'vitest';
import { planBoss } from './bossPlanner';
import type { ConfidenceSource } from './habits';
import type { RunTally } from './habitEvidence';

function tally(runIdx: number, over: Partial<RunTally> = {}): RunTally {
  return {
    runIdx, nearNum: 0, nearDen: 0, dodge: 0, block: 0, parry: 0, retreat: 0,
    reflexDashes: 0, closed: true, ...over,
  };
}
const conf: ConfidenceSource = { confidence: () => 1 };
const seq = (n: number, f: (i: number) => RunTally): RunTally[] =>
  Array.from({ length: n }, (_, k) => f(k + 1));
const fake = (facedBoss: boolean, runs: RunTally[]) => ({ facedBoss, runs: () => runs });

// Per-run tallies qualifying each habit (5 of 5 -> level 1, 4 -> 0.6, 3 -> 0.2).
const farQ: Partial<RunTally> = { nearNum: 1, nearDen: 30 };
const dodgeQ = (i: number) => tally(i, { dodge: 10 });
const blockQ: Partial<RunTally> = { block: 10 };

describe('planBoss', () => {
  it('gate closed: all zero, no records, even with valid habits', () => {
    const p = planBoss(fake(false, seq(5, dodgeQ)), conf);
    expect(p.gateOpen).toBe(false);
    expect(p.levels).toEqual({ far: 0, passive_defense: 0, dodge_abuse: 0, reflex_dash: 0 });
    expect(p.records).toEqual([]);
  });

  it('keeps only the top two of three valid habits', () => {
    // far 3/5 -> 0.2, passive 4/5 -> 0.6, reflex_dash -> 1.0 (dodge 1/5: invalid)
    const rs = seq(5, (i) => {
      const t = tally(i);
      if (i <= 3) Object.assign(t, farQ);
      if (i <= 4) Object.assign(t, blockQ); // passive 4/5 -> 0.6
      else Object.assign(t, dodgeQ(i));
      return t;
    });
    // reflex_dash from last run: 30 dashes -> 1.0
    rs[4] = { ...rs[4], reflexDashes: 30 };
    const p = planBoss(fake(true, rs), conf);
    expect(p.gateOpen).toBe(true);
    expect(p.levels.reflex_dash).toBeCloseTo(1);
    expect(p.levels.passive_defense).toBeCloseTo(0.6);
    expect(p.levels.far).toBe(0); // 0.2 dropped
    expect(p.levels.dodge_abuse).toBe(0);
    expect(p.records.map((r) => r.habit)).toEqual(['reflex_dash', 'passive_defense']);
    const rec = p.records[1];
    expect(rec).toMatchObject({ habit: 'passive_defense', runs_qualifying: 4, runs_window: 5, confidence: 1, active: true });
  });

  it('ties are resolved by HabitId order', () => {
    const rs = seq(5, (i) => tally(i, { ...farQ, ...blockQ }));
    const p = planBoss(fake(true, rs), conf);
    expect(p.levels.far).toBeCloseTo(1);
    expect(p.levels.passive_defense).toBeCloseTo(1);
    // third tied habit (reflex_dash) loses to HabitId order
    const withReflex = rs.map((r, k) => (k === 4 ? { ...r, reflexDashes: 30 } : r));
    const q = planBoss(fake(true, withReflex), conf);
    expect(q.records.map((r) => r.habit)).toEqual(['far', 'passive_defense']);
    expect(q.levels.reflex_dash).toBe(0);
  });

  it('no valid habit: all zero, no records', () => {
    const p = planBoss(fake(true, seq(5, (i) => tally(i, i === 1 ? farQ : {}))), conf);
    expect(p.gateOpen).toBe(true);
    expect(p.levels).toEqual({ far: 0, passive_defense: 0, dodge_abuse: 0, reflex_dash: 0 });
    expect(p.records).toEqual([]);
  });
});
