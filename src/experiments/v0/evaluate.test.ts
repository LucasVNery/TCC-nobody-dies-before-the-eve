import { describe, it, expect } from 'vitest';
import { createPrng } from '../../core/prng';
import type { SkillId } from '../../profile/types';
import { HYPOTHESES } from './hypotheses';
import { dropEmptyRuns, evaluateHypotheses, iccBySkill, type HypothesisResult } from './evaluate';
import { STYLE_IDS, type StyleId } from './styles';
import { REPORT_SKILLS, type WindowValue } from './windowValues';

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
    expect(conf.undefinedRateLower).toBeCloseTo(29 / 30, 9);
    expect(conf.nLower).toBe(1);
    expect([conf.delta, conf.lo, conf.hi]).toEqual([null, null, null]);

    const ref = result(evaluateHypotheses(byStyle({ repetitivo: runs('weapon_repertoire', 30, 0, 0, 20) }), rngOf(), 10), 'H1u');
    expect(ref.verdict).toBe('refutada');
    expect(ref.undefinedRateLower).toBeCloseTo(20 / 30, 9);

    const ind = result(evaluateHypotheses(byStyle({ repetitivo: runs('weapon_repertoire', 9, 0, 0, 9) }), rngOf(), 10), 'H1u');
    expect(ind.verdict).toBe('indefinida');
  });

  it('H1u: exactly 95% undefined confirms (integer comparison, no float drift)', () => {
    const r = result(evaluateHypotheses(byStyle({ repetitivo: runs('weapon_repertoire', 20, 0, 0, 19) }), rngOf(), 10), 'H1u');
    expect(r.verdict).toBe('confirmada');
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
      expect([r.icc, r.lo, r.hi, r.belowCriterion]).toEqual([null, null, null, null]);
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
    expect([p.icc, p.lo, p.hi, p.belowCriterion]).toEqual([null, null, null, null]);
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
