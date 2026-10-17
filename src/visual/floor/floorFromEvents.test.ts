import { describe, expect, it } from 'vitest';
import type { LoggedEvent } from '../../telemetry/schema';
import { FLOOR_TILESET, composeFloorWithSkirt } from './composeFloor';
import { DEFAULT_FLOOR_SEED, FloorTracker, floorFromEvents } from './floorFromEvents';
import { floorSeed } from './floorSeed';
import { makeBotStack, runBot } from '../../telemetry/testing/scriptedBot';

let seq = 0;
function ev(type: string, env: { run_idx?: number; room_idx?: number }, payload: Record<string, unknown> = {}): LoggedEvent {
  return {
    v: 2,
    seq: seq++,
    t_ms: 0,
    player_id: 'p',
    session_id: 's',
    run_idx: env.run_idx ?? 0,
    room_idx: env.room_idx ?? 0,
    enc_idx: 0,
    type,
    ...payload, // payload last so malformed fields can be forced in tests
  } as LoggedEvent;
}
const runStart = (run_idx: number, seed: unknown) => ev('run.start', { run_idx }, { seed });
const roomEnter = (room_idx: unknown, run_idx = 0) =>
  ev('room.enter', { run_idx }, { room_idx }) as LoggedEvent;
const expected = (seed: number, room: number) =>
  composeFloorWithSkirt(floorSeed(seed, room), 25, 19, 10, FLOOR_TILESET);
const tracker = () => new FloorTracker(25, 19, 10, FLOOR_TILESET);

describe('floorFromEvents', () => {
  it('equals composeFloorWithSkirt for the logged seed and room', () => {
    const events = [runStart(3, 777), ev('room.enter', { run_idx: 3, room_idx: 2 }, { room_idx: 2 })];
    expect(floorFromEvents(events, 3, 2, 25, 19, 10, FLOOR_TILESET)).toEqual(expected(777, 2));
  });

  it('returns null when run.start is missing, run_idx differs or seed is not a finite number', () => {
    expect(floorFromEvents([], 3, 2, 25, 19, 10, FLOOR_TILESET)).toBeNull();
    expect(floorFromEvents([runStart(3, 777)], 4, 2, 25, 19, 10, FLOOR_TILESET)).toBeNull();
    expect(floorFromEvents([runStart(3, 'abc')], 3, 2, 25, 19, 10, FLOOR_TILESET)).toBeNull();
    expect(floorFromEvents([runStart(3, NaN)], 3, 2, 25, 19, 10, FLOOR_TILESET)).toBeNull();
  });
});

describe('FloorTracker', () => {
  it('stores the seed on run.start and builds the floor on room.enter', () => {
    const t = tracker();
    expect(t.apply(runStart(0, 5))).toBeNull();
    expect(t.apply(roomEnter(0))).toEqual(expected(5, 0));
    const second = t.apply(roomEnter(1));
    expect(second).toEqual(expected(5, 1));
    expect(second).not.toEqual(expected(5, 0));
    expect(t.apply(ev('pos.sample', {}))).toBeNull();
  });

  it('uses the default seed when room.enter arrives before any run.start', () => {
    const t = tracker();
    expect(() => t.apply(roomEnter(4))).not.toThrow();
    expect(tracker().apply(roomEnter(4))).toEqual(expected(DEFAULT_FLOOR_SEED, 4));
  });

  it('ignores a malformed run.start seed and keeps the previous one', () => {
    const t = tracker();
    t.apply(runStart(0, 5));
    for (const bad of ['abc', NaN, Infinity, undefined, null]) t.apply(runStart(1, bad));
    expect(t.apply(roomEnter(2))).toEqual(expected(5, 2));
  });

  it('a new run.start replaces the seed', () => {
    const t = tracker();
    t.apply(runStart(0, 5));
    t.apply(runStart(1, 9));
    expect(t.apply(roomEnter(0))).toEqual(expected(9, 0));
  });

  it('room.enter without a numeric room_idx does not throw and yields null', () => {
    const t = tracker();
    expect(t.apply(roomEnter('x'))).toBeNull();
    expect(t.apply(roomEnter(undefined))).toBeNull();
    expect(t.apply(roomEnter(NaN))).toBeNull();
    expect(() => t.apply({} as LoggedEvent)).not.toThrow();
    expect(() => t.apply(null as unknown as LoggedEvent)).not.toThrow();
  });

  it('initial() equals the default seed, room 0', () => {
    expect(tracker().initial()).toEqual(expected(DEFAULT_FLOOR_SEED, 0));
  });
});

describe('FloorTracker extra cases', () => {
  it('initial() ignores the seed stored by run.start', () => {
    const t = tracker();
    t.apply(runStart(0, 5));
    expect(t.initial()).toEqual(expected(DEFAULT_FLOOR_SEED, 0));
  });

  it.each([0, -17, 2 ** 33 + 5])('seed %s is valid and tracker matches floorFromEvents', (seed) => {
    const t = tracker();
    t.apply(runStart(2, seed));
    for (const r of [0, 3]) {
      const fromTracker = t.apply(roomEnter(r, 2));
      expect(fromTracker).toEqual(expected(seed, r));
      expect(fromTracker).toEqual(
        floorFromEvents([runStart(2, seed)], 2, r, 25, 19, 10, FLOOR_TILESET),
      );
    }
  });
});

describe('FloorTracker against a real recorded log', () => {
  it('matches floorFromEvents for every room.enter of a bot session', () => {
    const { stack } = makeBotStack({ seedStart: 123 });
    stack.director.start();
    runBot(stack, 30000);
    const log = JSON.parse(JSON.stringify(stack.recorder.drain())) as LoggedEvent[];

    const starts = log.filter((e) => e.type === 'run.start');
    expect(starts.length).toBeGreaterThanOrEqual(1);
    expect(starts[0].seed).toBe(123);
    expect(Number.isFinite(starts[0].seed)).toBe(true);

    const t = new FloorTracker(25, 19, 10, FLOOR_TILESET);
    let matches = 0;
    let deepest = 0;
    for (const e of log) {
      const layout = t.apply(e);
      if (layout === null) continue;
      expect(e.type).toBe('room.enter');
      expect(layout).toEqual(
        floorFromEvents(log, e.run_idx, e.room_idx, 25, 19, 10, FLOOR_TILESET),
      );
      matches += 1;
      deepest = Math.max(deepest, e.room_idx);
    }
    expect(matches).toBeGreaterThanOrEqual(2);
    expect(deepest).toBeGreaterThan(0);
  });
});
