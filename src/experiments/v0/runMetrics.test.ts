// src/experiments/v0/runMetrics.test.ts
import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION, type LoggedEvent } from '../../telemetry/schema';
import { StreamTracker } from '../../debug/analysis/streamTracker';
import { WindowAccumulator } from '../../debug/analysis/windowAccumulator';
import type { AgentLog } from './agentRunner';
import { prepareRunMetrics, runMetrics, runReactions, type RunMetrics } from './runMetrics';

/** Real envelope shape (as TelemetryRecorder.log): the indices are whatever the recorder holds. */
function logBuilder(playerId = 'p', sessionId = 's') {
  const events: LoggedEvent[] = [];
  let seq = 0;
  let run = 0;
  let t = 0;
  const log = (type: string, payload: Record<string, unknown> = {}, dt = 250): void => {
    t += dt;
    events.push({
      ...payload,
      v: SCHEMA_VERSION,
      seq: seq++,
      t_ms: t,
      player_id: playerId,
      session_id: sessionId,
      run_idx: run,
      room_idx: 0,
      enc_idx: 0,
      type,
    });
  };
  const spent = (attack = 0, sprint = 0, dodge = 0, block = 0) => ({ attack, sprint, dodge, block });
  return {
    events,
    log,
    spent,
    startRun(idx: number) {
      run = idx;
      log('run.start', { run_idx: idx, seed: 1 });
    },
    sample(stam: number, sp?: ReturnType<typeof spent>) {
      log('pos.sample', { p: [0, 0], e: [100, 0], p_state: 'idle', e_state: 'idle', stam, ...(sp ? { spent: sp } : {}) });
    },
  };
}

/** Independent oracle: a WindowAccumulator fed by hand with the given events, in order. */
function handFed(events: readonly LoggedEvent[]) {
  const tracker = new StreamTracker();
  const acc = new WindowAccumulator();
  for (const e of events) acc.apply(e, tracker.observe(e));
  return acc.snapshot();
}

function hasNaN(x: unknown): boolean {
  if (typeof x === 'number') return Number.isNaN(x);
  if (Array.isArray(x)) return x.some(hasNaN);
  if (x !== null && typeof x === 'object') return Object.values(x).some(hasNaN);
  return false;
}

describe('runMetrics', () => {
  it('one entry per run_idx, equal to a hand-fed WindowAccumulator over the run events', () => {
    const b = logBuilder();
    b.log('session.start', { wall_clock_iso: '2026-10-31T00:00:00.000Z' });
    b.startRun(0);
    b.sample(150, b.spent(0, 0, 0, 0));
    b.sample(130, b.spent(10, 5, 0, 0));
    b.sample(100, b.spent(0, 0, 20, 0));
    b.log('item.spawn', { item_id: 'i1', kind: 'heal' });
    b.log('item.pickup', { item_id: 'i1', kind: 'heal', wait_ms: 400 });
    b.log('item.spawn', { item_id: 'i2', kind: 'bomb' });
    b.log('item.expire', { item_id: 'i2', kind: 'bomb', reason: 'timeout' });
    b.sample(140, b.spent(0, 0, 0, 15));
    b.log('run.end', { cause: 'death', duration_ms: 2000, rooms_cleared: 0, encounters_cleared: 0 });
    const run0 = b.events.filter((e) => e.run_idx === 0 && e.type !== 'session.start');
    b.startRun(1);
    b.sample(150, b.spent(0, 0, 0, 0));
    b.sample(150, b.spent(30, 0, 0, 0));
    const run1 = b.events.filter((e) => e.run_idx === 1);

    const rs = runMetrics(b.events, 'p');
    expect(rs.map((r) => r.runIdx)).toEqual([0, 1]);

    for (const [r, evs] of [[rs[0], run0], [rs[1], run1]] as const) {
      const w = handFed(evs);
      const total = w.stamina.spentByKind.attack + w.stamina.spentByKind.sprint + w.stamina.spentByKind.dodge + w.stamina.spentByKind.block;
      expect(r.staminaSpentPerMinute).toBe(w.stamina.spentPerMinute);
      expect(r.staminaHighFraction).toBe(w.stamina.highFraction);
      expect(r.dodgeSpendShare).toBe(total > 0 ? w.stamina.spentByKind.dodge / total : null);
      expect(r.blockSpendShare).toBe(total > 0 ? w.stamina.spentByKind.block / total : null);
      expect(r.itemPickRate).toBe(w.items.pickRate);
    }
    // run 0 by hand: spent 10+5+20+15 = 50 over 2250 ms (run.start .. run.end: 9 intervals of 250 ms)
    expect(rs[0].dodgeSpendShare).toBe(20 / 50);
    expect(rs[0].blockSpendShare).toBe(15 / 50);
    expect(rs[0].itemPickRate).toBe(0.5);
    expect(rs[0].staminaSpentPerMinute).toBeCloseTo(50 / (2250 / 60000), 9);
    // run 1: only attack spending, no items
    expect(rs[1].dodgeSpendShare).toBe(0);
    expect(rs[1].itemPickRate).toBeNull();
  });

  it('a run without samples gives null for every metric, never NaN', () => {
    const b = logBuilder();
    b.startRun(0);
    b.log('player.action', { actionType: 'light', weaponId: 'sword_shield' });
    const rs = runMetrics(b.events, 'p');
    expect(rs).toEqual<RunMetrics[]>([
      {
        runIdx: 0,
        staminaSpentPerMinute: null,
        staminaHighFraction: null,
        dodgeSpendShare: null,
        blockSpendShare: null,
        itemPickRate: null,
      },
    ]);
  });

  it('spentByKind all zero gives null shares, not NaN', () => {
    const b = logBuilder();
    b.startRun(0);
    b.sample(150, b.spent());
    b.sample(150, b.spent());
    const [r] = runMetrics(b.events, 'p');
    expect(r.dodgeSpendShare).toBeNull();
    expect(r.blockSpendShare).toBeNull();
    expect(r.staminaSpentPerMinute).toBe(0);
    expect(r.staminaHighFraction).toBe(1);
    expect(hasNaN(r)).toBe(false);
  });

  it('ignores other players and the stale pre-run events of a later session', () => {
    const b = logBuilder('p', 's1');
    b.log('session.start', { wall_clock_iso: '2026-10-31T00:00:00.000Z' });
    b.startRun(0);
    b.sample(150, b.spent(10, 0, 0, 0));
    b.sample(150, b.spent(10, 0, 0, 0));
    const alone = runMetrics(b.events, 'p');

    const later = logBuilder('p', 's2');
    // a later session starts with the recorder's initial run_idx 0 before its own run.start
    later.log('session.start', { wall_clock_iso: '2026-10-31T01:00:00.000Z' });
    later.sample(10, later.spent(0, 0, 90, 0));
    later.startRun(1);
    later.sample(150, later.spent(0, 0, 0, 5));
    const other = logBuilder('q', 's3');
    other.startRun(0);
    other.sample(0, other.spent(0, 0, 99, 0));

    const rs = runMetrics([...later.events, ...other.events, ...b.events], 'p');
    expect(rs.map((r) => r.runIdx)).toEqual([0, 1]);
    expect(rs[0]).toEqual(alone[0]);
    expect(rs[1].blockSpendShare).toBe(1);
  });

  it('reactions by attack kind come from the same window (kind keys as logged)', () => {
    const b = logBuilder();
    b.startRun(0);
    b.log('enemy.attack_start', { kind: 'lunge' }, 0);
    b.log('opp.open', { opp_id: 'o1', opp_type: 'dodge', window_ms: 200 }, 100);
    b.log('player.dodge', {}, 100);
    b.log('opp.close', { opp_id: 'o1', opp_type: 'dodge', outcome: 'taken' }, 10);
    b.log('enemy.attack_start', { kind: 'weird' }, 100);
    b.log('opp.open', { opp_id: 'o2', opp_type: 'dodge', window_ms: 200 }, 50);
    b.log('player.dodge', {}, 50);
    const [r] = runReactions(b.events, 'p');
    expect(r.runIdx).toBe(0);
    expect(r.byKind).toEqual(handFed(b.events).reaction.byKind);
    expect(r.byKind).toEqual({ lunge: { n: 1, meanMs: 200 }, weird: { n: 1, meanMs: 100 } });
  });

  it('prepareRunMetrics groups by style and drops the empty runs', () => {
    const b = logBuilder();
    b.startRun(0);
    b.sample(150, b.spent(1, 0, 0, 0));
    b.startRun(1);
    b.startRun(2);
    b.sample(150, b.spent(0, 0, 1, 0));
    const log = { styleId: 'evasivo', playerId: 'p', events: b.events, emptyRuns: [1] } as unknown as AgentLog;
    const { metrics, reactions } = prepareRunMetrics([log]);
    expect(metrics.evasivo.map((r) => r.runIdx)).toEqual([0, 2]);
    expect(reactions.evasivo.map((r) => r.runIdx)).toEqual([0, 2]);
    expect(metrics.agressivo).toEqual([]);
    expect(reactions.agressivo).toEqual([]);
  });
});
