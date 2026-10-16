import { describe, expect, it } from 'vitest';
import { metricsFromLog } from './metricsAggregator';
import { mk } from './testing/events';

const S = (t: number, p: [number, number], e: [number, number] = [0, 0]) =>
  mk('pos.sample', t, { p, e, p_state: 'idle', e_state: 'idle' });

describe('position metrics', () => {
  it('M1 average speed is path length over time between consecutive samples of the same run', () => {
    const base = [S(0, [0, 0]), S(250, [25, 0]), S(500, [25, 50])];
    expect(metricsFromLog(base).windows.history.speed.avg).toBeCloseTo(150, 6);
    const s = metricsFromLog([...base, S(750, [25, 50])]).windows.history.speed;
    expect(s.avg).toBeCloseTo(100, 6);
    expect(s.moving).toBeCloseTo(150, 6);
  });

  it('run.start and session.start break continuity: no interval across them', () => {
    for (const b of ['run.start', 'session.start']) {
      const m = metricsFromLog([S(0, [0, 0]), mk(b, 100), S(250, [900, 900])]).windows.history;
      expect(m.speed.avg).toBeNull();
      expect(m.meanDistance).toBeNull();
    }
  });

  it('M2 mean distance weights each interval by its duration', () => {
    const m = metricsFromLog([
      S(0, [0, 0], [0, 0]), S(250, [0, 0], [100, 0]), S(750, [0, 0], [200, 0]),
    ]).windows.history;
    expect(m.meanDistance).toBeCloseTo(166.667, 2);
  });

  it('M14 idle fraction counts intervals ending more than 3000 ms after the last player.action or run start', () => {
    const samples: ReturnType<typeof S>[] = [];
    for (let t = 250; t <= 4000; t += 250) samples.push(S(t, [0, 0]));
    const idle = metricsFromLog([mk('run.start', 0), ...samples]).windows.history.idleFraction;
    expect(idle).toBeCloseTo(0.2667, 3);
    const act = metricsFromLog([
      mk('run.start', 0),
      ...samples.slice(0, 11),
      mk('player.action', 3000, { actionType: 'a', weaponId: 'w' }),
      ...samples.slice(11),
    ]).windows.history.idleFraction;
    expect(act).toBe(0);
  });

  it('M15 coverage counts distinct 64-unit cells per window', () => {
    const log = [S(0, [10, 10]), S(250, [100, 10]), S(500, [12, 12])];
    expect(metricsFromLog(log).windows.history.coverage).toBeCloseTo(2 / 475, 8);
    const m = metricsFromLog([...log, mk('encounter.start', 600), S(750, [10, 10])]).windows;
    expect(m.encounter.coverage).toBeCloseTo(1 / 475, 8);
    expect(m.history.coverage).toBeCloseTo(2 / 475, 8);
  });

  it('window with no samples reports null, not 0', () => {
    const m = metricsFromLog([mk('run.start', 0)]).windows.history;
    expect(m.speed).toEqual({ avg: null, moving: null });
    expect(m.meanDistance).toBeNull();
    expect(m.idleFraction).toBeNull();
    expect(m.coverage).toBeNull();
  });
});
