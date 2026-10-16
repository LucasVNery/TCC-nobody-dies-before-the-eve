// src/debug/analysis/metricsEquivalence.test.ts
import { describe, it, expect } from 'vitest';
import { makeBotStack, runBot } from '../../telemetry/testing/scriptedBot';
import { nextRunIdx } from '../../telemetry/replay';
import { findAbandonedRun } from '../../telemetry/abandonedRun';
import { MetricsAggregator, metricsFromLog } from './metricsAggregator';

const INFO = { wall_clock_iso: '2026-09-30T00:00:00.000Z', game_version: 'test', schema_v: 2 };

describe('metrics equivalence', () => {
  it('live aggregator equals metricsFromLog over the drained log across several runs, rooms and an abandoned run', () => {
    const { stack: stack1 } = makeBotStack({ sessionId: 's1' });
    const probe = new MetricsAggregator();
    stack1.recorder.subscribe((e) => probe.apply(e));
    stack1.startSession(INFO, null);
    runBot(stack1, 30000);
    // keep playing in short bursts until an opportunity is open, so session 2 starts with one open
    const peek = () => probe.snapshot().openWindows.length;
    for (let i = 0; i < 600 && peek() === 0; i++) runBot(stack1, 5);
    const log1 = stack1.recorder.drain();

    const { stack: stack2 } = makeBotStack({ sessionId: 's2', firstRunIdx: nextRunIdx(log1, 'p') });
    const agg = new MetricsAggregator();
    agg.applyAll(log1);
    stack2.recorder.subscribe((e) => agg.apply(e));
    stack2.startSession({ ...INFO, wall_clock_iso: '2026-09-30T01:00:00.000Z' }, findAbandonedRun(log1, 'p'));
    runBot(stack2, 30000);
    const log2 = stack2.recorder.drain();
    const log = [...log1, ...log2];

    // coverage guards
    // opportunities still open when session 1 ended: session.start must clear them
    expect(metricsFromLog(log1).openWindows.length).toBeGreaterThanOrEqual(1);
    const count = (pred: (e: (typeof log)[number]) => boolean) => log.filter(pred).length;
    expect(count((e) => e.type === 'run.end')).toBeGreaterThanOrEqual(2);
    expect(count((e) => e.type === 'run.end' && e.cause === 'abandoned')).toBeGreaterThanOrEqual(1);
    expect(count((e) => e.type === 'player.cancel')).toBeGreaterThanOrEqual(1);
    expect(count((e) => e.type === 'player.dodge')).toBeGreaterThanOrEqual(1);
    expect(count((e) => e.type === 'opp.close')).toBeGreaterThanOrEqual(1);
    expect(count((e) => e.type === 'session.start')).toBe(2);

    const live = agg.snapshot();
    expect(live).toEqual(metricsFromLog(log));
    expect(live.malformed).toBe(0);
    // elapsedMs spans both sessions: history skips the t_ms reset jump at session.start
    const hist = live.windows.history.elapsedMs;
    const sess = live.windows.session.elapsedMs;
    expect(hist).toBeGreaterThan(sess);
    expect(hist).toBeGreaterThan(Math.max(...log2.map((e) => e.t_ms)));
  });
});
