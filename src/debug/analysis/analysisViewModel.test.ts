import { describe, it, expect } from 'vitest';
import { mk } from './testing/events';
import { MetricsAggregator } from './metricsAggregator';
import { buildAnalysisView, diffView, type AnalysisInput, type AnalysisView } from './analysisViewModel';
import { PROFILE_SKILLS, type ProfileView } from '../../profile/profileView';
import type { SessionStatus } from '../../scenes/session/sessionController';

function profile(conf: number | ((s: string) => number), domain: number | null = null): ProfileView {
  return {
    domain: () => domain,
    confidence: (s) => (typeof conf === 'number' ? conf : conf(s)),
    deficit: () => null,
    omission: () => null,
    sampleSize: () => 0,
  };
}

const status: SessionStatus = {
  gameVersion: '0.9.1', schemaV: 2,
  playerId: 'abcdef0123456789', sessionId: '1234567890abcdef',
  runIdx: 2, roomIdx: 3, encIdx: 4, nextSeq: 99, buffered: 7,
  store: 'indexeddb', persistent: true, writeFailures: 1,
};

function input(over: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    metrics: new MetricsAggregator().snapshot(),
    profile: profile(0),
    live: {
      keysDown: [], move: { dx: 0, dy: 0 }, aimDeg: 0, weaponId: 'sword',
      playerState: 'idle', enemyState: 'idle', playerHp: 100, enemyHp: 100, poise: 0,
    },
    tape: [],
    status,
    perf: { fps: 60, stepMs: 0.5 },
    ...over,
  };
}

const sec = (v: AnalysisView, id: string) => v.find((s) => s.id === id)!;
const allText = (v: AnalysisView) => v.flatMap((s) => s.rows.flatMap((r) => r.cells));

describe('buildAnalysisView', () => {
  it('metrics section has one row per metric M1–M15 and four value columns plus the metric name', () => {
    const m = sec(buildAnalysisView(input()), 'metrics');
    expect(m.rows.map((r) => r.id)).toEqual(Array.from({ length: 15 }, (_, i) => `m${i + 1}`));
    expect(m.columns).toHaveLength(5);
    for (const r of m.rows) expect(r.cells).toHaveLength(5);
    expect(sec(buildAnalysisView(input()), 'metrics').rows.find((r) => r.id === 'm3')!.cells[0]).toContain('decaído');
  });

  it('M3 and M13 name their profile clock and M11 shows no sample count', () => {
    const m = sec(buildAnalysisView(input({ profile: profile(0, 0.5) })), 'metrics');
    for (const id of ['m3', 'm13']) {
      expect(m.rows.find((r) => r.id === id)!.cells.slice(1)).toEqual(['—', '—', 'estado 50% n=0', 'traço 50% n=0']);
    }
    expect(m.rows.find((r) => r.id === 'm11')!.cells[1]).toBe('0/0 (—) —');
  });

  it('absent values render as — and nothing renders NaN', () => {
    const v = buildAnalysisView(input());
    const text = allText(v);
    expect(text.some((t) => t.includes('—'))).toBe(true);
    for (const t of text) {
      expect(t).not.toContain('NaN');
      expect(t).not.toContain('undefined');
      expect(t).not.toContain('Infinity');
    }
  });

  it('profile section lists the six dimensions on both clocks, dimension 7 as "não ligada", and progress = min(1, confidence/0.6)', () => {
    const p = sec(buildAnalysisView(input({ profile: profile(0.3) })), 'profile');
    expect(p.rows).toHaveLength(PROFILE_SKILLS.length * 2 + 1);
    for (const s of PROFILE_SKILLS) {
      expect(p.rows.some((r) => r.id === `${s}.trait`)).toBe(true);
      expect(p.rows.some((r) => r.id === `${s}.state`)).toBe(true);
    }
    expect(p.rows.find((r) => r.id === 'dim7')!.cells).toContain('não ligada');
    expect(p.rows[0].cells[7]).toBe('50%');
    const hi = sec(buildAnalysisView(input({ profile: profile(0.9) })), 'profile');
    expect(hi.rows[0].cells[7]).toBe('100%');
  });

  it('registry shows the short ids (8 chars), version, run/room/encounter and write failures', () => {
    const r = sec(buildAnalysisView(input()), 'registry');
    const flat = r.rows.map((x) => x.cells.join('|')).join('\n');
    expect(flat).toContain('abcdef01');
    expect(flat).not.toContain('abcdef012');
    expect(flat).toContain('12345678');
    expect(flat).toContain('0.9.1');
    const val = (id: string) => r.rows.find((x) => x.id === id)!.cells[1];
    expect([val('run'), val('room'), val('enc'), val('failures')]).toEqual(['2', '3', '4', '1']);
  });

  it('events section lists open windows and the tape oldest to newest', () => {
    const agg = new MetricsAggregator();
    agg.apply(mk('opp.open', 100, { opp_id: 'o1', opp_type: 'dodge', src: 'atk', window_ms: 400 }));
    const tape = [
      { seq: 1, t_ms: 10, type: 'player.action', summary: 'slash' },
      { seq: 2, t_ms: 20, type: 'player.hurt', summary: '' },
    ];
    const e = sec(buildAnalysisView(input({ metrics: agg.snapshot(), tape })), 'events');
    const ids = e.rows.map((r) => r.id);
    expect(ids.some((i) => i.startsWith('open.'))).toBe(true);
    expect(ids.indexOf('tape.1')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('tape.1')).toBeLessThan(ids.indexOf('tape.2'));
  });

  it('predictor section says não implementado (5b)', () => {
    expect(sec(buildAnalysisView(input()), 'predictor').rows[0].cells[0]).toBe('não implementado (5b)');
  });
});

describe('diffView', () => {
  it('returns only the cells whose text changed, and every cell when prev is null', () => {
    const a = buildAnalysisView(input());
    const total = a.reduce((n, s) => n + s.rows.reduce((m, r) => m + r.cells.length, 0), 0);
    expect(diffView(null, a)).toHaveLength(total);
    expect(diffView(a, a)).toEqual([]);
    const b = buildAnalysisView(input({ perf: { fps: 30, stepMs: 0.5 } }));
    expect(diffView(a, b)).toEqual([{ sectionId: 'perf', rowId: 'fps', cell: 1, text: '30' }]);
  });
});
