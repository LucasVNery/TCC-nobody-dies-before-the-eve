import { describe, it, expect } from 'vitest';
import { rebuildProfileWithStats } from '../../telemetry/replay';
import type { LoggedEvent } from '../../telemetry/schema';
import { DEFAULT_EXPERIMENT, playAgent, type AgentLog } from './agentRunner';
import { checkAgentLog, type PipelineCheck } from './pipelineChecks';

// One small real log, shared by every test (2 sessions of 1 run: exercises the rebuild across sessions).
const LOG: AgentLog = playAgent(
  'agressivo',
  { ...DEFAULT_EXPERIMENT, runsPerAgent: 2, runsPerSession: 1, runCapMs: 15_000 },
  0,
);

const check = (cs: PipelineCheck[], id: string): PipelineCheck => {
  const c = cs.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
};

const IDS = ['live-equals-rebuilt', 'no-skipped-observations', 'no-malformed-metrics', 'run-accounting', 'seq-contiguous'];

describe('checkAgentLog', () => {
  it('a real small AgentLog passes every check', () => {
    expect(LOG.sessions).toBeGreaterThanOrEqual(2);
    const cs = checkAgentLog(LOG);
    expect(cs.map((c) => c.id)).toEqual(IDS);
    for (const c of cs) expect(c, c.detail).toMatchObject({ ok: true });
  });

  it('an injected malformed obs.defense fails no-skipped-observations with the detail', () => {
    const last = LOG.events[LOG.events.length - 1];
    const bad: LoggedEvent = { ...last, seq: last.seq + 1, type: 'obs.defense', label: 'xx' };
    const cs = checkAgentLog({ ...LOG, events: [...LOG.events, bad] });
    const c = check(cs, 'no-skipped-observations');
    expect(c.ok).toBe(false);
    expect(c.detail).toContain('skipped=1');
    expect(check(cs, 'seq-contiguous').ok).toBe(true);
  });

  it('a tampered live profile fails live-equals-rebuilt', () => {
    const tampered = rebuildProfileWithStats([], LOG.playerId).accumulator;
    const c = check(checkAgentLog({ ...LOG, live: tampered }), 'live-equals-rebuilt');
    expect(c.ok).toBe(false);
    expect(c.detail.length).toBeGreaterThan(0);
  });

  it('a wrong run count fails run-accounting', () => {
    const c = check(checkAgentLog({ ...LOG, completedRuns: LOG.completedRuns + 1 }), 'run-accounting');
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/run\.start=\d+/);
  });

  it('a seq gap fails seq-contiguous and names the session', () => {
    const events = LOG.events.map((e, i) => (i === 3 ? { ...e, seq: e.seq + 5 } : e));
    const c = check(checkAgentLog({ ...LOG, events }), 'seq-contiguous');
    expect(c.ok).toBe(false);
    expect(c.detail).toContain(LOG.events[3].session_id);
  });

  it('an event no aggregator accepts fails no-malformed-metrics', () => {
    const last = LOG.events[LOG.events.length - 1];
    const bad = { ...last, seq: last.seq + 1, t_ms: 'x' } as unknown as LoggedEvent;
    const c = check(checkAgentLog({ ...LOG, events: [...LOG.events, bad] }), 'no-malformed-metrics');
    expect(c.ok).toBe(false);
    expect(c.detail).toContain('malformed=');
  });
});
