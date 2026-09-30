// src/telemetry/bootstrap.test.ts
import { describe, it, expect, vi } from 'vitest';
import { loadProfileState } from './bootstrap';
import { MemoryEventStore, type EventStore } from './eventStore';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import { createTelemetryStack } from './stack';

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
    expect(boot).toMatchObject({ playerId: 'fallback-id', firstRunIdx: 0, restored: false });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
