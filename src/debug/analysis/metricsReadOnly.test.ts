// src/debug/analysis/metricsReadOnly.test.ts
import { describe, it, expect } from 'vitest';
import { makeBotStack, runBot } from '../../telemetry/testing/scriptedBot';
import { MetricsAggregator } from './metricsAggregator';
import { EventTape } from './eventTape';

function record(observed: boolean) {
  const { stack } = makeBotStack();
  stack.startSession({ wall_clock_iso: '2026-09-30T00:00:00.000Z', game_version: 'test', schema_v: 2 }, null);
  const agg = new MetricsAggregator();
  const tape = new EventTape();
  if (observed) stack.recorder.subscribe((e) => { agg.apply(e); tape.push(e); });
  // identical 600-tick chunks in both runs; only the observed run reads the metrics in between
  for (let i = 0; i < 50; i++) {
    runBot(stack, 600);
    if (observed) {
      agg.snapshot();
      tape.entries();
    }
  }
  return stack.recorder.drain();
}

describe('metrics are read-only', () => {
  it('recording with the aggregator, tape and view model subscribed yields exactly the same log as without them', () => {
    const without = record(false);
    const withObservers = record(true);
    expect(without.length).toBeGreaterThan(100);
    expect(withObservers).toEqual(without);
  });
});
