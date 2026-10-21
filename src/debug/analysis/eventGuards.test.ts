import { describe, it, expect } from 'vitest';
import { isWellFormed } from './eventGuards';
import { mk } from './testing/events';

describe('isWellFormed', () => {
  it('pos.sample without stam/spent (old log) is well formed; a non-numeric stam is not', () => {
    expect(isWellFormed(mk('pos.sample', 0, { p: [1, 2], e: [3, 4] }))).toBe(true);
    expect(isWellFormed(mk('pos.sample', 0, { p: [1, 2], e: [3, 4], stam: 50, spent: { attack: 0 } }))).toBe(true);
    expect(isWellFormed(mk('pos.sample', 0, { p: [1, 2], e: [3, 4], stam: 'x' }))).toBe(false);
    expect(isWellFormed(mk('pos.sample', 0, { p: [1, 2], e: [3, 4], stam: NaN }))).toBe(false);
    for (const spent of ['x', null, { attack: 'a' }]) {
      expect(isWellFormed(mk('pos.sample', 0, { p: [1, 2], e: [3, 4], spent }))).toBe(false);
    }
    expect(isWellFormed(mk('pos.sample', 0, { p: [1, 2], e: [3, 4], spent: { attack: 0 } }))).toBe(true);
  });

  it('accepts a well-formed pos.sample and rejects NaN, wrong arity and non-array positions', () => {
    expect(isWellFormed(mk('pos.sample', 0, { p: [1, 2], e: [3, 4] }))).toBe(true);
    expect(isWellFormed(mk('pos.sample', 0, { p: [NaN, 2], e: [3, 4] }))).toBe(false);
    expect(isWellFormed(mk('pos.sample', 0, { p: [1], e: [3, 4] }))).toBe(false);
    expect(isWellFormed(mk('pos.sample', 0, { p: 'x', e: [3, 4] }))).toBe(false);
  });
  it('rejects player.action without string actionType and weaponId', () => {
    expect(isWellFormed(mk('player.action', 0, { actionType: 'light', weaponId: 'w' }))).toBe(true);
    expect(isWellFormed(mk('player.action', 0, { weaponId: 'w' }))).toBe(false);
    expect(isWellFormed(mk('player.action', 0, { actionType: 'light' }))).toBe(false);
  });
  it('rejects opp.close with unknown outcome or opp_type', () => {
    const ok = { opp_id: 'a', opp_type: 'dodge', outcome: 'taken' };
    expect(isWellFormed(mk('opp.close', 0, ok))).toBe(true);
    expect(isWellFormed(mk('opp.close', 0, { ...ok, outcome: 'zzz' }))).toBe(false);
    expect(isWellFormed(mk('opp.close', 0, { ...ok, opp_type: 'zzz' }))).toBe(false);
  });
  it('rejects player.cancel with unknown by', () => {
    expect(isWellFormed(mk('player.cancel', 0, { by: 'dash' }))).toBe(true);
    expect(isWellFormed(mk('player.cancel', 0, { by: 'fly' }))).toBe(false);
  });
  it('validates the stamina, item and projectile events', () => {
    expect(isWellFormed(mk('player.stamina_denied', 0, { action: 'dodge' }))).toBe(true);
    expect(isWellFormed(mk('player.stamina_denied', 0, {}))).toBe(false);
    expect(isWellFormed(mk('player.guard_break', 0))).toBe(true);
    expect(isWellFormed(mk('item.spawn', 0, { item_id: 'a', kind: 'bomb', x: 1, y: 2 }))).toBe(true);
    expect(isWellFormed(mk('item.spawn', 0, { item_id: 'a', kind: 'axe' }))).toBe(false);
    expect(isWellFormed(mk('item.pickup', 0, { item_id: 'a', kind: 'heal', wait_ms: 10 }))).toBe(true);
    expect(isWellFormed(mk('item.pickup', 0, { item_id: 'a', kind: 'heal', wait_ms: NaN }))).toBe(false);
    expect(isWellFormed(mk('item.expire', 0, { item_id: 'a', kind: 'power', reason: 'timeout' }))).toBe(true);
    const use = { kind: 'heal', hp: 1, dist_to_enemy: 2, held_ms: 3, effective: true };
    expect(isWellFormed(mk('item.use', 0, use))).toBe(true);
    expect(isWellFormed(mk('item.use', 0, { ...use, effective: 'yes' }))).toBe(false);
    expect(isWellFormed(mk('item.use', 0, { ...use, held_ms: Infinity }))).toBe(false);
    expect(isWellFormed(mk('projectile.hit', 0, { id: 1, dmg: 5 }))).toBe(true);
    expect(isWellFormed(mk('projectile.hit', 0, { id: 1 }))).toBe(false);
    expect(isWellFormed(mk('projectile.expire', 0, { id: 1 }))).toBe(true);
    expect(isWellFormed(mk('projectile.expire', 0, {}))).toBe(false);
  });
  it('passes event types the metrics do not read', () => {
    expect(isWellFormed(mk('obs.record', 0, { anything: NaN }))).toBe(true);
  });
});
