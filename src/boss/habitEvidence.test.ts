import { describe, expect, it } from 'vitest';
import { HabitEvidence } from './habitEvidence';
import { LogBuilder } from './testing/logBuilder';
import { DODGE } from '../combat/actionDefs';
import { BOSS_CONFIG } from './bossConfig';

const V = '0.0.7'; // must equal GAME_VERSION (bumped for the 1.7x boss body)
const make = (playerId = 'p1') => new HabitEvidence({ playerId, gameVersion: V });
const END = DODGE.durationMs + DODGE.cooldownMs; // earliest next dash after one at t

describe('HabitEvidence', () => {
  it('sums distance fractions and ignores other skills', () => {
    const b = new LogBuilder().sessionStart().runStart(0).distance(2, 5).distance(1, 3).record('angle', 9, 9);
    const h = make();
    h.applyAll(b.events);
    const r = h.runs()[0];
    expect(r.nearNum).toBe(3);
    expect(r.nearDen).toBe(8);
  });

  it('counts defenses by label and ignores unknown ones', () => {
    const b = new LogBuilder().sessionStart().runStart(0)
      .defense('dodge').defense('dodge').defense('block').defense('parry').defense('retreat').defense('wat');
    const h = make();
    h.applyAll(b.events);
    const r = h.runs()[0];
    expect([r.dodge, r.block, r.parry, r.retreat]).toEqual([2, 1, 1, 1]);
  });

  it('boss.entry sets facedBoss and freezes the run tallies', () => {
    const b = new LogBuilder().sessionStart().runStart(0).distance(1, 2).defense('dodge')
      .bossEntry().distance(5, 5).defense('block').dodge(100).dodge(100 + END + 50);
    const h = make();
    expect(h.facedBoss).toBe(false);
    h.applyAll(b.events);
    expect(h.facedBoss).toBe(true);
    const r = h.runs()[0];
    expect([r.nearNum, r.nearDen, r.dodge, r.block, r.reflexDashes]).toEqual([1, 2, 1, 0, 0]);
    expect(r.closed).toBe(false); // abandoned in the boss room
  });

  it('run.end closes a run; a later run.start closes an unended one', () => {
    const b = new LogBuilder().sessionStart().runStart(0).runEnd().runStart(1).distance(1, 1).runStart(2);
    const h = make();
    h.applyAll(b.events);
    expect(h.runs().map((r) => [r.runIdx, r.closed])).toEqual([[0, true], [1, true], [2, false]]);
  });

  it('counts a dash 100 ms after cooldown end as reflex, 600 ms after as not', () => {
    const b = new LogBuilder().sessionStart().runStart(0)
      .dodge(1000).dodge(1000 + END + 100) // reflex
      .dodge(1000 + END + 100 + END + 600); // too late
    const h = make();
    h.applyAll(b.events);
    expect(h.runs()[0].reflexDashes).toBe(1);
  });

  it('does not count a dash during the cooldown, or with an active threat', () => {
    const b = new LogBuilder().sessionStart().runStart(0)
      .dodge(1000).dodge(1000 + END - 10) // gap < 0
      .dodge(1000 + 2 * END + 50 - 10, 'attacking'); // threatened
    const h = make();
    h.applyAll(b.events);
    expect(h.runs()[0].reflexDashes).toBe(0);
  });

  it('accepts chasing and recovering as no-threat states', () => {
    const b = new LogBuilder().sessionStart().runStart(0)
      .dodge(0).dodge(END + 10, 'chasing').dodge(2 * END + 20, 'recovering');
    const h = make();
    h.applyAll(b.events);
    expect(h.runs()[0].reflexDashes).toBe(2);
  });

  it('uses the session cooldown when it differs from the default', () => {
    const b = new LogBuilder('p1', 's1', V, 1000).sessionStart().runStart(0)
      .dodge(0).dodge(DODGE.durationMs + 1000 + 20);
    const h = make();
    h.applyAll(b.events);
    expect(h.runs()[0].reflexDashes).toBe(1);
  });

  it('does not pair dashes across runs', () => {
    const b = new LogBuilder().sessionStart().runStart(0).dodge(0).runEnd()
      .runStart(1).dodge(END + 10);
    const h = make();
    h.applyAll(b.events);
    expect(h.runs().map((r) => r.reflexDashes)).toEqual([0, 0]);
  });

  it('ignores other players in the same log', () => {
    const a = new LogBuilder('p1', 's1').sessionStart().runStart(0).defense('dodge');
    const c = new LogBuilder('p2', 's2').sessionStart().runStart(0).defense('block').defense('block');
    const h = make('p2');
    h.applyAll([...a.events, ...c.events]);
    const r = h.runs();
    expect(r).toHaveLength(1);
    expect([r[0].dodge, r[0].block]).toEqual([0, 2]);
  });

  it('ignores sessions of another game version or without session.start', () => {
    const old = new LogBuilder('p1', 'old', '0.0.5').sessionStart().runStart(0).defense('dodge').bossEntry();
    const orphan = new LogBuilder('p1', 'orphan').runStart(1).defense('dodge');
    const h = make();
    h.applyAll([...old.events, ...orphan.events]);
    expect(h.runs()).toEqual([]);
    expect(h.facedBoss).toBe(false);
  });

  it('is incremental: applyAll(a ++ b) equals applyAll(a); applyAll(b)', () => {
    const b = new LogBuilder().sessionStart().runStart(0).distance(1, 2).dodge(0).dodge(END + 20)
      .defense('parry').runEnd().runStart(1).defense('dodge').bossEntry();
    const ev = b.events;
    for (let cut = 0; cut <= ev.length; cut++) {
      const whole = make();
      whole.applyAll(ev);
      const split = make();
      split.applyAll(ev.slice(0, cut));
      split.applyAll(ev.slice(cut));
      expect(split.runs()).toEqual(whole.runs());
      expect(split.facedBoss).toBe(whole.facedBoss);
    }
  });

  it('returns runs sorted by runIdx, as copies', () => {
    const b = new LogBuilder().sessionStart().runStart(2).defense('dodge').runStart(1).defense('block');
    const h = make();
    h.applyAll(b.events);
    const runs = h.runs();
    expect(runs.map((r) => r.runIdx)).toEqual([1, 2]);
    (runs[0] as { dodge: number }).dodge = 99;
    expect(h.runs()[0].dodge).toBe(0);
  });

  it('honours a custom config tolerance', () => {
    const cfg = { ...BOSS_CONFIG, reflexToleranceMs: 700 };
    const h = new HabitEvidence({ playerId: 'p1', gameVersion: V, config: cfg });
    h.applyAll(new LogBuilder().sessionStart().runStart(0).dodge(0).dodge(END + 600).events);
    expect(h.runs()[0].reflexDashes).toBe(1);
  });
});
