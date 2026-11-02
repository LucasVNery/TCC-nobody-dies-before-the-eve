import { describe, it, expect } from 'vitest';
import { MetricsAggregator } from './metricsAggregator';
import { EventTape } from './eventTape';
import { mk } from './testing/events';

const base = () => [
  mk('session.start', 0), mk('run.start', 1), mk('encounter.start', 2),
  mk('player.action', 3, { actionType: 'light', weaponId: 'sword' }),
  mk('enemy.hurt', 4, { dmg: 10 }),
];
const boss = () => [
  mk('profile.snapshot', 5, { at: 'boss.entry', partial: false, levels: { far: 1 }, applied: { far: 1 } }),
  mk('boss.adapt', 5, { habit: 'far', level: 1 }),
  mk('boss.barrage', 6, { habit: 'far' }),
];
const end = (extra: Record<string, unknown> = {}) =>
  mk('run.end', 9, { duration_ms: 9000, rooms_cleared: 3, encounters_cleared: 9, ...extra });

/** Windows without the raw event counter, which counts every event by design. */
function stripped(a: MetricsAggregator) {
  const w = a.snapshot().windows as unknown as Record<string, Record<string, unknown>>;
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, { ...v, events: 0 }]));
}

describe('boss events in the metrics', () => {
  it('boss.adapt, boss.barrage, profile.snapshot with levels/applied and a victory run.end do not throw or change metrics', () => {
    const plain = new MetricsAggregator();
    plain.applyAll([...base(), end()]);
    const withBoss = new MetricsAggregator();
    expect(() => withBoss.applyAll([...base(), ...boss(), end({ cause: 'victory' })])).not.toThrow();
    expect(stripped(withBoss)).toEqual(stripped(plain));
    expect(withBoss.snapshot().malformed).toBe(0);
    expect(withBoss.snapshot().eventCounts['boss.adapt']).toBe(1);
  });

  it('the event tape accepts the boss events', () => {
    const tape = new EventTape(8);
    expect(() => { for (const e of [...boss(), end({ cause: 'victory' })]) tape.push(e); }).not.toThrow();
  });
});
