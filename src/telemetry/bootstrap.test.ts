// src/telemetry/bootstrap.test.ts
import { describe, it, expect, vi } from 'vitest';
import { loadProfileState } from './bootstrap';
import { MemoryEventStore, type EventStore } from './eventStore';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import { createTelemetryStack } from './stack';
import { rebuildProfile } from './replay';

describe('loadProfileState', () => {
  it('first launch: creates and saves a player_id, starts at run 0 with an empty profile', async () => {
    const store = new MemoryEventStore();
    const boot = await loadProfileState(store, () => 'new-id');
    expect(boot.playerId).toBe('new-id');
    expect(await store.getMeta('player_id')).toBe('new-id');
    expect(boot.firstRunIdx).toBe(0);
    expect(boot.restored).toBe(true);
    expect(boot.accumulator.snapshot('room.exit').counts).toEqual({});
  });

  it('later launch: keeps the player_id, rebuilds the profile and continues run numbering — also after a reset', async () => {
    const store = new MemoryEventStore();
    await store.setMeta('player_id', 'me');
    let seed = 1;
    const live = new ProfileAccumulator();
    const stack = createTelemetryStack({
      accumulator: live, playerId: 'me', sessionId: 's1', firstRunIdx: 0,
      nextSeed: () => seed++, entitySize: 20,
    });
    stack.recorder.log('session.start', { wall_clock_iso: '2026-09-30T00:00:00.000Z', game_version: 'test', schema_v: 2 });
    stack.director.start();
    stack.encounter.player.tryAction('sword_shield.light');
    stack.encounter.player.takeDamage(999);
    stack.step(16); // run 0 ends, run 1 starts
    stack.recording.resetSession();
    stack.encounter.player.tryAction('sword_shield.light');
    stack.encounter.player.takeDamage(999);
    stack.step(16); // run 1 ends, run 2 starts
    await store.append(stack.recorder.drain());

    const boot = await loadProfileState(store, () => 'unused');

    expect(boot.playerId).toBe('me');
    expect(boot.firstRunIdx).toBe(3);
    expect(boot.accumulator.snapshot('room.exit')).toEqual(live.snapshot('room.exit'));
    expect(boot.accumulator.snapshot('room.exit').counts.action_repertoire).toEqual([1, 1]); // only the post-reset action
  });

  it('ignores other players\' events (after an import) for the profile and the run numbering', async () => {
    const store = new MemoryEventStore();
    await store.setMeta('player_id', 'me');
    const base = { v: 2 as const, t_ms: 0, room_idx: 0, enc_idx: 0 };
    await store.append([
      { ...base, seq: 0, player_id: 'me', session_id: 's-me', run_idx: 1, type: 'run.start' },
      { ...base, seq: 1, player_id: 'me', session_id: 's-me', run_idx: 1, type: 'obs.action', actionType: 'light', weaponId: 'bow' },
      { ...base, seq: 2, player_id: 'me', session_id: 's-me', run_idx: 1, type: 'obs.boundary', kind: 'room' },
      { ...base, seq: 3, player_id: 'me', session_id: 's-me', run_idx: 1, type: 'run.end', cause: 'death' },
      { ...base, seq: 0, player_id: 'other', session_id: 's-other', run_idx: 7, type: 'run.start' },
      { ...base, seq: 1, player_id: 'other', session_id: 's-other', run_idx: 7, type: 'obs.reset' },
    ]);

    const boot = await loadProfileState(store, () => 'unused');

    expect(boot.firstRunIdx).toBe(2);
    expect(boot.accumulator.snapshot('room.exit').counts.action_repertoire).toEqual([1, 1]);
    expect(boot.abandonedRun).toBeNull(); // 'other' has an open run, but it is not ours
  });

  it('warns once when malformed observations were skipped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new MemoryEventStore();
    await store.setMeta('player_id', 'me');
    const base = { v: 2 as const, t_ms: 0, player_id: 'me', session_id: 's', run_idx: 0, room_idx: 0, enc_idx: 0 };
    await store.append([
      { ...base, seq: 0, type: 'obs.record', skill: 'distance', num: '1', den: 1 },
      { ...base, seq: 1, type: 'obs.defense', label: 'teleport' },
    ]);
    await loadProfileState(store, () => 'unused');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('2');
    warn.mockRestore();
  });

  it('closes a run left open by closing the tab, with its old indices, before the next run starts', async () => {
    const store = new MemoryEventStore();
    await store.setMeta('player_id', 'me');
    let seed = 1;
    // Session 1: run 0 ends by death; run 1 has one kill and is then abandoned.
    const s1 = createTelemetryStack({
      accumulator: new ProfileAccumulator(), playerId: 'me', sessionId: 's1', firstRunIdx: 0,
      nextSeed: () => seed++, entitySize: 20,
    });
    s1.startSession({ wall_clock_iso: '2026-09-30T00:00:00.000Z', game_version: 'test', schema_v: 2 }, null);
    s1.encounter.player.takeDamage(999);
    s1.step(16); // run 0 ends, run 1 starts
    s1.encounter.player.tryAction('sword_shield.light');
    s1.encounter.assaltante.takeDamage(999);
    s1.step(16); // kill: encounter 0 -> 1
    for (let i = 0; i < 30; i++) s1.step(16);
    s1.recording.flushPending(); // pagehide flush
    await store.append(s1.recorder.drain());
    // tab closed: no run.end for run 1

    const boot = await loadProfileState(store, () => 'unused');
    expect(boot.firstRunIdx).toBe(2);
    expect(boot.abandonedRun).toMatchObject({ run_idx: 1, room_idx: 0, enc_idx: 1, rooms_cleared: 0, encounters_cleared: 1 });

    // Session 2 boots on the rebuilt profile, closes run 1, plays run 2.
    const live = boot.accumulator;
    const s2 = createTelemetryStack({
      accumulator: live, playerId: 'me', sessionId: 's2', firstRunIdx: boot.firstRunIdx,
      nextSeed: () => seed++, entitySize: 20,
    });
    s2.startSession({ wall_clock_iso: '2026-09-30T01:00:00.000Z', game_version: 'test', schema_v: 2 }, boot.abandonedRun);
    s2.encounter.player.tryAction('sword_shield.light');
    for (let i = 0; i < 30; i++) s2.step(16);
    s2.recording.flushPending();
    await store.append(s2.recorder.drain());

    const s2Events = (await store.readAll()).filter((e) => e.session_id === 's2');
    const closing = s2Events.slice(1, 6);
    expect(s2Events[0].type).toBe('session.start');
    expect(closing.map((e) => (e.type === 'obs.boundary' ? `obs.boundary:${e.kind}` : e.type))).toEqual([
      'encounter.end', 'obs.boundary:encounter', 'obs.boundary:room', 'profile.snapshot', 'run.end',
    ]);
    for (const e of closing) expect(e).toMatchObject({ run_idx: 1, room_idx: 0, enc_idx: 1 });
    expect(closing[3]).toMatchObject({ partial: true, at: 'room.exit' });
    expect(closing[4]).toMatchObject({
      run_idx: 1, cause: 'abandoned', rooms_cleared: 0, encounters_cleared: 1, duration_ms: boot.abandonedRun!.duration_ms,
    });
    expect(s2Events[6]).toMatchObject({ type: 'run.start', run_idx: 2 });

    const rebuilt = rebuildProfile(await store.readAll(), 'me');
    expect(rebuilt.snapshot('room.exit')).toEqual(live.snapshot('room.exit'));
    for (const skill of ['distance', 'patience', 'action_repertoire']) {
      for (const clock of ['trait', 'state'] as const) {
        expect(rebuilt.domain(skill, clock)).toBe(live.domain(skill, clock));
        expect(rebuilt.confidence(skill, clock)).toBe(live.confidence(skill, clock));
      }
    }

    // run 1 is closed now; run 2 (left open by session 2) is the next to close
    const boot3 = await loadProfileState(store, () => 'unused');
    expect(boot3.abandonedRun).toMatchObject({ run_idx: 2 });
    expect(boot3.firstRunIdx).toBe(3);
  });

  it('a store that throws degrades to a fresh in-memory profile instead of crashing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: EventStore = {
      append: async () => { throw new Error('quota'); },
      readAll: async () => { throw new Error('blocked'); },
      getMeta: async () => { throw new Error('blocked'); },
      setMeta: async () => { throw new Error('blocked'); },
      clear: async () => {},
      close: () => {},
    };
    const boot = await loadProfileState(broken, () => 'fallback-id');
    expect(boot).toMatchObject({ playerId: 'fallback-id', firstRunIdx: 0, restored: false, abandonedRun: null });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
