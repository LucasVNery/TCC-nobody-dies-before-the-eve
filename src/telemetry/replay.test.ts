// src/telemetry/replay.test.ts
import { describe, it, expect } from 'vitest';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import type { Clock } from '../profile/types';
import { findWeaponAction } from '../combat/actionRegistry';
import { createTelemetryStack, type TelemetryStack } from './stack';
import { orderEvents, rebuildProfile, rebuildProfileWithStats, nextRunIdx } from './replay';
import type { LoggedEvent } from './schema';

const SKILLS = ['punish', 'distance', 'patience', 'weapon_repertoire', 'action_repertoire', 'defensive_repertoire'];
const CLOCKS: Clock[] = ['trait', 'state'];

function makeStack(accumulator = new ProfileAccumulator()) {
  let seed = 7;
  const runEnds = { count: 0 };
  const stack = createTelemetryStack({
    accumulator,
    playerId: 'p',
    sessionId: 's',
    firstRunIdx: 0,
    nextSeed: () => seed++,
    entitySize: 20,
    onRunEnd: () => { runEnds.count += 1; },
  });
  stack.recorder.log('session.start', { wall_clock_iso: '2026-09-30T00:00:00.000Z', game_version: 'test', schema_v: 2 });
  stack.director.start();
  return { stack, runEnds };
}

/**
 * Deterministic scripted player: chases the Assaltante, attacks on a cadence,
 * dodges now and then, alternates weapons. Only needs to be good enough to
 * produce kills, deaths, rooms and every profile write type — the coverage
 * assertions in the test guard that. If they fail, tune the cadences here;
 * never delete the assertions.
 */
function runBot(stack: TelemetryStack, ticks: number) {
  const { encounter } = stack;
  for (let i = 0; i < ticks; i++) {
    const p = encounter.player.position;
    const e = encounter.assaltante.position;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    encounter.player.setAimDirection({ x: dx, y: dy });
    const far = Math.hypot(dx, dy) > 40;
    encounter.setPlayerMoveInput(far ? dx : 0, far ? dy : 0);
    if (i % 400 === 0) encounter.player.switchWeapon('sword_shield');
    if (i % 400 === 200) encounter.player.switchWeapon('heavy_weapon');
    if (i % 20 === 0) {
      const light = findWeaponAction(encounter.player.equippedWeaponId, 'light');
      if (light) encounter.player.tryAction(light.id);
    }
    if (encounter.assaltante.state === 'attacking') encounter.player.tryDodge();
    stack.step(1000 / 60);
  }
}

function expectSameProfile(rebuilt: ProfileAccumulator, live: ProfileAccumulator) {
  expect(rebuilt.snapshot('room.exit')).toEqual(live.snapshot('room.exit'));
  for (const skill of SKILLS) {
    for (const clock of CLOCKS) {
      expect(rebuilt.domain(skill, clock)).toBe(live.domain(skill, clock));
      expect(rebuilt.confidence(skill, clock)).toBe(live.confidence(skill, clock));
      expect(rebuilt.omission(skill, clock)).toBe(live.omission(skill, clock));
    }
  }
}

describe('replay', () => {
  it('rebuilding the profile from the log reproduces the live profile exactly, across several runs', () => {
    const live = new ProfileAccumulator();
    const { stack, runEnds } = makeStack(live);
    runBot(stack, 30000);
    stack.recording.flushPending();
    const log = stack.recorder.drain();

    // coverage guards: the scenario really exercised runs, rooms and every obs type
    expect(runEnds.count).toBeGreaterThanOrEqual(2);
    expect(log.some((e) => e.type === 'profile.snapshot' && e.partial === false)).toBe(true);
    for (const t of ['obs.record', 'obs.outcome', 'obs.action', 'obs.defense', 'obs.boundary']) {
      expect(log.some((e) => e.type === t), t).toBe(true);
    }

    expectSameProfile(rebuildProfile(log), live);
  });

  it('JSON round-trip of the log still rebuilds the identical profile', () => {
    const live = new ProfileAccumulator();
    const { stack } = makeStack(live);
    runBot(stack, 6000);
    stack.recording.flushPending();
    const log = JSON.parse(JSON.stringify(stack.recorder.drain())) as LoggedEvent[];
    expectSameProfile(rebuildProfile(log), live);
  });

  it('rebuild starts after the last obs.reset, while earlier history stays in the log', () => {
    const live = new ProfileAccumulator();
    const { stack } = makeStack(live);
    runBot(stack, 6000);
    stack.recording.resetSession();
    runBot(stack, 6000);
    stack.recording.flushPending();
    const log = stack.recorder.drain();

    expect(log.filter((e) => e.type === 'obs.reset')).toHaveLength(1);
    expect(log.findIndex((e) => e.type === 'obs.action')).toBeLessThan(log.findIndex((e) => e.type === 'obs.reset'));
    expectSameProfile(rebuildProfile(log), live);
  });

  it('orderEvents sorts sessions by their session.start wall clock, then by seq', () => {
    const ev = (session_id: string, seq: number, type = 'x', extra: Record<string, unknown> = {}): LoggedEvent => ({
      v: 2, seq, t_ms: 0, player_id: 'p', session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type, ...extra,
    });
    const later = ev('zzz', 0, 'session.start', { wall_clock_iso: '2026-09-02T00:00:00.000Z' });
    const earlier = ev('aaa', 0, 'session.start', { wall_clock_iso: '2026-09-01T00:00:00.000Z' });
    const ordered = orderEvents([ev('zzz', 1), later, ev('aaa', 1), earlier]);
    expect(ordered.map((e) => `${e.session_id}#${e.seq}`)).toEqual(['aaa#0', 'aaa#1', 'zzz#0', 'zzz#1']);
  });

  describe('filtering by player_id', () => {
    const ev = (player_id: string, seq: number, type: string, extra: Record<string, unknown> = {}): LoggedEvent => ({
      v: 2, seq, t_ms: 0, player_id, session_id: `s-${player_id}`, run_idx: 0, room_idx: 0, enc_idx: 0, type, ...extra,
    });

    it('rebuildProfile replays only the given player, and only that player\'s obs.reset counts', () => {
      const log = [
        ev('me', 0, 'obs.action', { actionType: 'light', weaponId: 'sword_shield' }),
        ev('me', 1, 'obs.action', { actionType: 'heavy', weaponId: 'bow' }),
        ev('other', 0, 'obs.action', { actionType: 'heavy', weaponId: 'bow' }),
        ev('other', 1, 'obs.reset'), // sorts after all of 'me' — must not wipe 'me'
        ev('other', 2, 'obs.action', { actionType: 'charged', weaponId: 'heavy_weapon' }),
        ev('me', 2, 'obs.boundary', { kind: 'room' }),
        ev('other', 3, 'obs.boundary', { kind: 'room' }),
      ];
      const expected = new ProfileAccumulator();
      expected.recordAction('light', 'sword_shield');
      expected.recordAction('heavy', 'bow');
      expected.applyRoomBoundary();
      expectSameProfile(rebuildProfile(log, 'me'), expected);
      expect(rebuildProfile(log, 'me').snapshot('room.exit').counts.action_repertoire).toEqual([2, 2]);

      const other = new ProfileAccumulator();
      other.recordAction('charged', 'heavy_weapon');
      other.applyRoomBoundary();
      expectSameProfile(rebuildProfile(log, 'other'), other);
    });

    it('nextRunIdx counts only the given player\'s runs', () => {
      const log = [ev('me', 0, 'run.start', { run_idx: 2 }), ev('other', 0, 'run.start', { run_idx: 9 })];
      expect(nextRunIdx(log, 'me')).toBe(3);
      expect(nextRunIdx(log, 'other')).toBe(10);
      expect(nextRunIdx(log, 'nobody')).toBe(0);
      expect(nextRunIdx(log)).toBe(10); // no player given: every run counts
    });
  });

  it('malformed obs.* events are skipped and counted instead of corrupting the profile', () => {
    const ev = (seq: number, type: string, extra: Record<string, unknown>): LoggedEvent => ({
      v: 2, seq, t_ms: 0, player_id: 'p', session_id: 's', run_idx: 0, room_idx: 0, enc_idx: 0, type, ...extra,
    });
    const good = [
      ev(0, 'obs.record', { skill: 'distance', num: 1, den: 2 }),
      ev(1, 'obs.outcome', { skill: 'punish', outcome: 'taken' }),
      ev(2, 'obs.action', { actionType: 'light', weaponId: 'sword_shield' }),
      ev(3, 'obs.action', { actionType: 'heavy' }),
      ev(4, 'obs.defense', { label: 'dodge' }),
      ev(20, 'obs.boundary', { kind: 'encounter' }),
      ev(21, 'obs.boundary', { kind: 'room' }),
    ];
    // seq 10–17: replayed before the boundaries, so any bad value that got
    // applied would show up in the folded snapshot
    const bad = [
      ev(10,'obs.record', { skill: 'distance', num: '1', den: 2 }),
      ev(11, 'obs.record', { skill: 'distance', num: 1, den: null }),
      ev(12, 'obs.record', { num: 1, den: 1 }),
      ev(13, 'obs.outcome', { skill: 'punish', outcome: 'won' }),
      ev(14, 'obs.action', { actionType: 'kick' }),
      ev(15, 'obs.action', { actionType: 'light', weaponId: 'laser' }),
      ev(16, 'obs.defense', { label: 'teleport' }),
      ev(17, 'obs.boundary', { kind: 'floor' }),
    ];
    const clean = rebuildProfileWithStats(good);
    const dirty = rebuildProfileWithStats([...good, ...bad]);
    expect(clean.skipped).toBe(0);
    expect(dirty.skipped).toBe(bad.length);
    expectSameProfile(dirty.accumulator, clean.accumulator);
    expect(Number.isFinite(dirty.accumulator.domain('distance', 'trait') ?? 0)).toBe(true);
  });

  it('nextRunIdx continues after the highest run.start, or 0 for an empty log', () => {
    expect(nextRunIdx([])).toBe(0);
    const log = [
      { v: 2, seq: 0, t_ms: 0, player_id: 'p', session_id: 's', run_idx: 3, room_idx: 0, enc_idx: 0, type: 'run.start' },
      { v: 2, seq: 1, t_ms: 0, player_id: 'p', session_id: 's', run_idx: 4, room_idx: 0, enc_idx: 0, type: 'run.start' },
    ] as LoggedEvent[];
    expect(nextRunIdx(log)).toBe(5);
  });
});
