// src/experiments/v0/windowValues.test.ts
import { describe, it, expect } from 'vitest';
import { ProfileAccumulator, type DefensiveLabel } from '../../profile/profileAccumulator';
import type { ProfileOutcome } from '../../profile/types';
import type { ActionType } from '../../combat/actionRegistry';
import { SCHEMA_VERSION, type LoggedEvent } from '../../telemetry/schema';
import { makeBotStack, runBot } from '../../telemetry/testing/scriptedBot';
import { orderEvents } from '../../telemetry/replay';
import { REPORT_SKILLS, runWindowValues, roomWindowValues, type WindowValue } from './windowValues';

/**
 * Builds events in the real log shape (envelope from TelemetryRecorder.log):
 * the indices are whatever the recorder currently holds, as in the game —
 * room.enter updates room_idx, so the room obs.boundary (logged before it)
 * carries the ENDED room's room_idx.
 */
function logBuilder(playerId = 'p', sessionId = 's') {
  const events: LoggedEvent[] = [];
  let seq = 0;
  let run = 0;
  let room = 0;
  let enc = 0;
  const log = (type: string, payload: Record<string, unknown> = {}): void => {
    events.push({
      ...payload,
      v: SCHEMA_VERSION,
      seq: seq++,
      t_ms: seq * 10,
      player_id: playerId,
      session_id: sessionId,
      run_idx: run,
      room_idx: room,
      enc_idx: enc,
      type,
    });
  };
  return {
    events,
    log,
    startRun(idx: number) {
      run = idx;
      room = 0;
      enc = 0;
      log('run.start', { run_idx: idx, seed: 1 });
      log('room.enter', { room_idx: 0 });
    },
    /** Like TelemetryRecorder.withIndices (closeAbandonedRun): log under another run's indices. */
    withIndices(runIdx: number, roomIdx: number, fn: () => void) {
      const saved = [run, room, enc];
      [run, room, enc] = [runIdx, roomIdx, 0];
      fn();
      [run, room, enc] = saved;
    },
    enterRoom(idx: number) {
      room = idx;
      enc = 0;
      log('room.enter', { room_idx: idx });
    },
    action: (actionType: ActionType, weaponId?: string) =>
      log('obs.action', weaponId === undefined ? { actionType } : { actionType, weaponId }),
    outcome: (skill: string, outcome: ProfileOutcome) => log('obs.outcome', { skill, outcome }),
    defense: (label: DefensiveLabel) => log('obs.defense', { label }),
    record: (skill: string, num: number, den: number) => log('obs.record', { skill, num, den }),
    encounterBoundary: () => log('obs.boundary', { kind: 'encounter' }),
    roomBoundary: () => log('obs.boundary', { kind: 'room' }),
  };
}

function pick(values: readonly WindowValue[], skill: string, runIdx = 0, roomIdx: number | null = 0): WindowValue {
  const v = values.find((w) => w.skill === skill && w.runIdx === runIdx && w.roomIdx === roomIdx);
  if (!v) throw new Error(`no window value for ${skill} run ${runIdx} room ${roomIdx}`);
  return v;
}

function hasNaN(x: unknown): boolean {
  if (typeof x === 'number') return Number.isNaN(x);
  if (Array.isArray(x)) return x.some(hasNaN);
  if (x !== null && typeof x === 'object') return Object.values(x).some(hasNaN);
  return false;
}

/** Feeds a ProfileAccumulator directly from obs.* events (independent of replay.ts). */
function feed(acc: ProfileAccumulator, events: readonly LoggedEvent[]): void {
  for (const e of events) {
    if (e.type === 'obs.record') acc.record(e.skill as string, e.num as number, e.den as number);
    else if (e.type === 'obs.outcome') acc.recordOutcome(e.skill as string, e.outcome as ProfileOutcome);
    else if (e.type === 'obs.action') acc.recordAction(e.actionType as ActionType, e.weaponId as string | undefined);
    else if (e.type === 'obs.defense') acc.recordDefense(e.label as DefensiveLabel);
    else if (e.type === 'obs.boundary' && e.kind === 'encounter') acc.applyEncounterBoundary();
    else if (e.type === 'obs.boundary' && e.kind === 'room') acc.applyRoomBoundary();
  }
}

function expectMatches(values: readonly WindowValue[], acc: ProfileAccumulator, runIdx: number, roomIdx: number | null) {
  for (const skill of REPORT_SKILLS) {
    const v = pick(values, skill, runIdx, roomIdx);
    const n = acc.sampleSize(skill, 'trait');
    expect(v.sampleSize, skill).toBe(n);
    expect(v.confidence, skill).toBe(acc.confidence(skill, 'trait'));
    expect(v.domain, skill).toBe(n === 0 ? null : acc.domain(skill, 'trait'));
  }
}

describe('windowValues', () => {
  it('reports the six dimensions in order', () => {
    expect(REPORT_SKILLS).toEqual([
      'weapon_repertoire', 'action_repertoire', 'punish', 'defensive_repertoire', 'distance', 'patience',
    ]);
  });

  it('action repertoire of a room equals the entropy of its counts', () => {
    const b = logBuilder();
    b.startRun(0);
    b.action('light', 'sword_shield');
    b.action('light', 'sword_shield');
    b.action('light', 'sword_shield');
    b.action('heavy');
    b.roomBoundary();
    const v = pick(roomWindowValues(b.events, 'p'), 'action_repertoire');
    expect(v.domain).toBeCloseTo(0.3494, 3);
    // The fold adds pending evidence undecayed (DecayedCount.decay: γ·count + pending),
    // so one room's 4 actions count 4 — 4×0.87 = 3.48 would mean a double fold.
    expect(v.sampleSize).toBe(4);
  });

  it('ratio dimension folds pending evidence exactly once', () => {
    // One fold: (3 + 1) / (4 + 2) = 0.6667 (DecayedRatio.decay adds pending undecayed).
    // A double fold would give (2.61 + 1) / (3.48 + 2) = 0.6588, a triple 0.6505.
    const withBoundary = logBuilder();
    withBoundary.startRun(0);
    for (let i = 0; i < 3; i++) withBoundary.outcome('punish', 'taken');
    withBoundary.outcome('punish', 'missed');
    withBoundary.roomBoundary();
    const a = pick(roomWindowValues(withBoundary.events, 'p'), 'punish');
    expect(a.domain).toBeCloseTo(4 / 6, 10);
    expect(a.sampleSize).toBe(4);
    expect(a.domain).not.toBeCloseTo(0.6588, 4);
    expect(a.domain).not.toBeCloseTo(0.6505, 4);

    const without = logBuilder();
    without.startRun(0);
    for (let i = 0; i < 3; i++) without.outcome('punish', 'taken');
    without.outcome('punish', 'missed');
    const b = pick(roomWindowValues(without.events, 'p'), 'punish');
    expect(b.domain).toBeCloseTo(4 / 6, 10);
    expect(b.domain).toBe(a.domain);

    // run window ends in the same boundary: same value, no double fold
    const r = pick(runWindowValues(withBoundary.events, 'p'), 'punish', 0, null);
    expect(r.domain).toBe(a.domain);
  });

  it('a window without data yields null, not NaN', () => {
    const b = logBuilder();
    b.startRun(0);
    b.defense('dodge');
    b.defense('dodge');
    b.roomBoundary();
    const values = roomWindowValues(b.events, 'p');
    for (const skill of ['weapon_repertoire', 'action_repertoire', 'punish', 'distance', 'patience']) {
      const v = pick(values, skill);
      expect(v.domain, skill).toBeNull();
      expect(v.sampleSize, skill).toBe(0);
    }
    const def = pick(values, 'defensive_repertoire');
    expect(def.domain).toBeNull();
    expect(def.sampleSize).toBeGreaterThan(0);
    expect(hasNaN(values)).toBe(false);
    expect(hasNaN(runWindowValues(b.events, 'p'))).toBe(false);
  });

  it('run windows group by run_idx and room windows by run_idx+room_idx', () => {
    const b = logBuilder();
    b.startRun(0);
    b.action('light', 'sword_shield');
    b.encounterBoundary();
    b.roomBoundary();
    b.enterRoom(1);
    b.action('heavy', 'heavy_weapon');
    b.roomBoundary(); // death: interrupted room 1 of run 0
    b.startRun(1);
    b.outcome('punish', 'taken');
    const runs = runWindowValues(b.events, 'p');
    const rooms = roomWindowValues(b.events, 'p');
    expect(runs).toHaveLength(2 * 6);
    expect(rooms).toHaveLength(3 * 6);
    expect(new Set(runs.map((v) => v.runIdx))).toEqual(new Set([0, 1]));
    expect(runs.every((v) => v.roomIdx === null)).toBe(true);
    expect(new Set(rooms.map((v) => `${v.runIdx}/${v.roomIdx}`))).toEqual(new Set(['0/0', '0/1', '1/0']));
    // ordered by window, skills in REPORT_SKILLS order
    expect(runs.slice(0, 6).map((v) => v.skill)).toEqual([...REPORT_SKILLS]);
  });

  it('another player is ignored', () => {
    const mine = logBuilder('p', 's1');
    mine.startRun(0);
    mine.outcome('punish', 'taken');
    mine.roomBoundary();
    const other = logBuilder('q', 's2');
    other.startRun(0);
    for (let i = 0; i < 5; i++) other.outcome('punish', 'missed');
    other.roomBoundary();
    other.startRun(7);
    other.outcome('punish', 'missed');
    const all = [...mine.events, ...other.events];
    expect(runWindowValues(all, 'p')).toEqual(runWindowValues(mine.events, 'p'));
    expect(roomWindowValues(all, 'p')).toEqual(roomWindowValues(mine.events, 'p'));
    expect(runWindowValues(all, 'p')).toHaveLength(6);
  });

  it('matches a hand-fed accumulator', () => {
    const b = logBuilder();
    b.startRun(3);
    b.action('light', 'sword_shield');
    b.action('heavy', 'heavy_weapon');
    b.action('light', 'heavy_weapon');
    b.defense('dodge');
    b.defense('block');
    b.outcome('punish', 'taken');
    b.outcome('punish', 'expired');
    b.record('distance', 0.4, 1);
    b.record('patience', 2, 3);
    b.encounterBoundary();
    b.roomBoundary();
    b.enterRoom(1);
    b.action('heavy', 'sword_shield');
    b.defense('parry');
    b.outcome('punish', 'missed');
    b.record('distance', 0.9, 1);
    b.encounterBoundary();
    // run still open: no room boundary after room 1

    const acc = new ProfileAccumulator();
    acc.recordAction('light', 'sword_shield');
    acc.recordAction('heavy', 'heavy_weapon');
    acc.recordAction('light', 'heavy_weapon');
    acc.recordDefense('dodge');
    acc.recordDefense('block');
    acc.recordOutcome('punish', 'taken');
    acc.recordOutcome('punish', 'expired');
    acc.record('distance', 0.4, 1);
    acc.record('patience', 2, 3);
    acc.applyEncounterBoundary();
    acc.applyRoomBoundary();
    acc.recordAction('heavy', 'sword_shield');
    acc.recordDefense('parry');
    acc.recordOutcome('punish', 'missed');
    acc.record('distance', 0.9, 1);
    acc.applyEncounterBoundary();
    acc.applyRoomBoundary(); // the final fold

    expectMatches(runWindowValues(b.events, 'p'), acc, 3, null);
    for (const skill of REPORT_SKILLS) expect(pick(runWindowValues(b.events, 'p'), skill, 3, null).domain).not.toBeNull();
  });

  it('orders sessions by session.start time, not by session id, across an abandoned run', () => {
    // Earlier session 'zz' leaves run 0 open in room 1; later session 'aa' closes it.
    // Sorting by id would put 'aa' first; wall_clock_iso says 'zz' came first.
    const zz = logBuilder('p', 'zz');
    zz.log('session.start', { wall_clock_iso: '2026-10-01T00:00:00.000Z' });
    zz.startRun(0);
    for (let i = 0; i < 3; i++) zz.outcome('punish', 'taken');
    zz.encounterBoundary();
    zz.roomBoundary();
    zz.enterRoom(1);
    zz.outcome('punish', 'missed');
    // session ends abruptly: run 0 / room 1 left open
    const aa = logBuilder('p', 'aa');
    aa.log('session.start', { wall_clock_iso: '2026-10-02T00:00:00.000Z' });
    aa.withIndices(0, 1, () => {
      aa.outcome('punish', 'taken'); // evidence under the abandoned run's indices (makes order observable)
      aa.encounterBoundary();
      aa.roomBoundary();
    });
    aa.startRun(1);
    aa.outcome('punish', 'missed');

    const log = [...aa.events, ...zz.events];
    const chronological = [...zz.events, ...aa.events].filter((e) => e.type.startsWith('obs.'));

    const run0 = new ProfileAccumulator();
    feed(run0, chronological.filter((e) => e.run_idx === 0));
    expectMatches(runWindowValues(log, 'p'), run0, 0, null);

    const room01 = new ProfileAccumulator();
    feed(room01, chronological.filter((e) => e.run_idx === 0 && e.room_idx === 1));
    expectMatches(roomWindowValues(log, 'p'), room01, 0, 1);

    const run1 = new ProfileAccumulator();
    feed(run1, chronological.filter((e) => e.run_idx === 1));
    run1.applyRoomBoundary(); // open run: the one final fold
    expectMatches(runWindowValues(log, 'p'), run1, 1, null);
  });

  it('derives the windows of a real recorded log', () => {
    const { stack, runEnds } = makeBotStack();
    stack.recorder.log('session.start', { wall_clock_iso: '2026-10-19T00:00:00.000Z', game_version: 'test', schema_v: 2 });
    stack.director.start();
    runBot(stack, 30000);
    stack.recording.flushPending();
    const log: LoggedEvent[] = JSON.parse(JSON.stringify(stack.recorder.drain()));
    expect(runEnds.count).toBeGreaterThanOrEqual(2);

    const mine = log.filter((e) => e.player_id === 'p');
    const runIdxs = new Set(mine.map((e) => e.run_idx));
    const roomKeys = new Set(mine.map((e) => `${e.run_idx}/${e.room_idx}`));
    const obsRunIdxs = new Set(mine.filter((e) => e.type.startsWith('obs.')).map((e) => e.run_idx));
    const obsRoomKeys = new Set(mine.filter((e) => e.type.startsWith('obs.')).map((e) => `${e.run_idx}/${e.room_idx}`));
    // every run/room of the log carries obs events, so windows over obs.* cover them all
    expect(obsRunIdxs).toEqual(runIdxs);
    expect(obsRoomKeys).toEqual(roomKeys);

    const runs = runWindowValues(log, 'p');
    const rooms = roomWindowValues(log, 'p');
    expect(runs).toHaveLength(runIdxs.size * REPORT_SKILLS.length);
    expect(rooms).toHaveLength(roomKeys.size * REPORT_SKILLS.length);
    expect(roomKeys.size).toBeGreaterThan(runIdxs.size);
    for (const v of [...runs, ...rooms]) {
      expect(v.domain === null || Number.isFinite(v.domain)).toBe(true);
      expect(Number.isFinite(v.confidence)).toBe(true);
      expect(Number.isFinite(v.sampleSize)).toBe(true);
    }

    // Boundary indices: the room obs.boundary is logged before room.enter /
    // run.start, so it carries the ENDED room's indices — every closed room
    // window ends in its own room boundary.
    const lastOf = <T,>(xs: readonly T[]): T => xs[xs.length - 1];
    const openRoom = lastOf(mine.filter((e) => e.type === 'room.enter'));
    for (const key of roomKeys) {
      if (key === `${openRoom.run_idx}/${openRoom.room_idx}`) continue;
      const obs = mine.filter((e) => `${e.run_idx}/${e.room_idx}` === key && e.type.startsWith('obs.'));
      const last = lastOf(obs);
      expect(`${key}:${last.type}:${String(last.kind)}`).toBe(`${key}:obs.boundary:room`);
    }

    // EVERY window equals a fresh accumulator fed that window's obs in true global
    // order, plus one fold only if the window does not end in a room boundary.
    const globalObs = orderEvents(mine).filter((e) => e.type.startsWith('obs.'));
    const expectWindow = (values: readonly WindowValue[], runIdx: number, roomIdx: number | null) => {
      const windowObs = globalObs.filter((e) => e.run_idx === runIdx && (roomIdx === null || e.room_idx === roomIdx));
      const acc = new ProfileAccumulator();
      feed(acc, windowObs);
      const end = lastOf(windowObs);
      if (!(end.type === 'obs.boundary' && end.kind === 'room')) acc.applyRoomBoundary();
      expectMatches(values, acc, runIdx, roomIdx);
    };
    for (const runIdx of runIdxs) expectWindow(runs, runIdx, null);
    for (const key of roomKeys) {
      const [runIdx, roomIdx] = key.split('/').map(Number);
      expectWindow(rooms, runIdx, roomIdx);
    }
  });
});
