import { describe, it, expect } from 'vitest';
import { EventTape, summarize } from './eventTape';
import { mk } from './testing/events';

describe('EventTape', () => {
  it('keeps only the last 40 entries in order', () => {
    const tape = new EventTape();
    const events = Array.from({ length: 50 }, (_, i) => mk('pos.sample', i * 10, { p: [0, 0], e: [0, 0] }));
    for (const ev of events) tape.push(ev);
    const entries = tape.entries();
    expect(entries).toHaveLength(40);
    expect(entries[0].seq).toBe(events[10].seq);
    expect(entries[39].seq).toBe(events[49].seq);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].seq).toBeGreaterThan(entries[i - 1].seq);
    }
  });

  it('honours a custom capacity and clear() empties the tape', () => {
    const tape = new EventTape(3);
    for (let i = 0; i < 5; i++) tape.push(mk('pos.sample', i, { p: [0, 0], e: [0, 0] }));
    expect(tape.entries().map((e) => e.t_ms)).toEqual([2, 3, 4]);
    tape.clear();
    expect(tape.entries()).toEqual([]);
  });

  it('maps each event to seq, t_ms, type and summary', () => {
    const tape = new EventTape();
    const ev = mk('player.action', 123.4, { actionId: 'sword_shield.light' });
    tape.push(ev);
    expect(tape.entries()).toEqual([
      { seq: ev.seq, t_ms: 123.4, type: 'player.action', summary: 'sword_shield.light' },
    ]);
  });
});

describe('summarize', () => {
  it('summarizes player.action by its actionId', () => {
    expect(summarize(mk('player.action', 0, { actionId: 'sword_shield.light' }))).toBe('sword_shield.light');
  });

  it('summarizes player.cancel as by (actionId)', () => {
    expect(summarize(mk('player.cancel', 0, { by: 'move', actionId: 'sword_shield.light' }))).toBe(
      'move (sword_shield.light)',
    );
  });

  it('summarizes opp.close as opp_type outcome', () => {
    expect(summarize(mk('opp.close', 0, { opp_type: 'dodge', outcome: 'taken' }))).toBe('dodge taken');
  });

  it('appends the reason to opp.close when present', () => {
    expect(
      summarize(mk('opp.close', 0, { opp_type: 'punish', outcome: 'invalid', reason: 'out_of_range' })),
    ).toBe('punish invalid (out_of_range)');
  });

  it('summarizes player.hurt as dmg and hp', () => {
    expect(summarize(mk('player.hurt', 0, { dmg: 20, hp_after: 80 }))).toBe('dmg=20 hp=80');
  });

  it('summarizes stamina, item and projectile events and rejects bad payloads', () => {
    expect(summarize(mk('player.stamina_denied', 0, { action: 'dodge' }))).toBe('negada dodge');
    expect(summarize(mk('player.guard_break', 0))).toBe('guard break');
    expect(summarize(mk('item.spawn', 0, { kind: 'heal' }))).toBe('surgiu heal');
    expect(summarize(mk('item.pickup', 0, { kind: 'bomb', wait_ms: 4000.4 }))).toBe('pegou bomb (4000 ms)');
    expect(summarize(mk('item.expire', 0, { kind: 'power', reason: 'timeout' }))).toBe('sumiu power (timeout)');
    expect(summarize(mk('item.use', 0, { kind: 'heal', effective: false }))).toBe('usou heal (desperdício)');
    expect(summarize(mk('item.use', 0, { kind: 'heal', effective: true }))).toBe('usou heal');
    expect(summarize(mk('projectile.hit', 0, { id: 1, dmg: 7 }))).toBe('projétil acertou dmg=7');
    expect(summarize(mk('projectile.expire', 0, { id: 1 }))).toBe('projétil expirou');
    expect(summarize(mk('item.pickup', 0, { kind: 'bomb', wait_ms: 'x' }))).toBe('');
    expect(summarize(mk('player.stamina_denied', 0, {}))).toBe('');
  });

  it('summarizes pos.sample as pos', () => {
    expect(summarize(mk('pos.sample', 0, { p: [1, 2], e: [3, 4] }))).toBe('pos');
  });

  it('returns an empty string for an unknown type', () => {
    expect(summarize(mk('some.unknown', 0, { foo: 1 }))).toBe('');
  });

  it('returns an empty string for an invalid payload without throwing', () => {
    expect(summarize(mk('player.action', 0, {}))).toBe('');
    expect(summarize(mk('player.cancel', 0, { by: 'move' }))).toBe('');
    expect(summarize(mk('opp.close', 0, { opp_type: 'dodge' }))).toBe('');
    expect(summarize(mk('player.hurt', 0, { dmg: NaN, hp_after: 80 }))).toBe('');
    expect(summarize(mk('player.hurt', 0, { dmg: 'x', hp_after: 80 }))).toBe('');
    expect(() => summarize(null as never)).not.toThrow();
    expect(summarize(null as never)).toBe('');
  });
});
