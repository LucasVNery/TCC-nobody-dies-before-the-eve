// src/telemetry/eventStore.test.ts
import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { MemoryEventStore, IndexedDbEventStore, type EventStore } from './eventStore';
import type { LoggedEvent } from './schema';

function ev(session_id: string, seq: number, type = 'x', extra: Record<string, unknown> = {}): LoggedEvent {
  return { v: 2, seq, t_ms: seq, player_id: 'p', session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type, ...extra };
}

let dbCounter = 0;
const factories: Array<[string, () => Promise<EventStore>]> = [
  ['MemoryEventStore', async () => new MemoryEventStore()],
  ['IndexedDbEventStore', () => IndexedDbEventStore.open(new IDBFactory() as unknown as IDBFactory, `test-${dbCounter++}`)],
];

describe.each(factories)('%s', (_name, make) => {
  it('reads back appended events in chronological order', async () => {
    const store = await make();
    await store.append([ev('b', 1), ev('b', 0, 'session.start', { wall_clock_iso: '2026-09-02T00:00:00.000Z' })]);
    await store.append([ev('a', 0, 'session.start', { wall_clock_iso: '2026-09-01T00:00:00.000Z' }), ev('a', 1)]);
    const all = await store.readAll();
    expect(all.map((e) => `${e.session_id}#${e.seq}`)).toEqual(['a#0', 'a#1', 'b#0', 'b#1']);
    store.close();
  });

  it('appending the same (session_id, seq) twice keeps one copy', async () => {
    const store = await make();
    await store.append([ev('a', 0), ev('a', 1)]);
    await store.append([ev('a', 1), ev('a', 2)]);
    expect((await store.readAll()).map((e) => e.seq)).toEqual([0, 1, 2]);
    store.close();
  });

  it('stores and reads meta values; missing keys are undefined', async () => {
    const store = await make();
    expect(await store.getMeta<string>('player_id')).toBeUndefined();
    await store.setMeta('player_id', 'abc');
    expect(await store.getMeta<string>('player_id')).toBe('abc');
    store.close();
  });

  it('clear() empties events and meta', async () => {
    const store = await make();
    await store.append([ev('a', 0)]);
    await store.setMeta('player_id', 'abc');
    await store.clear();
    expect(await store.readAll()).toEqual([]);
    expect(await store.getMeta('player_id')).toBeUndefined();
    store.close();
  });

  it('append([]) is a no-op', async () => {
    const store = await make();
    await store.append([]);
    expect(await store.readAll()).toEqual([]);
    store.close();
  });
});
