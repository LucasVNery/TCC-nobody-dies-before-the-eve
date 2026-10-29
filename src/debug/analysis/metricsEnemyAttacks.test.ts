import { describe, expect, it } from 'vitest';
import { MetricsAggregator, metricsFromLog } from './metricsAggregator';
import { mk } from './testing/events';

const atk = (t: number, kind?: string, hit?: number) =>
  mk('enemy.attack_start', t, { ...(kind === undefined ? {} : { kind }), ...(hit === undefined ? {} : { hit }) });

describe('enemy attack kind metrics', () => {
  it('counts 3 swing + a combo (two strikes) + 1 slam as 6 attacks by kind', () => {
    const w = metricsFromLog([
      atk(1, 'swing'), atk(2, 'swing'), atk(3, 'swing'),
      atk(4, 'combo', 1), atk(5, 'combo', 2), atk(6, 'slam'),
    ]).windows.history.enemyAttacks;
    expect(w.count).toBe(6);
    expect(w.byKind.counts).toEqual({ swing: 3, combo: 2, slam: 1 });
    const p = [3 / 6, 2 / 6, 1 / 6];
    const h = -p.reduce((a, x) => a + x * Math.log(x), 0);
    expect(w.byKind.entropy).toBeCloseTo(h / Math.log(4), 9);
  });

  it('has no entropy with a single kind and zero count with no attacks', () => {
    const one = metricsFromLog([atk(1, 'lunge'), atk(2, 'lunge')]).windows.history.enemyAttacks;
    expect(one).toEqual({ count: 2, byKind: { counts: { lunge: 2 }, entropy: null } });
    const none = metricsFromLog([mk('run.start', 1)]).windows.history.enemyAttacks;
    expect(none).toEqual({ count: 0, byKind: { counts: {}, entropy: null } });
  });

  it('an old-log attack_start without kind counts as swing and is not malformed', () => {
    const agg = new MetricsAggregator();
    agg.applyAll([atk(1), atk(2, 'swing'), atk(3, 'lunge')]);
    const s = agg.snapshot();
    expect(s.malformed).toBe(0);
    expect(s.windows.history.enemyAttacks.count).toBe(3);
    expect(s.windows.history.enemyAttacks.byKind.counts).toEqual({ swing: 2, lunge: 1 });
  });

  it('malformed kind/hit (kind: 5, hit: 3, unknown string) are counted malformed and change nothing', () => {
    const agg = new MetricsAggregator();
    agg.applyAll([atk(1, 5 as unknown as string), atk(2, 'combo', 3), atk(3, 'laser')]);
    const s = agg.snapshot();
    expect(s.malformed).toBe(3);
    expect(s.windows.history.enemyAttacks.count).toBe(0);
    expect(s.windows.history.enemyAttacks.byKind.counts).toEqual({});
  });

  it('isolates the four windows', () => {
    const m = metricsFromLog([
      mk('session.start', 0), mk('run.start', 1), mk('encounter.start', 2),
      atk(3, 'swing'),
      mk('encounter.start', 4),
      atk(5, 'combo', 1), atk(6, 'combo', 2),
      mk('run.start', 7),
      atk(8, 'slam'),
      mk('encounter.start', 9),
    ]).windows;
    expect(m.encounter.enemyAttacks.count).toBe(0);
    expect(m.run.enemyAttacks.byKind.counts).toEqual({ slam: 1 });
    expect(m.session.enemyAttacks.byKind.counts).toEqual({ swing: 1, combo: 2, slam: 1 });
    expect(m.history.enemyAttacks.count).toBe(4);
  });
});
