import { describe, it, expect } from 'vitest';
import { MetricsAggregator, metricsFromLog } from './metricsAggregator';
import { mk } from './testing/events';

const act = (t: number, extra: Record<string, unknown> = {}) =>
  mk('player.action', t, { actionType: 'light', weaponId: 'sword', ...extra });

describe('MetricsAggregator', () => {
  it('windows restart on their own boundary events and history never restarts', () => {
    const a = new MetricsAggregator();
    a.applyAll([
      mk('session.start', 0), mk('run.start', 1), mk('encounter.start', 2),
      act(3), act(4), mk('encounter.start', 5), act(6),
    ]);
    const w = a.snapshot().windows;
    expect(w.encounter.actions.count).toBe(1);
    expect(w.run.actions.count).toBe(3);
    expect(w.session.actions.count).toBe(3);
    expect(w.history.actions.count).toBe(3);
    a.apply(mk('run.start', 7));
    const w2 = a.snapshot().windows;
    expect(w2.run.actions.count).toBe(0);
    expect(w2.history.actions.count).toBe(3);
  });

  it('elapsedMs sums t_ms deltas inside a session and skips the jump across sessions', () => {
    const a = new MetricsAggregator();
    a.applyAll([
      mk('x', 0, {}, { session_id: 's1' }), mk('x', 1000, {}, { session_id: 's1' }),
      mk('x', 2000, {}, { session_id: 's1' }),
      mk('x', 0, {}, { session_id: 's2' }), mk('x', 500, {}, { session_id: 's2' }),
    ]);
    expect(a.snapshot().windows.history.elapsedMs).toBe(2500);
  });

  it('cycle metrics: encounter duration, run duration and rooms per run', () => {
    const a = new MetricsAggregator();
    a.applyAll([
      mk('encounter.start', 1000), mk('encounter.end', 4000),
      mk('run.end', 5000, { duration_ms: 60000, rooms_cleared: 2, encounters_cleared: 6 }),
    ]);
    const c = a.snapshot().windows.history.cycle;
    expect(c.encounters).toBe(1);
    expect(c.meanEncounterMs).toBe(3000);
    expect(c.runs).toBe(1);
    expect(c.meanRunMs).toBe(60000);
    expect(c.meanRoomsPerRun).toBe(2);
  });

  it('eventCounts by type; malformed events are ignored and counted', () => {
    const a = new MetricsAggregator();
    a.applyAll([mk('pos.sample', 0, { p: [NaN, 0], e: [0, 0] }), mk('pos.sample', 1, { p: [0, 0], e: [0, 0] })]);
    const s = a.snapshot();
    expect(s.malformed).toBe(1);
    expect(s.eventCounts['pos.sample']).toBe(1);
  });

  it('never throws on garbage input', () => {
    const a = new MetricsAggregator();
    for (const g of [null, undefined, 5, 'x', {}, { type: 3 }] as never[]) a.apply(g);
    expect(a.snapshot().malformed).toBe(6);
  });

  it('openWindows follows opp.open and opp.close', () => {
    const a = new MetricsAggregator();
    a.apply(mk('opp.open', 100, { opp_id: 'o1', opp_type: 'dodge', src: 'atk', window_ms: 400 }));
    expect(a.snapshot().openWindows).toEqual([
      { opp_id: 'o1', opp_type: 'dodge', src: 'atk', window_ms: 400, openedAtMs: 100 },
    ]);
    a.apply(mk('opp.close', 300, { opp_id: 'o1', opp_type: 'dodge', outcome: 'taken' }));
    expect(a.snapshot().openWindows).toEqual([]);
  });

  it('an empty aggregator has only null or zero values, never NaN', () => {
    const bad: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'number') {
        if (v !== 0) bad.push(path);
      } else if (v !== null && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      } else if (v !== null) bad.push(path);
    };
    walk(new MetricsAggregator().snapshot(), 'snap');
    expect(bad).toEqual([]);
  });

  it('applyAll(history) then apply(live) equals metricsFromLog(history + live)', () => {
    const hist = [mk('session.start', 0), act(10), act(20)];
    const live = [act(30), mk('encounter.start', 40), act(50)];
    const a = new MetricsAggregator();
    a.applyAll(hist);
    for (const e of live) a.apply(e);
    expect(a.snapshot()).toEqual(metricsFromLog([...hist, ...live]));
  });

  it('folds 200000 synthetic events without throwing', () => {
    const a = new MetricsAggregator();
    for (let i = 0; i < 200000; i++) a.apply(mk('pos.sample', i * 250, { p: [i % 100, 0], e: [0, 0] }));
    expect(a.snapshot().windows.history.samples).toBe(200000);
  });
});
