import { describe, it, expect } from 'vitest';
import { createPrng } from '../../core/prng';
import type { SkillId } from '../../profile/types';
import { HYPOTHESES } from './hypotheses';
import { DEFAULT_EXPERIMENT, playAgent } from './agentRunner';
import { dropEmptyRuns, evaluateHypotheses, iccBySkill, prepareValues, type HypothesisResult } from './evaluate';
import { STYLE_IDS, type StyleId } from './styles';
import { REPORT_SKILLS, runWindowValues, type WindowValue } from './windowValues';

describe('HYPOTHESES', () => {
  it('HYPOTHESES are pre-registered', () => {
    // Pré-registro (spec §4.4): alterar exige decisão do autor e registro no relatório.
    expect(HYPOTHESES).toEqual([
      { id: 'H1', skill: 'weapon_repertoire', kind: 'greater', higher: 'variado', lower: 'agressivo' },
      { id: 'H1u', skill: 'weapon_repertoire', kind: 'undefinedRate', style: 'repetitivo' },
      { id: 'H2', skill: 'action_repertoire', kind: 'greater', higher: 'variado', lower: 'bloqueador' },
      { id: 'H2u', skill: 'action_repertoire', kind: 'undefinedRate', style: 'repetitivo' },
      { id: 'H3', skill: 'punish', kind: 'greater', higher: 'paciente', lower: 'evasivo' },
      { id: 'H4', skill: 'punish', kind: 'greater', higher: 'bloqueador', lower: 'evasivo' },
      {
        id: 'H5',
        skill: 'defensive_repertoire',
        kind: 'greater',
        higher: 'aleatorio',
        lower: 'agressivo',
        orLowerUndefined: true,
      },
      { id: 'H6', skill: 'defensive_repertoire', kind: 'greater', higher: 'aleatorio', lower: 'evasivo' },
      { id: 'H7', skill: 'distance', kind: 'greater', higher: 'agressivo', lower: 'evasivo' },
      { id: 'H8', skill: 'distance', kind: 'greater', higher: 'agressivo', lower: 'paciente' },
      { id: 'H9', skill: 'patience', kind: 'greater', higher: 'paciente', lower: 'agressivo' },
      { id: 'H10', skill: 'patience', kind: 'greater', higher: 'evasivo', lower: 'agressivo' },
      { id: 'H11', skill: 'patience', kind: 'greater', higher: 'paciente', lower: 'aleatorio' },
      {
        id: 'H12',
        skill: 'action_repertoire',
        kind: 'greater',
        higher: 'aleatorio',
        lower: 'repetitivo',
        orLowerUndefined: true,
      },
    ]);
  });

  it('every hypothesis names a reported dimension and known styles', () => {
    for (const h of HYPOTHESES) {
      expect(REPORT_SKILLS).toContain(h.skill);
      for (const s of [h.higher, h.lower, h.style]) if (s !== undefined) expect(STYLE_IDS).toContain(s);
    }
  });
});

const wv = (runIdx: number, skill: SkillId, domain: number | null, roomIdx: number | null = null): WindowValue => ({
  runIdx,
  roomIdx,
  skill,
  domain,
  confidence: domain === null ? 0 : 0.5,
  sampleSize: domain === null ? 0 : 3,
});

/** n run values of `skill`, evenly spaced in [lo, hi]; `nulls` of them (the last ones) undefined. */
function runs(skill: SkillId, n: number, lo: number, hi: number, nulls = 0): WindowValue[] {
  return Array.from({ length: n }, (_, i) => wv(i, skill, i >= n - nulls ? null : lo + ((hi - lo) * i) / Math.max(1, n - 1)));
}

function byStyle(over: Partial<Record<StyleId, WindowValue[]>>): Record<StyleId, WindowValue[]> {
  const out = {} as Record<StyleId, WindowValue[]>;
  for (const s of STYLE_IDS) out[s] = over[s] ?? [];
  return out;
}

const result = (rs: HypothesisResult[], id: string): HypothesisResult => {
  const r = rs.find((x) => x.id === id);
  if (!r) throw new Error(`no result ${id}`);
  return r;
};

const rngOf = (seed = 7) => createPrng(seed).next;

describe('evaluateHypotheses', () => {
  it('returns one result per hypothesis, in order', () => {
    const rs = evaluateHypotheses(byStyle({}), rngOf(), 50);
    expect(rs.map((r) => r.id)).toEqual(HYPOTHESES.map((h) => h.id));
    for (const r of rs) expect(r.skill).toBe(HYPOTHESES.find((h) => h.id === r.id)!.skill);
  });

  it('separated groups confirm H1 with delta ~ 1 and lo > 0', () => {
    const rs = evaluateHypotheses(
      byStyle({ variado: runs('weapon_repertoire', 30, 0.6, 0.9), agressivo: runs('weapon_repertoire', 30, 0.1, 0.3) }),
      rngOf(),
      500,
    );
    const h1 = result(rs, 'H1');
    expect(h1.verdict).toBe('confirmada');
    expect(h1.delta).toBeCloseTo(1, 6);
    expect(h1.lo!).toBeGreaterThan(0);
    expect([h1.nHigher, h1.nLower]).toEqual([30, 30]);
    expect(h1.undefinedRateLower).toBe(0);
  });

  it('equal groups refute H1', () => {
    const rs = evaluateHypotheses(
      byStyle({ variado: runs('weapon_repertoire', 30, 0.2, 0.8), agressivo: runs('weapon_repertoire', 30, 0.2, 0.8) }),
      rngOf(),
      500,
    );
    const h1 = result(rs, 'H1');
    expect(h1.verdict).toBe('refutada');
    expect(h1.delta).toBe(0);
  });

  it('the wrong direction refutes', () => {
    const rs = evaluateHypotheses(
      byStyle({ variado: runs('weapon_repertoire', 30, 0.1, 0.3), agressivo: runs('weapon_repertoire', 30, 0.6, 0.9) }),
      rngOf(),
      500,
    );
    expect(result(rs, 'H1').verdict).toBe('refutada');
    expect(result(rs, 'H1').delta).toBeCloseTo(-1, 6);
  });

  it('a group with 5 defined values makes the hypothesis indefinida', () => {
    const rs = evaluateHypotheses(
      byStyle({ variado: runs('weapon_repertoire', 30, 0.6, 0.9), agressivo: runs('weapon_repertoire', 30, 0.1, 0.3, 25) }),
      rngOf(),
      200,
    );
    const h1 = result(rs, 'H1');
    expect(h1.verdict).toBe('indefinida');
    expect(h1.nLower).toBe(5);
    expect(h1.undefinedRateLower).toBeCloseTo(25 / 30, 9);
  });

  it('only run windows count (room windows are ignored)', () => {
    const rooms = Array.from({ length: 40 }, (_, i) => wv(i % 4, 'weapon_repertoire', 0.5, i));
    const rs = evaluateHypotheses(
      byStyle({ variado: [...runs('weapon_repertoire', 30, 0.6, 0.9), ...rooms], agressivo: runs('weapon_repertoire', 30, 0.1, 0.3) }),
      rngOf(),
      100,
    );
    expect(result(rs, 'H1').nHigher).toBe(30);
  });

  it('H1u: 29 of 30 null confirms; 20 of 30 refutes; < 10 runs is indefinida', () => {
    const conf = result(evaluateHypotheses(byStyle({ repetitivo: runs('weapon_repertoire', 30, 0, 0, 29) }), rngOf(), 10), 'H1u');
    expect(conf.verdict).toBe('confirmada');
    expect(conf.style).toBe('repetitivo');
    expect(conf.undefinedRate).toBeCloseTo(29 / 30, 9);
    expect(conf.nRuns).toBe(30);
    expect([conf.delta, conf.lo, conf.hi, conf.nHigher, conf.nLower, conf.undefinedRateLower]).toEqual([
      null,
      null,
      null,
      0,
      0,
      null,
    ]);

    const ref = result(evaluateHypotheses(byStyle({ repetitivo: runs('weapon_repertoire', 30, 0, 0, 20) }), rngOf(), 10), 'H1u');
    expect(ref.verdict).toBe('refutada');
    expect(ref.undefinedRate).toBeCloseTo(20 / 30, 9);

    const ind = result(evaluateHypotheses(byStyle({ repetitivo: runs('weapon_repertoire', 9, 0, 0, 9) }), rngOf(), 10), 'H1u');
    expect(ind.verdict).toBe('indefinida');
  });

  it('H1u: 19/20 undefined (exactly 95%) confirms, 18/20 refutes (integer comparison)', () => {
    const r = result(evaluateHypotheses(byStyle({ repetitivo: runs('weapon_repertoire', 20, 0, 0, 19) }), rngOf(), 10), 'H1u');
    expect(r.verdict).toBe('confirmada');
    const r2 = result(evaluateHypotheses(byStyle({ repetitivo: runs('weapon_repertoire', 20, 0, 0, 18) }), rngOf(), 10), 'H1u');
    expect(r2.verdict).toBe('refutada');
  });

  it('greater results carry no undefinedRate fields', () => {
    const h1 = result(evaluateHypotheses(byStyle({}), rngOf(), 10), 'H1');
    expect([h1.style, h1.undefinedRate, h1.nRuns]).toEqual([undefined, null, null]);
  });

  /**
   * lower = 0..9; each value 6.5 beats 7 and loses 3 (+4), 4.5 ties the score (0),
   * 3 ties one lower value and beats 3, loses 6 (-3). Replicated x10 per group
   * (delta unchanged, interval well above 0).
   */
  const rep = (xs: number[]) => Array.from({ length: 10 }, () => xs).flat();
  const asRuns = (skill: SkillId, xs: number[]) => xs.map((x, i) => wv(i, skill, x));
  const LOWER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  it('delta exactly 0.33 confirms', () => {
    const higher = [...Array(9).fill(6.5), 3];
    const rs = evaluateHypotheses(
      byStyle({ variado: asRuns('weapon_repertoire', rep(higher)), agressivo: asRuns('weapon_repertoire', rep(LOWER)) }),
      rngOf(),
      500,
    );
    const h1 = result(rs, 'H1');
    expect(h1.delta).toBe(0.33);
    expect(h1.lo!).toBeGreaterThan(0);
    expect(h1.verdict).toBe('confirmada');
  });

  it('delta 0.32 refutes even with the interval above 0', () => {
    const higher = [...Array(8).fill(6.5), 4.5, 4.5];
    const rs = evaluateHypotheses(
      byStyle({ variado: asRuns('weapon_repertoire', rep(higher)), agressivo: asRuns('weapon_repertoire', rep(LOWER)) }),
      rngOf(),
      500,
    );
    const h1 = result(rs, 'H1');
    expect(h1.delta).toBe(0.32);
    expect(h1.lo!).toBeGreaterThan(0);
    expect(h1.verdict).toBe('refutada');
  });

  it('orLowerUndefined: a 100% undefined lower group confirms regardless of delta', () => {
    const rs = evaluateHypotheses(
      byStyle({ aleatorio: runs('action_repertoire', 30, 0.2, 0.9), repetitivo: runs('action_repertoire', 30, 0, 0, 30) }),
      rngOf(),
      100,
    );
    const h12 = result(rs, 'H12');
    expect(h12.verdict).toBe('confirmada');
    expect(h12.undefinedRateLower).toBe(1);
    expect(h12.nLower).toBe(0);
    expect(h12.delta).toBeNull();
  });

  it('orLowerUndefined needs >= 10 defined values in the higher group', () => {
    const bothNull = evaluateHypotheses(
      byStyle({ aleatorio: runs('action_repertoire', 30, 0, 0, 30), repetitivo: runs('action_repertoire', 30, 0, 0, 30) }),
      rngOf(),
      50,
    );
    expect(result(bothNull, 'H12').verdict).toBe('indefinida');

    const higherEmpty = evaluateHypotheses(byStyle({ agressivo: runs('defensive_repertoire', 30, 0, 0, 30) }), rngOf(), 50);
    expect(result(higherEmpty, 'H5').verdict).toBe('indefinida');
    expect(result(higherEmpty, 'H5').nHigher).toBe(0);

    const higher12 = evaluateHypotheses(
      byStyle({
        aleatorio: runs('defensive_repertoire', 12, 0.2, 0.9),
        agressivo: runs('defensive_repertoire', 30, 0, 0, 30),
      }),
      rngOf(),
      50,
    );
    expect(result(higher12, 'H5').verdict).toBe('confirmada');
    expect(result(higher12, 'H5').nHigher).toBe(12);
  });

  it('orLowerUndefined with a lower group of 5 runs, all null, is indefinida', () => {
    const rs = evaluateHypotheses(
      byStyle({ aleatorio: runs('action_repertoire', 30, 0.2, 0.9), repetitivo: runs('action_repertoire', 5, 0, 0, 5) }),
      rngOf(),
      50,
    );
    expect(result(rs, 'H12').verdict).toBe('indefinida');
  });

  it('orLowerUndefined does not apply without the flag (H6)', () => {
    const rs = evaluateHypotheses(
      byStyle({
        aleatorio: runs('defensive_repertoire', 30, 0.2, 0.9),
        evasivo: runs('defensive_repertoire', 30, 0, 0, 30),
      }),
      rngOf(),
      100,
    );
    expect(result(rs, 'H6').verdict).toBe('indefinida');
  });

  it('is deterministic for the same seed and never NaN', () => {
    const data = byStyle(
      Object.fromEntries(
        STYLE_IDS.map((s, k) => [
          s,
          REPORT_SKILLS.flatMap((skill, j) => runs(skill, 30, (k * 0.1 + j * 0.03) % 0.5, 0.5 + ((k * 0.07) % 0.4), (k + j) % 3)),
        ]),
      ),
    );
    const a = evaluateHypotheses(data, rngOf(11), 300);
    const b = evaluateHypotheses(data, rngOf(11), 300);
    expect(a).toEqual(b);
    for (const r of a) {
      for (const v of [r.delta, r.lo, r.hi, r.undefinedRateLower, r.nHigher, r.nLower]) {
        if (v !== null) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('dropEmptyRuns', () => {
  it('drops every window (run and room) of the listed run_idx', () => {
    const values = [wv(0, 'distance', 0.1), wv(1, 'distance', null), wv(1, 'distance', null, 0), wv(2, 'distance', 0.3, 1)];
    expect(dropEmptyRuns(values, [1])).toEqual([values[0], values[3]]);
    expect(dropEmptyRuns(values, [])).toEqual(values);
  });

  it('feeding undropped empty-run windows changes an undefinedRate verdict', () => {
    // 10 real runs, 9 undefined (90%: refutada) + 10 empty runs (all null) -> 19/20 = 95%: confirmada.
    const real = runs('weapon_repertoire', 10, 0.5, 0.5, 9);
    const empty = Array.from({ length: 10 }, (_, i) => wv(100 + i, 'weapon_repertoire', null));
    const emptyIdx = empty.map((v) => v.runIdx);
    const raw = result(evaluateHypotheses(byStyle({ repetitivo: [...real, ...empty] }), rngOf(), 10), 'H1u');
    const dropped = result(
      evaluateHypotheses(byStyle({ repetitivo: dropEmptyRuns([...real, ...empty], emptyIdx) }), rngOf(), 10),
      'H1u',
    );
    expect(raw.verdict).toBe('confirmada');
    expect(dropped.verdict).toBe('refutada');
    expect(dropped.nRuns).toBe(10);
  });
});

describe('prepareValues', () => {
  // seed 4242, 3 runs, 2 per session: the deaths that end sessions leave empty runs 2 and 4.
  const LOG = playAgent('agressivo', { ...DEFAULT_EXPERIMENT, seed: 4242, runsPerAgent: 3, runsPerSession: 2, runCapMs: 20_000 }, 0);

  it('drops the empty runs and keeps the others', () => {
    expect(LOG.emptyRuns).toEqual([2, 4]);
    const raw = runWindowValues(LOG.events, LOG.playerId);
    expect(new Set(raw.map((v) => v.runIdx)).has(2)).toBe(true); // the raw windows do include them
    const { runValues, roomValues } = prepareValues([LOG]);
    const runIdxs = new Set(runValues.agressivo.map((v) => v.runIdx));
    const roomRunIdxs = new Set(roomValues.agressivo.map((v) => v.runIdx));
    for (const set of [runIdxs, roomRunIdxs]) {
      expect(set.has(2)).toBe(false);
      expect(set.has(4)).toBe(false);
    }
    expect([...runIdxs].sort()).toEqual([0, 1, 3]);
    expect(roomValues.agressivo.every((v) => v.roomIdx !== null)).toBe(true);
    expect(runValues.agressivo.every((v) => v.roomIdx === null)).toBe(true);
    for (const s of STYLE_IDS) if (s !== 'agressivo') expect([runValues[s], roomValues[s]]).toEqual([[], []]);
  });
});

/** roomValues for one style: `runsN` runs x `roomsN` rooms, value from `f(run, room)`. */
function rooms(skill: SkillId, runsN: number, roomsN: number, f: (run: number, room: number) => number | null): WindowValue[] {
  const out: WindowValue[] = [];
  for (let r = 0; r < runsN; r++) for (let m = 0; m < roomsN; m++) out.push(wv(r, skill, f(r, m), m));
  return out;
}

describe('iccBySkill', () => {
  it('one row per reported dimension, no styleId', () => {
    const rs = iccBySkill(byStyle({}), rngOf(), 10);
    expect(rs.map((r) => r.skill)).toEqual(REPORT_SKILLS);
    for (const r of rs) {
      expect(r.styleId).toBeUndefined();
      expect([r.nAgents, r.icc, r.lo, r.hi, r.belowCriterion]).toEqual([0, null, null, null, null]);
    }
  });

  it('between-agent variation gives icc > 0.8 and belowCriterion false', () => {
    const rng = createPrng(3).next;
    const data = byStyle(
      Object.fromEntries(STYLE_IDS.map((s, k) => [s, rooms('punish', 6, 4, () => k * 0.12 + rng() * 0.02)])),
    );
    const punish = iccBySkill(data, rngOf(), 300).find((r) => r.skill === 'punish')!;
    expect(punish.icc!).toBeGreaterThan(0.8);
    expect(punish.belowCriterion).toBe(false);
    expect(punish.lo!).toBeLessThanOrEqual(punish.icc!);
    expect(punish.hi!).toBeGreaterThanOrEqual(punish.icc!);
  });

  it('pure noise gives icc near 0 and belowCriterion true', () => {
    const rng = createPrng(5).next;
    const data = byStyle(Object.fromEntries(STYLE_IDS.map((s) => [s, rooms('distance', 10, 5, () => rng())])));
    const d = iccBySkill(data, rngOf(), 200).find((r) => r.skill === 'distance')!;
    expect(Math.abs(d.icc!)).toBeLessThan(0.15);
    expect(d.belowCriterion).toBe(true);
  });

  it('groups with fewer than 2 defined measures give icc null', () => {
    const data = byStyle(
      Object.fromEntries(STYLE_IDS.map((s, k) => [s, rooms('patience', 3, 2, (r, m) => (r === 0 && m === 0 ? k * 0.1 : null))])),
    );
    const p = iccBySkill(data, rngOf(), 50).find((r) => r.skill === 'patience')!;
    expect([p.nAgents, p.icc, p.lo, p.hi, p.belowCriterion]).toEqual([0, null, null, null, null]);
  });

  it('nAgents counts only agents with >= 2 defined measures (all-null agents are dropped)', () => {
    const rng = createPrng(13).next;
    const data = byStyle(
      Object.fromEntries(
        STYLE_IDS.map((s, k) => [s, rooms('weapon_repertoire', 4, 3, () => (s === 'repetitivo' ? null : k * 0.1 + rng() * 0.02))]),
      ),
    );
    const w = iccBySkill(data, rngOf(), 50).find((r) => r.skill === 'weapon_repertoire')!;
    expect(w.nAgents).toBe(6);
    expect(w.icc).not.toBeNull();
  });

  it('ignores run windows and undefined room values; deterministic', () => {
    const rng = createPrng(9).next;
    const base = Object.fromEntries(
      STYLE_IDS.map((s, k) => [s, rooms('distance', 5, 4, (r, m) => (m === 3 ? null : k * 0.1 + rng() * 0.05))]),
    ) as Record<StyleId, WindowValue[]>;
    const noisy = byStyle(
      Object.fromEntries(STYLE_IDS.map((s) => [s, [...base[s], wv(0, 'distance', 99), wv(1, 'distance', -99)]])),
    );
    const a = iccBySkill(byStyle(base), rngOf(4), 100);
    const b = iccBySkill(noisy, rngOf(4), 100);
    expect(b).toEqual(a);
    expect(a.find((r) => r.skill === 'distance')!.icc).not.toBeNull();
  });
});
