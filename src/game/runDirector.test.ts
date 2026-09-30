// src/game/runDirector.test.ts
import { describe, it, expect } from 'vitest';
import { Encounter } from '../combat/encounter';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import type { ProfileSink } from '../profile/profileSink';
import { PLAYER_MAX_HP, ASSALTANTE_MAX_HP, MIN_SPAWN_DISTANCE } from '../combat/movementDefs';
import { RunDirector, PLAYER_START, pickSpawn } from './runDirector';
import { createPrng } from '../core/prng';
import type { GameEvents } from '../core/events';

const STEP = 16;
const LIFECYCLE = [
  'run.start', 'run.end', 'room.enter', 'encounter.start', 'encounter.end',
  'profile.snapshot', 'player.death', 'enemy.death',
] as const;

function makeDirector(firstSeed = 1, firstRunIdx?: number) {
  const acc = new ProfileAccumulator();
  const calls: string[] = [];
  const sink: ProfileSink = {
    record: (s, n, d) => acc.record(s, n, d),
    recordOutcome: (s, o) => acc.recordOutcome(s, o),
    recordAction: (t, w) => acc.recordAction(t, w),
    recordDefense: (l) => acc.recordDefense(l),
    applyEncounterBoundary: () => { calls.push('enc'); acc.applyEncounterBoundary(); },
    applyRoomBoundary: () => { calls.push('room'); acc.applyRoomBoundary(); },
    resetSession: () => { calls.push('reset'); acc.resetSession(); },
  };
  const encounter = new Encounter(
    { x: PLAYER_START.x, y: PLAYER_START.y, width: 20, height: 20 },
    { x: 0, y: 0, width: 20, height: 20 },
    sink,
  );
  let seed = firstSeed;
  const director = new RunDirector({ encounter, snapshots: acc, nextSeed: () => seed++, firstRunIdx });
  const events: Array<[string, unknown]> = [];
  for (const type of LIFECYCLE) {
    encounter.bus.on(type, (e: GameEvents[typeof type]) => events.push([type, e]));
  }
  return { director, encounter, acc, calls, events };
}

function killEnemy(d: ReturnType<typeof makeDirector>) {
  d.encounter.assaltante.takeDamage(999);
  d.director.step(STEP);
}

function types(events: Array<[string, unknown]>) {
  return events.map(([t]) => t);
}

describe('RunDirector', () => {
  it('start() opens run 0, room 0, encounter 0 with the first seed', () => {
    const d = makeDirector(42);
    d.director.start();
    expect(d.events).toEqual([
      ['run.start', { run_idx: 0, seed: 42 }],
      ['room.enter', { room_idx: 0 }],
      ['encounter.start', { enc_idx: 0 }],
    ]);
    expect(d.encounter.player.position).toEqual(PLAYER_START);
  });

  it('firstRunIdx continues numbering from a previous session', () => {
    const d = makeDirector(1, 5);
    d.director.start();
    expect(d.events[0]).toEqual(['run.start', { run_idx: 5, seed: 1 }]);
    expect(d.director.runIdx).toBe(5);
  });

  it('killing the Assaltante ends the encounter: one encounter boundary, fresh enemy far from the player', () => {
    const d = makeDirector();
    d.director.start();
    d.events.length = 0;
    killEnemy(d);
    expect(types(d.events)).toEqual(['enemy.death', 'encounter.end', 'encounter.start']);
    expect(d.events[2]).toEqual(['encounter.start', { enc_idx: 1 }]);
    expect(d.calls).toEqual(['enc']);
    expect(d.encounter.assaltante.hp).toBe(ASSALTANTE_MAX_HP);
    const p = d.encounter.player.position;
    const e = d.encounter.assaltante.position;
    expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
  });

  it('three kills end the room: room boundary after the third encounter boundary, one non-partial snapshot', () => {
    const d = makeDirector();
    d.director.start();
    d.events.length = 0;
    killEnemy(d);
    killEnemy(d);
    killEnemy(d);
    expect(d.calls).toEqual(['enc', 'enc', 'enc', 'room']);
    const snaps = d.events.filter(([t]) => t === 'profile.snapshot');
    expect(snaps).toHaveLength(1);
    expect((snaps[0][1] as { partial: boolean }).partial).toBe(false);
    expect((snaps[0][1] as { snapshot: { at: string } }).snapshot.at).toBe('room.exit');
    expect(d.events).toContainEqual(['room.enter', { room_idx: 1 }]);
    expect(d.director.roomIdx).toBe(1);
    expect(d.director.encIdx).toBe(0);
  });

  it('player death ends the run: partial room counts, run.end reports totals, next run starts without resetting the profile', () => {
    const d = makeDirector(1);
    d.director.start();
    killEnemy(d); // 1 encounter cleared, 16ms elapsed
    d.acc.recordAction('light', 'sword_shield');
    d.events.length = 0;
    d.calls.length = 0;

    d.encounter.player.takeDamage(999);
    d.director.step(STEP);

    expect(d.calls).toEqual(['enc', 'room']);
    expect(types(d.events)).toEqual([
      'player.death', 'encounter.end', 'profile.snapshot', 'run.end',
      'run.start', 'room.enter', 'encounter.start',
    ]);
    expect((d.events[2][1] as { partial: boolean }).partial).toBe(true);
    expect(d.events[3]).toEqual(['run.end', {
      run_idx: 0, cause: 'death', duration_ms: 2 * STEP, rooms_cleared: 0, encounters_cleared: 1,
    }]);
    expect(d.events[4]).toEqual(['run.start', { run_idx: 1, seed: 2 }]);
    expect(d.encounter.player.hp).toBe(PLAYER_MAX_HP);
    expect(d.encounter.player.position).toEqual(PLAYER_START);
    expect(d.calls).not.toContain('reset');
    expect(d.acc.snapshot('room.exit').counts.action_repertoire).toEqual([1, 1]);
  });

  it('player death closes the enemy window as invalid/player_dead inside the ending run', () => {
    const d = makeDirector();
    d.director.start();
    const closes: Array<{ outcome: string; reason?: string }> = [];
    d.encounter.bus.on('opp.close', (e) => closes.push(e));
    // put the Assaltante next to the player so it attacks and opens a dodge window
    d.encounter.respawnEnemy({ x: PLAYER_START.x + 30, y: PLAYER_START.y }, 'source_interrupted');
    d.director.step(STEP);
    expect(d.encounter.assaltante.state).toBe('attacking');

    d.encounter.player.takeDamage(999);
    d.director.step(STEP);

    expect(closes.map((c) => [c.outcome, c.reason])).toContainEqual(['invalid', 'player_dead']);
  });

  it('simultaneous deaths resolve as a single run end (player death wins)', () => {
    const d = makeDirector();
    d.director.start();
    d.events.length = 0;
    d.encounter.player.takeDamage(999);
    d.encounter.assaltante.takeDamage(999);
    d.director.step(STEP);
    expect(types(d.events).filter((t) => t === 'run.end')).toHaveLength(1);
    expect(types(d.events)).not.toContain('enemy.death');
    expect(d.calls).toEqual(['enc', 'room']);
  });

  it('spawn selection is deterministic for a given seed and respects the minimum distance', () => {
    const a = pickSpawn(createPrng(9), PLAYER_START);
    const b = pickSpawn(createPrng(9), PLAYER_START);
    expect(a).toEqual(b);
    expect(Math.hypot(a.x - PLAYER_START.x, a.y - PLAYER_START.y)).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
  });

  it('step() before start() throws', () => {
    const d = makeDirector();
    expect(() => d.director.step(STEP)).toThrow('RunDirector not started');
  });
});
