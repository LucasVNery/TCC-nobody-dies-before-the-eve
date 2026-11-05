import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { adoptHistory, readLocalGuestHistory, readLegacyMarker, writeLegacyMarker, LEGACY_DB_NAME, type MarkerStorage } from './adoptLocal';
import { IndexedDbEventStore, MemoryEventStore } from '../telemetry/eventStore';
import type { LoggedEvent } from '../telemetry/schema';

const ev = (player: string, session: string, seq: number, extra: Record<string, unknown> = {}): LoggedEvent => ({
  v: 2,
  seq,
  t_ms: seq * 10,
  player_id: player,
  session_id: session,
  run_idx: 0,
  room_idx: 0,
  enc_idx: 0,
  type: 'x',
  ...extra,
});

async function seedLegacy(factory: IDBFactory, player: string, events: LoggedEvent[]): Promise<void> {
  const store = await IndexedDbEventStore.open(factory);
  await store.setMeta('player_id', player);
  await store.append(events);
  store.close();
}

describe('readLocalGuestHistory', () => {
  it('reads only the events of the local meta.player_id, ordered', async () => {
    const f = new IDBFactory();
    await seedLegacy(f, 'local', [ev('local', 's1', 1), ev('other', 's9', 0), ev('local', 's1', 0)]);
    const got = await readLocalGuestHistory(f);
    expect(got.map((e) => `${e.session_id}#${e.seq}`)).toEqual(['s1#0', 's1#1']);
    expect(got.every((e) => e.player_id === 'local')).toBe(true);
  });

  it('does not create the database when it does not exist', async () => {
    const f = new IDBFactory();
    expect(await readLocalGuestHistory(f)).toEqual([]);
    expect((await f.databases()).map((d) => d.name)).not.toContain(LEGACY_DB_NAME);
  });

  it('does not create the database even when databases() is unavailable', async () => {
    const f = new IDBFactory();
    const listing = f.databases.bind(f);
    Object.defineProperty(f, 'databases', { value: undefined, configurable: true });
    expect(await readLocalGuestHistory(f)).toEqual([]);
    Object.defineProperty(f, 'databases', { value: listing, configurable: true });
    expect((await f.databases()).map((d) => d.name)).not.toContain(LEGACY_DB_NAME);
  });

  it('is empty when the database has no local player', async () => {
    const f = new IDBFactory();
    const store = await IndexedDbEventStore.open(f);
    await store.append([ev('x', 's', 0)]);
    store.close();
    expect(await readLocalGuestHistory(f)).toEqual([]);
  });

  it('leaves the database unchanged', async () => {
    const f = new IDBFactory();
    await seedLegacy(f, 'local', [ev('local', 's1', 0), ev('other', 's2', 0)]);
    const read = async () => {
      const s = await IndexedDbEventStore.open(f);
      const out = { events: await s.readAll(), pid: await s.getMeta('player_id') };
      s.close();
      return out;
    };
    const before = await read();
    await readLocalGuestHistory(f);
    expect(await read()).toEqual(before);
  });
});

describe('adoptHistory', () => {
  it('rewrites only player_id and keeps the (session_id, seq) keys', async () => {
    const target = new MemoryEventStore();
    const source = [ev('local', 's1', 0, { foo: 1 }), ev('local', 's1', 1)];
    expect(await adoptHistory(source, 'user-1', target)).toBe(2);
    const got = await target.readAll();
    expect(got).toEqual([{ ...source[0], player_id: 'user-1' }, { ...source[1], player_id: 'user-1' }]);
    expect(source[0].player_id).toBe('local');
  });

  it('is idempotent', async () => {
    const target = new MemoryEventStore();
    const source = [ev('local', 's1', 0), ev('local', 's1', 1)];
    await adoptHistory(source, 'user-1', target);
    await adoptHistory(source, 'user-1', target);
    expect(await target.readAll()).toHaveLength(2);
  });

  it('does nothing for an empty list', async () => {
    const target = new MemoryEventStore();
    expect(await adoptHistory([], 'user-1', target)).toBe(0);
    expect(await target.readAll()).toEqual([]);
  });

  it('never alters the legacy database', async () => {
    const f = new IDBFactory();
    await seedLegacy(f, 'local', [ev('local', 's1', 0)]);
    const target = await IndexedDbEventStore.open(f, 'tcc-telemetry-user-1');
    await adoptHistory(await readLocalGuestHistory(f), 'user-1', target);
    target.close();
    const legacy = await IndexedDbEventStore.open(f);
    expect((await legacy.readAll()).map((e) => e.player_id)).toEqual(['local']);
    legacy.close();
  });
});

describe('legacy marker', () => {
  const memory = (): MarkerStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };

  it('is absent at first; after account A imports, any user sees it (B gets no offer)', () => {
    const st = memory();
    expect(readLegacyMarker(st)).toBeNull();
    expect(writeLegacyMarker('user-a', 'imported', st)).toBe(true);
    expect(readLegacyMarker(st)).toEqual({ by: 'user-a', answer: 'imported' });
  });

  it('records a discard the same way and stores nothing but id and answer', () => {
    const st = memory();
    writeLegacyMarker('user-a', 'discarded', st);
    expect(readLegacyMarker(st)).toEqual({ by: 'user-a', answer: 'discarded' });
    expect(Object.keys(JSON.parse([...st.data.values()][0]))).toEqual(['by', 'answer']);
  });

  it('tolerates throwing, missing and malformed storage', () => {
    const bad: MarkerStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readLegacyMarker(bad)).toBeNull();
    expect(writeLegacyMarker('u', 'imported', bad)).toBe(false);
    const st = memory();
    st.data.set('tcc-legacy-import', '{oops');
    expect(readLegacyMarker(st)).toBeNull();
  });
});
