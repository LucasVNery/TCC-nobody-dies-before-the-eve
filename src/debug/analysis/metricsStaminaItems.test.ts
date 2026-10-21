import { describe, expect, it } from 'vitest';
import { metricsFromLog, MetricsAggregator } from './metricsAggregator';
import { mk } from './testing/events';

const S = (t: number, stam?: number, spent?: Record<string, number>) =>
  mk('pos.sample', t, {
    p: [0, 0], e: [0, 0], p_state: 'idle', e_state: 'idle',
    ...(stam === undefined ? {} : { stam }),
    ...(spent === undefined ? {} : { spent }),
  });

const spent = (attack = 0, sprint = 0, dodge = 0, block = 0) => ({ attack, sprint, dodge, block });

describe('stamina metrics', () => {
  const log = [
    S(0, 100, spent(0, 0, 0, 0)),
    S(250, 50, spent(10, 5, 0, 0)),
    S(500, 0, spent(20, 0, 15, 10)),
  ];

  it('weights each interval by the stam at its end', () => {
    const s = metricsFromLog(log).windows.history.stamina;
    expect(s.meanLevel).toBe(25);
    expect(s.highFraction).toBe(0);
    expect(s.exhaustedFraction).toBe(0.5);
  });

  it('counts the high fraction at stam >= 80', () => {
    const s = metricsFromLog([S(0, 50), S(250, 80), S(500, 79.9)]).windows.history.stamina;
    expect(s.highFraction).toBe(0.5);
  });

  it('sums spent by kind and derives spentPerMinute from elapsedMs', () => {
    const w = metricsFromLog(log).windows.history;
    expect(w.stamina.spentByKind).toEqual({ attack: 30, sprint: 5, dodge: 15, block: 10 });
    expect(w.elapsedMs).toBe(500);
    expect(w.stamina.spentPerMinute).toBeCloseTo(60 / (500 / 60000), 6);
  });

  it('counts denied, guard breaks and perfect dodges', () => {
    const s = metricsFromLog([
      mk('player.stamina_denied', 10, { action: 'dodge' }),
      mk('player.stamina_denied', 20, { action: 'block' }),
      mk('player.stamina_denied', 30, { action: 'slash' }),
      mk('player.guard_break', 40),
      mk('player.defense', 50, { label: 'dodge', perfect: true }),
      mk('player.defense', 60, { label: 'dodge' }),
      mk('player.defense', 70, { label: 'block' }),
    ]).windows.history.stamina;
    expect(s.denied).toBe(3);
    expect(s.guardBreaks).toBe(1);
    expect(s.perfectDodges).toBe(1);
    expect(s.dodges).toBe(2);
    expect(s.perfectRate).toBe(0.5);
  });

  it('does not bridge intervals across run.start', () => {
    const s = metricsFromLog([S(0, 100), mk('run.start', 100), S(250, 0)]).windows.history.stamina;
    expect(s.meanLevel).toBeNull();
  });

  it('isolates the four windows', () => {
    const m = metricsFromLog([
      mk('session.start', 0),
      mk('run.start', 1),
      mk('encounter.start', 2),
      mk('player.stamina_denied', 3, { action: 'dodge' }),
      mk('encounter.start', 4),
      mk('player.guard_break', 5),
      mk('run.start', 6),
      mk('player.stamina_denied', 7, { action: 'block' }),
      mk('item.spawn', 8, { item_id: 'a', kind: 'heal', x: 0, y: 0 }),
      mk('encounter.start', 9),
    ]).windows;
    expect(m.encounter.stamina.denied).toBe(0);
    expect(m.run.stamina.denied).toBe(1);
    expect(m.run.items.spawned).toBe(1);
    expect(m.encounter.items.spawned).toBe(0);
    expect(m.session.stamina.denied).toBe(2);
    expect(m.session.stamina.guardBreaks).toBe(1);
    expect(m.history.stamina.denied).toBe(2);
  });

  it('old logs without stam/spent give null and zeros, and are not malformed', () => {
    const agg = new MetricsAggregator();
    agg.applyAll([S(0), S(250), S(500)]);
    const snap = agg.snapshot();
    const s = snap.windows.history.stamina;
    expect(snap.malformed).toBe(0);
    expect(s.meanLevel).toBeNull();
    expect(s.highFraction).toBeNull();
    expect(s.exhaustedFraction).toBeNull();
    expect(s.spentPerMinute).toBeNull();
    expect(s.spentByKind).toEqual({ attack: 0, sprint: 0, dodge: 0, block: 0 });
    expect(s.perfectRate).toBeNull();
    expect(snap.windows.history.items.pickRate).toBeNull();
    expect(snap.windows.history.samples).toBe(3);
  });
});

describe('item metrics', () => {
  const spawn = (t: number, id: string, kind = 'heal') => mk('item.spawn', t, { item_id: id, kind, x: 1, y: 2 });

  it('pick rate and mean wait', () => {
    const it_ = metricsFromLog([
      spawn(0, 'a'), spawn(1, 'b', 'power'), spawn(2, 'c', 'bomb'),
      mk('item.pickup', 3, { item_id: 'a', kind: 'heal', wait_ms: 4000 }),
      mk('item.expire', 4, { item_id: 'b', kind: 'power', reason: 'timeout' }),
      mk('item.expire', 5, { item_id: 'c', kind: 'bomb', reason: 'run_end' }),
    ]).windows.history.items;
    expect(it_.spawned).toBe(3);
    expect(it_.picked).toBe(1);
    expect(it_.expired).toBe(2);
    expect(it_.pickRate).toBeCloseTo(1 / 3, 10);
    expect(it_.meanWaitMs).toBe(4000);
  });

  it('uses by kind, wasted uses and mean held time', () => {
    const use = (t: number, kind: string, effective: boolean, held_ms: number) =>
      mk('item.use', t, { kind, hp: 50, dist_to_enemy: 100, held_ms, effective });
    const it_ = metricsFromLog([
      use(1, 'heal', false, 1000), use(2, 'heal', true, 3000), use(3, 'bomb', true, 2000),
    ]).windows.history.items;
    expect(it_.uses).toEqual({ heal: 2, power: 0, bomb: 1 });
    expect(it_.wastedUses).toBe(1);
    expect(it_.meanHeldMs).toBe(2000);
  });

  it('malformed item events are counted malformed and change nothing', () => {
    const agg = new MetricsAggregator();
    agg.applyAll([
      mk('item.pickup', 1, { item_id: 'a', kind: 'heal' }),
      mk('item.use', 2, { kind: 'sword', hp: 1, dist_to_enemy: 1, held_ms: 1, effective: true }),
      mk('item.spawn', 3, { item_id: 'a', kind: 'nope' }),
    ]);
    const snap = agg.snapshot();
    expect(snap.malformed).toBe(3);
    expect(snap.windows.history.items.picked).toBe(0);
    expect(snap.windows.history.items.spawned).toBe(0);
  });
});
