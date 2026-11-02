import { describe, expect, it } from 'vitest';
import { BOSS_CONFIG, BOSS_CONFIG_DEMO } from './bossConfig';
import { evaluateHabits, type ConfidenceSource } from './habits';
import type { RunTally } from './habitEvidence';

function tally(runIdx: number, over: Partial<RunTally> = {}): RunTally {
  return {
    runIdx, nearNum: 0, nearDen: 0, dodge: 0, block: 0, parry: 0, retreat: 0,
    reflexDashes: 0, closed: true, ...over,
  };
}
/** Dodge-abuse qualifying run. */
const dodgeQ = (i: number): RunTally => tally(i, { dodge: 10 });
/** Dodge-abuse evidence but not qualifying. */
const dodgeNo = (i: number): RunTally => tally(i, { dodge: 1, block: 9 });

const conf = (v: number): ConfidenceSource => ({ confidence: () => v });
const seq = (n: number, f: (i: number) => RunTally, from = 1): RunTally[] =>
  Array.from({ length: n }, (_, k) => f(from + k));
const dodge = (runs: RunTally[], c: number, cfg = BOSS_CONFIG) =>
  evaluateHabits(runs, conf(c), cfg).find((h) => h.habit === 'dodge_abuse')!;

describe('evaluateHabits', () => {
  it('returns one state per HabitId in order', () => {
    const r = evaluateHabits([], conf(1));
    expect(r.map((h) => h.habit)).toEqual(['far', 'passive_defense', 'dodge_abuse', 'reflex_dash']);
    expect(r.every((h) => !h.valid && h.level === 0)).toBe(true);
  });

  it('(a) 2 qualifying runs -> invalid, level 0', () => {
    const h = dodge(seq(2, dodgeQ), 1);
    expect(h.valid).toBe(false);
    expect(h.level).toBe(0);
    expect(h.qualifying).toBe(2);
  });

  it('(b) 3 qualifying runs need confidence >= 0.6', () => {
    expect(dodge(seq(3, dodgeQ), 0.59).valid).toBe(false);
    const h = dodge(seq(3, dodgeQ), 0.6);
    expect(h.valid).toBe(true);
    expect(h.level).toBeCloseTo(0.2);
    expect(h.confidence).toBe(0.6);
  });

  it('(c) levels grow with qualifying runs', () => {
    expect(dodge(seq(4, dodgeQ), 1).level).toBeCloseTo(0.6);
    expect(dodge(seq(5, dodgeQ), 1).level).toBeCloseTo(1.0);
    expect(dodge(seq(8, dodgeQ), 1).level).toBeCloseTo(1.0);
  });

  it('(d) hysteresis: valid survives down to 2 qualifying, exits at 1', () => {
    const base = seq(5, dodgeQ);
    const two = [...base, ...seq(3, dodgeNo, 6)]; // window: q q n n n
    const h2 = dodge(two, 1);
    expect(h2.qualifying).toBe(2);
    expect(h2.valid).toBe(true);
    expect(h2.level).toBeCloseTo(0.2);
    const one = [...two, dodgeNo(9)]; // window: q n n n n
    const h1 = dodge(one, 1);
    expect(h1.qualifying).toBe(1);
    expect(h1.valid).toBe(false);
    expect(h1.level).toBe(0);
  });

  it('confidence between exit and enter thresholds never enters (single current confidence)', () => {
    expect(dodge(seq(5, dodgeQ), 0.5).valid).toBe(false);
  });

  it('(e) runs below minLabels are ignored', () => {
    const runs = seq(3, (i) => tally(i, { dodge: 3 }));
    const h = dodge(runs, 1);
    expect(h.valid).toBe(false);
    expect(h.windowRuns).toBe(0);
  });

  it('skips unclosed runs and walks by runIdx', () => {
    const runs = [dodgeQ(3), dodgeQ(1), dodgeQ(2), { ...dodgeQ(4), closed: false }];
    const h = dodge(runs, 1);
    expect(h.windowRuns).toBe(3);
    expect(h.valid).toBe(true);
  });

  it('far qualifies on low near fraction with enough near seconds', () => {
    const far = (i: number) => tally(i, { nearNum: 1, nearDen: 30 });
    const h = evaluateHabits(seq(3, far), conf(1)).find((x) => x.habit === 'far')!;
    expect(h.valid).toBe(true);
    const few = (i: number) => tally(i, { nearNum: 0, nearDen: 10 });
    const h2 = evaluateHabits(seq(3, few), conf(1)).find((x) => x.habit === 'far')!;
    expect(h2.valid).toBe(false);
    expect(h2.windowRuns).toBe(0);
  });

  it('passive_defense qualifies on block share', () => {
    const run = (i: number) => tally(i, { block: 8, dodge: 2 });
    const h = evaluateHabits(seq(3, run), conf(1)).find((x) => x.habit === 'passive_defense')!;
    expect(h.valid).toBe(true);
  });

  it('(f) reflex_dash from the last closed run only', () => {
    const rd = (n: number) =>
      evaluateHabits([tally(1, { reflexDashes: n })], conf(1)).find((h) => h.habit === 'reflex_dash')!;
    expect(rd(9).valid).toBe(false);
    expect(rd(9).level).toBe(0);
    expect(rd(10).valid).toBe(true);
    expect(rd(10).level).toBeCloseTo(0.2);
    expect(rd(20).level).toBeCloseTo(0.6);
    expect(rd(30).level).toBeCloseTo(1);
    expect(rd(50).level).toBeCloseTo(1);
    expect(rd(10).confidence).toBeNull();
    const after = evaluateHabits(
      [tally(1, { reflexDashes: 40 }), tally(2, { reflexDashes: 0 })], conf(1),
    ).find((h) => h.habit === 'reflex_dash')!;
    expect(after.valid).toBe(false);
  });

  it('(g) demo config: 1 qualifying run is enough', () => {
    const h = dodge([dodgeQ(1)], 0.6, BOSS_CONFIG_DEMO);
    expect(h.valid).toBe(true);
    expect(h.level).toBeCloseTo(0.2);
    expect(dodge([dodgeQ(1), dodgeQ(2), dodgeQ(3)], 1, BOSS_CONFIG_DEMO).level).toBeCloseTo(1);
  });

  it('(h) reads confidence of the right skill', () => {
    const asked: string[] = [];
    const src: ConfidenceSource = {
      confidence: (skill, clock) => {
        asked.push(`${skill}:${clock}`);
        return skill === 'distance' ? 0.9 : 0.1;
      },
    };
    const runs = [
      ...seq(3, (i) => tally(i, { nearNum: 0, nearDen: 30, dodge: 10 })),
    ];
    const r = evaluateHabits(runs, src);
    const get = (id: string) => r.find((h) => h.habit === id)!;
    expect(get('far').valid).toBe(true);
    expect(get('far').confidence).toBe(0.9);
    expect(get('dodge_abuse').valid).toBe(false);
    expect(get('dodge_abuse').confidence).toBe(0.1);
    expect(get('passive_defense').confidence).toBe(0.1);
    expect(asked).toContain('distance:trait');
    expect(asked).toContain('defensive_repertoire:trait');
    expect(asked.every((a) => a.endsWith(':trait'))).toBe(true);
    expect(new Set(asked)).toEqual(new Set(['distance:trait', 'defensive_repertoire:trait']));
  });
});
