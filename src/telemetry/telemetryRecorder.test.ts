// src/telemetry/telemetryRecorder.test.ts
import { describe, it, expect } from 'vitest';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import { createTelemetryStack } from './stack';
import type { LoggedEvent } from './schema';
import { PLAYER_START } from '../game/runDirector';

function makeStack(onRunEnd?: () => void) {
  let seed = 1;
  return createTelemetryStack({
    accumulator: new ProfileAccumulator(),
    playerId: 'player-1',
    sessionId: 'session-1',
    firstRunIdx: 0,
    nextSeed: () => seed++,
    entitySize: 20,
    onRunEnd,
  });
}

function ofType(events: LoggedEvent[], type: string) {
  return events.filter((e) => e.type === type);
}

describe('TelemetryRecorder', () => {
  it('stamps every event with the full envelope and a monotonic seq', () => {
    const stack = makeStack();
    stack.director.start();
    for (let i = 0; i < 120; i++) stack.step(1000 / 60);
    const events = stack.recorder.drain();

    expect(events.slice(0, 3).map((e) => e.type)).toEqual(['run.start', 'room.enter', 'encounter.start']);
    events.forEach((e, i) => {
      expect(e.v).toBe(2);
      expect(e.seq).toBe(i);
      expect(e.player_id).toBe('player-1');
      expect(e.session_id).toBe('session-1');
      expect(e.run_idx).toBe(0);
      expect(typeof e.t_ms).toBe('number');
    });
    for (let i = 1; i < events.length; i++) expect(events[i].t_ms).toBeGreaterThanOrEqual(events[i - 1].t_ms);
    expect(stack.recorder.drain()).toEqual([]);
  });

  it('samples positions every 250ms of simulation time', () => {
    const stack = makeStack();
    stack.director.start();
    stack.recorder.drain();
    for (let i = 0; i < 100; i++) stack.step(10); // 1000ms
    const samples = ofType(stack.recorder.drain(), 'pos.sample');
    expect(samples.map((s) => s.t_ms)).toEqual([250, 500, 750, 1000]);
    expect(samples[0]).toMatchObject({ p: [expect.any(Number), expect.any(Number)], p_state: expect.any(String) });
  });

  it('attaches ctx to combat events, with time since the previous action', () => {
    const stack = makeStack();
    stack.director.start();
    stack.encounter.player.tryAction('sword_shield.light');
    for (let i = 0; i < 40; i++) stack.step(10); // 400ms, light attack long finished
    stack.encounter.player.tryAction('sword_shield.light');
    const actions = ofType(stack.recorder.drain(), 'player.action');

    expect(actions).toHaveLength(2);
    const first = actions[0].ctx as Record<string, unknown>;
    const second = actions[1].ctx as Record<string, unknown>;
    expect(first.ms_since_last_action).toBeNull();
    expect(second.ms_since_last_action).toBe(400);
    expect(first).toMatchObject({
      p_pos: [PLAYER_START.x, PLAYER_START.y],
      p_hp: 100,
      e_hp: 60,
      weapon: 'sword_shield',
      p_state: 'acting',
    });
    expect(actions[0]).toMatchObject({ actionId: 'sword_shield.light', actionType: 'light', weaponId: 'sword_shield' });
  });

  it('keeps the envelope type and renames an opportunity payload type to opp_type', () => {
    const stack = makeStack();
    stack.director.start();
    stack.encounter.respawnEnemy({ x: PLAYER_START.x + 30, y: PLAYER_START.y }, 'source_interrupted');
    stack.step(16); // Assaltante attacks -> opp.open
    const opens = ofType(stack.recorder.drain(), 'opp.open');
    expect(opens).toHaveLength(1);
    expect(opens[0].opp_type).toBe('dodge');
    expect(opens[0].type).toBe('opp.open');
  });

  it('logs obs.* from the recording profile and calls onRunEnd after run.end', () => {
    let runEnds = 0;
    const stack = makeStack(() => { runEnds += 1; });
    stack.director.start();
    stack.encounter.player.tryAction('sword_shield.light');
    stack.encounter.player.takeDamage(999);
    stack.step(16);
    const events = stack.recorder.drain();
    expect(ofType(events, 'obs.action')).toHaveLength(1);
    expect(ofType(events, 'obs.boundary').map((e) => e.kind)).toEqual(['encounter', 'room']);
    expect(ofType(events, 'run.end')).toHaveLength(1);
    expect(runEnds).toBe(1);
    const runStarts = ofType(events, 'run.start');
    expect(runStarts[runStarts.length - 1].run_idx).toBe(1);
  });

  it('flushPending before drain puts the pending aggregated record in the buffer', () => {
    const stack = makeStack();
    stack.director.start();
    stack.step(16); // one distance record, not yet flushed (< 250ms)
    stack.recorder.drain();
    stack.recording.flushPending();
    const records = ofType(stack.recorder.drain(), 'obs.record');
    expect(records.map((r) => r.skill)).toContain('distance');
  });
});
