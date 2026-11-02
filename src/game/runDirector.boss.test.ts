// src/game/runDirector.boss.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Encounter } from '../combat/encounter';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import type { ProfileSink } from '../profile/profileSink';
import { ASSALTANTE_MAX_HP } from '../combat/movementDefs';
import { DODGE } from '../combat/actionDefs';
import type { PlayerController } from '../combat/playerController';
import { RunDirector, PLAYER_START } from './runDirector';
import type { GameEvents } from '../core/events';
import { BOSS_CONFIG, type BossConfig } from '../boss/bossConfig';
import type { BossAdaptRecord, BossPlan, HabitLevels } from '../boss/types';
import { TelemetryRecorder } from '../telemetry/telemetryRecorder';

const STEP = 16;
const SEED = 4242;
const WATCHED = [
  'run.start', 'run.end', 'room.enter', 'encounter.start', 'encounter.end',
  'profile.snapshot', 'player.death', 'enemy.death', 'boss.adapt', 'boss.barrage', 'enemy.attack_start',
] as const;

const ZERO: HabitLevels = { far: 0, passive_defense: 0, dodge_abuse: 0, reflex_dash: 0 };

function record(habit: BossAdaptRecord['habit'], level: number, active = true): BossAdaptRecord {
  return { habit, level, runs_qualifying: 3, runs_window: 5, confidence: 0.8, active };
}

function plan(levels: Partial<HabitLevels>, records: BossAdaptRecord[] = []): BossPlan {
  return { gateOpen: records.length > 0, levels: { ...ZERO, ...levels }, records };
}

interface Setup {
  plan?: BossPlan;
  bossAfterEncounters?: number | null;
  bossConfig?: BossConfig;
  noBoss?: boolean;
}

function makeDirector(setup: Setup = {}) {
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
  const planBoss = vi.fn(() => setup.plan ?? plan({}));
  const director = new RunDirector({
    encounter,
    snapshots: acc,
    nextSeed: () => SEED,
    ...(setup.noBoss ? {} : { planBoss }),
    ...(setup.bossAfterEncounters === null ? {} : { bossAfterEncounters: setup.bossAfterEncounters ?? 1 }),
    ...(setup.bossConfig ? { bossConfig: setup.bossConfig } : {}),
  });
  const events: Array<[string, unknown]> = [];
  for (const type of WATCHED) {
    encounter.bus.on(type, (e: GameEvents[typeof type]) => events.push([type, e]));
  }
  return { director, encounter, acc, calls, events, planBoss };
}

type D = ReturnType<typeof makeDirector>;

function killEnemy(d: D) {
  d.encounter.assaltante.takeDamage(9999);
  d.director.step(STEP);
}

function types(events: Array<[string, unknown]>) {
  return events.map(([t]) => t).filter((t) => t !== 'enemy.attack_start');
}

function payloads<T>(events: Array<[string, unknown]>, type: string): T[] {
  return events.filter(([t]) => t === type).map(([, p]) => p as T);
}

/** Dashes, ends the dash, then waits `waitMs`: true if a new press dashes exactly at `waitMs` and not 1 ms before. */
function cooldownIs(player: PlayerController, waitMs: number): boolean {
  player.tryDodge();
  player.step(DODGE.durationMs);
  player.step(waitMs - 1);
  player.tryDodge();
  const blocked = player.state === 'idle';
  player.step(1);
  return blocked && player.state === 'dodging';
}

interface SnapshotEvent {
  partial: boolean;
  snapshot: { at: string; levels?: Record<string, number>; applied?: { dash_cooldown_ms: number; advance_mult: number } };
}

describe('RunDirector — boss room', () => {
  it('without planBoss there is no boss room', () => {
    const d = makeDirector({ noBoss: true });
    d.director.start();
    for (let i = 0; i < 5; i++) killEnemy(d);
    expect(d.director.inBossRoom).toBe(false);
    expect(d.encounter.boss).toBeNull();
    expect(d.encounter.assaltante.maxHp).toBe(ASSALTANTE_MAX_HP);
    expect(payloads<{ room_idx: number }>(d.events, 'room.enter').map((e) => e.room_idx)).toEqual([0, 1, 2]);
  });

  it('enters the boss room right after the 1st encounter: one room boundary, no extra empty room', () => {
    const d = makeDirector({ plan: plan({ dodge_abuse: 1 }, [record('dodge_abuse', 1)]) });
    d.director.start();
    d.events.length = 0;
    killEnemy(d);
    expect(types(d.events)).toEqual([
      'enemy.death', 'encounter.end', 'profile.snapshot', 'room.enter',
      'profile.snapshot', 'boss.adapt', 'encounter.start',
    ]);
    expect(d.calls).toEqual(['enc', 'room']);
    const snaps = payloads<SnapshotEvent>(d.events, 'profile.snapshot');
    expect(snaps[0]).toMatchObject({ partial: false, snapshot: { at: 'room.exit' } });
    expect(snaps[0].snapshot.levels).toBeUndefined();
    expect(snaps[1].partial).toBe(false);
    expect(snaps[1].snapshot.at).toBe('boss.entry');
    expect(snaps[1].snapshot.levels).toEqual({ ...ZERO, dodge_abuse: 1 });
    expect(snaps[1].snapshot.applied?.dash_cooldown_ms).toBe(4000);
    expect(snaps[1].snapshot.applied?.advance_mult).toBeCloseTo(1.4, 12);
    expect(payloads(d.events, 'room.enter')).toEqual([{ room_idx: 1 }]);
    expect(payloads(d.events, 'encounter.start')).toEqual([{ enc_idx: 0 }]);
    expect(d.director.inBossRoom).toBe(true);
    expect(d.director.roomIdx).toBe(1);
    expect(d.director.encIdx).toBe(0);
    expect(d.encounter.boss).not.toBeNull();
  });

  it('boss.adapt is emitted only for active records, with the applied totals', () => {
    const d = makeDirector({
      plan: plan({ dodge_abuse: 1, far: 0.5 }, [record('dodge_abuse', 1), record('far', 0.5, false)]),
    });
    d.director.start();
    killEnemy(d);
    const adapts = payloads<Record<string, unknown>>(d.events, 'boss.adapt');
    expect(adapts).toHaveLength(1);
    expect(adapts[0]).toMatchObject({ ...record('dodge_abuse', 1), dash_cooldown_ms: 4000 });
    expect(adapts[0].advance_mult as number).toBeCloseTo(1.4, 12);
  });

  it('boss.adapt is logged after the boss is configured: its ctx shows the boss (400 hp), log order unchanged', () => {
    const d = makeDirector({ plan: plan({ dodge_abuse: 1 }, [record('dodge_abuse', 1)]) });
    const recorder = new TelemetryRecorder({ playerId: 'p', sessionId: 's' });
    recorder.attach(d.encounter);
    d.director.start();
    killEnemy(d);
    const log = recorder.drain();
    const adapt = log.find((e) => e.type === 'boss.adapt');
    expect(BOSS_CONFIG.bossMaxHp).toBe(400);
    expect(adapt?.ctx).toMatchObject({ e_hp: 400 });
    const tail = log.map((e) => e.type).filter((t) => ['room.enter', 'profile.snapshot', 'boss.adapt', 'encounter.start'].includes(t));
    expect(tail.slice(-4)).toEqual(['room.enter', 'profile.snapshot', 'boss.adapt', 'encounter.start']);
    const entry = log.filter((e) => e.type === 'profile.snapshot').pop();
    expect(entry?.at).toBe('boss.entry');
  });

  it('the boss has 400 hp, dodge_abuse 1 gives a 4000 ms dash cooldown and advance_mult 1.4', () => {
    const d = makeDirector({ plan: plan({ dodge_abuse: 1 }, [record('dodge_abuse', 1)]) });
    const configure = vi.spyOn(d.encounter.assaltante, 'configureBoss');
    d.director.start();
    killEnemy(d);
    expect(configure).toHaveBeenCalledTimes(1);
    expect(configure.mock.calls[0][0].maxHp).toBe(400);
    expect(configure.mock.calls[0][0].advanceMult).toBeCloseTo(1.4, 12);
    expect(d.encounter.assaltante.maxHp).toBe(400);
    expect(d.encounter.assaltante.hp).toBe(400);
    expect(cooldownIs(d.encounter.player, 4000)).toBe(true);
  });

  it('advance_mult takes the larger of far and the dodge level', () => {
    const d = makeDirector({ plan: plan({ far: 1, reflex_dash: 0.5 }, [record('far', 1), record('reflex_dash', 0.5)]) });
    d.director.start();
    killEnemy(d);
    const snap = payloads<SnapshotEvent>(d.events, 'profile.snapshot')[1].snapshot;
    expect(snap.applied?.advance_mult).toBeCloseTo(1.4, 12);
    expect(snap.applied?.dash_cooldown_ms).toBe(DODGE.cooldownMs + (4000 - DODGE.cooldownMs) * 0.5);
  });

  it('with every level 0 the boss.entry snapshot is still emitted (applied 2500/1) and there is no boss.adapt', () => {
    const d = makeDirector({ plan: plan({}) });
    d.director.start();
    killEnemy(d);
    const snaps = payloads<SnapshotEvent>(d.events, 'profile.snapshot');
    expect(snaps.map((s) => s.snapshot.at)).toEqual(['room.exit', 'boss.entry']);
    expect(snaps[1].snapshot.levels).toEqual(ZERO);
    expect(snaps[1].snapshot.applied).toEqual({ dash_cooldown_ms: 2500, advance_mult: 1 });
    expect(payloads(d.events, 'boss.adapt')).toEqual([]);
    expect(d.encounter.assaltante.maxHp).toBe(400);
    expect(cooldownIs(d.encounter.player, DODGE.cooldownMs)).toBe(true);
  });

  it('killing the boss ends the run as a victory and the next run starts clean', () => {
    const d = makeDirector({ plan: plan({ dodge_abuse: 1 }, [record('dodge_abuse', 1)]) });
    d.director.start();
    killEnemy(d);
    d.events.length = 0;
    d.calls.length = 0;
    const playerHp = d.encounter.player.hp;
    killEnemy(d);
    expect(types(d.events)).toEqual([
      'enemy.death', 'encounter.end', 'profile.snapshot', 'run.end', 'run.start', 'room.enter', 'encounter.start',
    ]);
    expect(d.calls).toEqual(['enc', 'room']);
    expect(d.events[1]).toEqual(['encounter.end', { enc_idx: 0 }]);
    expect(payloads<SnapshotEvent>(d.events, 'profile.snapshot')[0]).toMatchObject({
      partial: false, snapshot: { at: 'room.exit' },
    });
    expect(payloads(d.events, 'run.end')).toEqual([{
      run_idx: 0, cause: 'victory', duration_ms: 2 * STEP, rooms_cleared: 2, encounters_cleared: 2,
    }]);
    expect(playerHp).toBeGreaterThan(0);
    expect(d.director.runIdx).toBe(1);
    expect(d.director.inBossRoom).toBe(false);
    expect(d.director.roomIdx).toBe(0);
    expect(d.encounter.boss).toBeNull();
    expect(d.encounter.assaltante.maxHp).toBe(ASSALTANTE_MAX_HP);
    expect(d.encounter.assaltante.hp).toBe(ASSALTANTE_MAX_HP);
    expect(d.encounter.assaltante.isBarraging).toBe(false);
    expect(cooldownIs(d.encounter.player, DODGE.cooldownMs)).toBe(true);
  });

  it('a boss kill closes the boss window as invalid/source_interrupted inside the ending run', () => {
    const d = makeDirector({ plan: plan({}) });
    d.director.start();
    killEnemy(d);
    // Player next to the boss: it attacks once the first-attack delay is over and opens a dodge window.
    const e = d.encounter.assaltante.position;
    d.encounter.resetPlayer({ x: e.x + 30, y: e.y });
    const opens: string[] = [];
    const closes: Array<{ opp_id: string; outcome: string; reason?: string }> = [];
    d.encounter.bus.on('opp.open', (o) => opens.push(o.opp_id));
    d.encounter.bus.on('opp.close', (c) => closes.push(c));
    let runEnded = false;
    d.encounter.bus.on('run.end', () => { runEnded = true; });
    for (let i = 0; i < 400 && opens.length === 0; i++) d.director.step(STEP);
    expect(opens).toHaveLength(1);
    expect(d.encounter.assaltante.isCommitted).toBe(true);
    killEnemy(d);
    expect(runEnded).toBe(true);
    expect(closes.find((c) => c.opp_id === opens[0])).toMatchObject({ outcome: 'invalid', reason: 'source_interrupted' });
  });

  it('player death in the boss room ends the run as death and the next run starts clean', () => {
    const d = makeDirector({ plan: plan({ dodge_abuse: 1 }, [record('dodge_abuse', 1)]) });
    d.director.start();
    killEnemy(d);
    d.events.length = 0;
    d.encounter.player.takeDamage(9999);
    d.director.step(STEP);
    expect(types(d.events)).toEqual([
      'player.death', 'encounter.end', 'profile.snapshot', 'run.end', 'run.start', 'room.enter', 'encounter.start',
    ]);
    expect(payloads(d.events, 'run.end')).toEqual([{
      run_idx: 0, cause: 'death', duration_ms: 2 * STEP, rooms_cleared: 1, encounters_cleared: 1,
    }]);
    expect(d.director.inBossRoom).toBe(false);
    expect(d.encounter.boss).toBeNull();
    expect(d.encounter.assaltante.maxHp).toBe(ASSALTANTE_MAX_HP);
    expect(d.encounter.assaltante.hp).toBe(ASSALTANTE_MAX_HP);
    expect(cooldownIs(d.encounter.player, DODGE.cooldownMs)).toBe(true);
  });

  it('planBoss is called exactly once per entry and never during the fight', () => {
    const d = makeDirector({ plan: plan({ dodge_abuse: 1 }, [record('dodge_abuse', 1)]) });
    d.director.start();
    expect(d.planBoss).not.toHaveBeenCalled();
    killEnemy(d);
    expect(d.planBoss).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 300 && d.director.inBossRoom; i++) d.director.step(STEP);
    expect(d.planBoss).toHaveBeenCalledTimes(1);
    // A new run reaches the boss again: one more call.
    if (d.director.inBossRoom) killEnemy(d);
    expect(d.director.inBossRoom).toBe(false);
    killEnemy(d);
    expect(d.director.inBossRoom).toBe(true);
    expect(d.planBoss).toHaveBeenCalledTimes(2);
  });

  it('by default the boss comes after BOSS_AFTER_ENCOUNTERS (3) encounters', () => {
    const d = makeDirector({ plan: plan({}), bossAfterEncounters: null });
    d.director.start();
    killEnemy(d);
    killEnemy(d);
    expect(d.director.inBossRoom).toBe(false);
    killEnemy(d);
    expect(d.director.inBossRoom).toBe(true);
    expect(d.calls.filter((c) => c === 'room')).toHaveLength(2);
    expect(payloads<{ room_idx: number }>(d.events, 'room.enter').map((e) => e.room_idx)).toEqual([0, 1, 2]);
  });

  it('when the boss threshold coincides with the end of a room, the room closes once', () => {
    const d = makeDirector({ plan: plan({}), bossAfterEncounters: 2 });
    d.director.start();
    killEnemy(d);
    killEnemy(d);
    expect(d.director.inBossRoom).toBe(true);
    expect(d.calls).toEqual(['enc', 'enc', 'room']);
    expect(payloads<{ room_idx: number }>(d.events, 'room.enter').map((e) => e.room_idx)).toEqual([0, 1]);
    expect(payloads<SnapshotEvent>(d.events, 'profile.snapshot').map((s) => s.snapshot.at)).toEqual(['room.exit', 'boss.entry']);
  });

  it('a passive blocking player triggers boss.barrage and the boss starts a barrage swing', () => {
    const d = makeDirector({
      plan: plan({ passive_defense: 1 }, [record('passive_defense', 1)]),
      bossConfig: { ...BOSS_CONFIG, barrageMaxFraction: 1 }, // chance 1: the draw always fires
    });
    d.director.start();
    killEnemy(d);
    d.events.length = 0;
    const e = d.encounter.assaltante.position;
    d.encounter.resetPlayer({ x: e.x + 60, y: e.y });
    d.encounter.player.startBlock();
    let elapsed = 0;
    for (let i = 0; i < 150 && payloads(d.events, 'enemy.attack_start').length === 0; i++) {
      d.director.step(STEP);
      elapsed += STEP;
    }
    const order = d.events.map(([t]) => t);
    expect(order.indexOf('boss.barrage')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('boss.barrage')).toBeLessThan(order.indexOf('enemy.attack_start'));
    expect(payloads(d.events, 'boss.barrage')).toEqual([{ strikes: 4, chance: 1, duration_mult: 1.5, level: 1 }]);
    expect(payloads(d.events, 'enemy.attack_start')[0]).toEqual({ kind: 'swing' });
    // Before the 2 s first-attack delay: only a barrage can start a swing this early.
    expect(elapsed).toBeLessThan(2000);
    expect(d.encounter.assaltante.isBarraging).toBe(true);
    expect(d.encounter.boss?.barragesFired).toBe(1);
  });
});
