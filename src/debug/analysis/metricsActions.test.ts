import { describe, expect, it } from 'vitest';
import { ARENA_BOUNDS } from '../../combat/movementDefs';
import { metricsFromLog } from './metricsAggregator';
import { ARENA_CELLS } from './windowAccumulator';
import { mk } from './testing/events';

const act = (t: number, ms: number | null, actionType = 'light', weaponId = 'sword') =>
  mk('player.action', t, { actionType, weaponId, ctx: { ms_since_last_action: ms } });
const close = (t: number, opp_type: string, outcome: string, id = `o${t}`) =>
  mk('opp.close', t, { opp_id: id, opp_type, outcome });
const H = (log: Parameters<typeof metricsFromLog>[0]) => metricsFromLog(log).windows.history;

describe('action metrics', () => {
  it('ARENA_CELLS matches ARENA_BOUNDS (drift guard)', () => {
    expect(Math.ceil(ARENA_BOUNDS.width / 64) * Math.ceil(ARENA_BOUNDS.height / 64)).toBe(ARENA_CELLS);
    expect(ARENA_CELLS).toBe(475);
  });

  it('M4 action rate per minute and mean interval', () => {
    const m = H([act(0, null), act(400, 400), act(1000, 600), mk('pos.sample', 60000, { p: [0, 0], e: [0, 0] })]);
    expect(m.actions.count).toBe(3);
    expect(m.actions.perMinute).toBe(3);
    expect(m.actions.meanIntervalMs).toBe(500);
    expect(H([]).actions.perMinute).toBeNull();
    expect(H([act(0, null)]).actions.meanIntervalMs).toBeNull();
  });

  it('M5 distributions and normalized entropy', () => {
    const m = H([act(0, null, 'light'), act(1, 1, 'light'), act(2, 1, 'heavy'), act(3, 1, 'heavy')]);
    expect(m.actions.byType.counts).toEqual({ light: 2, heavy: 2 });
    expect(m.actions.byType.entropy).toBeCloseTo(Math.LN2 / Math.log(5), 6);
    expect(m.actions.byType.entropy).toBeCloseTo(0.4307, 4);
    expect(m.actions.byWeapon.counts).toEqual({ sword: 4 });
    expect(m.actions.byWeapon.entropy).toBeNull();
  });

  it('M6 defensive distribution', () => {
    const d = (t: number, label: string) => mk('player.defense', t, { label });
    const m = H([d(0, 'dodge'), d(1, 'dodge'), d(2, 'block'), d(3, 'block')]);
    expect(m.defenses.counts).toEqual({ dodge: 2, block: 2 });
    expect(m.defenses.entropy).toBeCloseTo(0.5, 10);
    expect(H([d(0, 'parry')]).defenses.entropy).toBeNull();
  });

  it('M7 and M8 per opportunity type; invalid stays out of the denominator', () => {
    const m = H([
      close(1, 'dodge', 'taken'), close(2, 'dodge', 'missed'),
      close(3, 'dodge', 'expired'), close(4, 'dodge', 'expired'),
      close(5, 'dodge', 'invalid'), close(6, 'dodge', 'invalid'), close(7, 'dodge', 'invalid'),
    ]).opportunities;
    expect(m.dodge).toMatchObject({ taken: 1, missed: 1, expired: 2, invalid: 3 });
    expect(m.dodge.rate).toBe(0.25);
    expect(m.dodge.omission).toBeCloseTo(0.6667, 4);
    expect(m.punish.rate).toBeNull();
    expect(m.punish.omission).toBeNull();
    expect(H([close(1, 'punish', 'invalid')]).opportunities.punish.rate).toBeNull();
  });

  it('M9 counts the first dodge while a dodge window is open, not earlier or later ones', () => {
    const open = (t: number, id: string) => mk('opp.open', t, { opp_id: id, opp_type: 'dodge', window_ms: 400 });
    const log = [
      mk('player.dodge', 500), // before any telegraph: ignored
      mk('enemy.attack_start', 1000), open(1000, 'a'),
      mk('player.dodge', 1300), mk('player.dodge', 1400), // second in same window: ignored
      close(1500, 'dodge', 'taken', 'a'),
      mk('player.dodge', 5000), // no window: ignored
      mk('enemy.attack_start', 6000), open(6000, 'b'), mk('player.dodge', 6500), close(6600, 'dodge', 'taken', 'b'),
      mk('enemy.attack_start', 8000), open(8000, 'c'), mk('player.dodge', 8100),
    ];
    const r = H(log).reaction;
    expect(r.n).toBe(3);
    expect(r.meanMs).toBe((300 + 500 + 100) / 3);
    expect(r.medianMs).toBe(300);
    expect(H([]).reaction).toEqual({ n: 0, meanMs: null, medianMs: null });
  });

  it('M9 median stays correct as reactions arrive after a snapshot (cache invalidation)', () => {
    const open = (t: number, id: string) => mk('opp.open', t, { opp_id: id, opp_type: 'dodge', window_ms: 400 });
    const base = [mk('enemy.attack_start', 0), open(0, 'a'), mk('player.dodge', 200)];
    expect(H(base).reaction.medianMs).toBe(200);
    const more = [...base, mk('enemy.attack_start', 1000), open(1000, 'b'), mk('player.dodge', 1400)];
    expect(H(more).reaction.medianMs).toBe(300);
  });

  it('M10 cancels by kind and per action', () => {
    const c = (t: number, by: string) => mk('player.cancel', t, { by });
    const m = H([act(0, null), act(1, 1), act(2, 1), c(3, 'move'), c(4, 'move'), c(5, 'dash')]);
    expect(m.cancels.total).toBe(3);
    expect(m.cancels.perAction).toBe(1);
    expect(m.cancels.byCause).toEqual({ move: 2, dash: 1 });
    expect(H([c(0, 'move')]).cancels.perAction).toBeNull();
  });

  it('M11 damage totals, ratio and per minute; ratio is null when nothing was taken', () => {
    const base = [mk('enemy.hurt', 0, { dmg: 10 }), mk('enemy.hurt', 1000, { dmg: 20 })];
    const m = H([...base, mk('player.hurt', 30000, { dmg: 5 }), mk('pos.sample', 60000, { p: [0, 0], e: [0, 0] })]).damage;
    expect(m).toMatchObject({ dealt: 30, taken: 5, ratio: 6, dealtPerMinute: 30, takenPerMinute: 5 });
    const n = H([...base, mk('pos.sample', 60000, { p: [0, 0], e: [0, 0] })]).damage;
    expect(n.ratio).toBeNull();
    expect(n.takenPerMinute).toBe(0);
    expect(H([mk('enemy.hurt', 0, { dmg: 3 })]).damage.dealtPerMinute).toBeNull();
  });

  it('malformed action events do not change the sums', () => {
    const good = [act(0, null), act(400, 400), mk('opp.close', 500, { opp_id: 'x', opp_type: 'dodge', outcome: 'taken' })];
    const bad = [
      mk('player.action', 10, { actionType: 'light' }),
      mk('player.action', 11, { weaponId: 'sword' }),
      mk('player.defense', 12, { label: 'nope' }),
      mk('player.cancel', 13, { by: 'teleport' }),
      mk('player.hurt', 14, { dmg: Number.NaN }),
      mk('enemy.hurt', 15, { dmg: 'x' }),
      mk('opp.close', 16, { opp_id: 'y', opp_type: 'dodge', outcome: 'bogus' }),
      mk('opp.close', 17, { opp_id: 'y', opp_type: 'bogus', outcome: 'taken' }),
    ];
    const clean = metricsFromLog(good);
    const dirty = metricsFromLog([...good.slice(0, 2), ...bad, good[2]]);
    expect(dirty.malformed).toBe(bad.length);
    expect(dirty.windows.history.actions).toEqual(clean.windows.history.actions);
    expect(dirty.windows.history.opportunities).toEqual(clean.windows.history.opportunities);
    expect(dirty.windows.history.damage.dealt).toBe(0);
    expect(dirty.windows.history.cancels.total).toBe(0);
    expect(dirty.windows.history.defenses.counts).toEqual({});
  });
});
