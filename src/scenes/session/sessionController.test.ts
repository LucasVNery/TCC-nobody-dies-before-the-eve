// src/scenes/session/sessionController.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SessionController } from './sessionController';
import type { Platform } from './platform';
import { MemoryEventStore, type EventStore } from '../../telemetry/eventStore';
import { toNdjson } from '../../telemetry/ndjson';
import type { LoggedEvent } from '../../telemetry/schema';

afterEach(() => vi.restoreAllMocks());

interface FakeOpts {
  store?: EventStore;
  persistent?: boolean;
  openFails?: boolean;
  picked?: string | null;
}

let n = 0; // shared so that two fake platforms never mint the same uuid

function fakePlatform(o: FakeOpts = {}) {
  const downloads: Array<{ filename: string; text: string }> = [];
  const hideListeners = new Set<() => void>();
  const platform: Platform = {
    newUuid: () => `uuid-${n++}-aaaaaaaa`,
    nowIso: () => '2026-10-16T12:00:00.000Z',
    openStore: async () => {
      if (o.openFails) throw new Error('no idb');
      return { store: o.store ?? new MemoryEventStore(), persistent: o.persistent ?? false };
    },
    downloadText: (filename, text) => void downloads.push({ filename, text }),
    pickFile: async () => (o.picked === undefined ? null : o.picked),
    onHide: (l) => {
      hideListeners.add(l);
      return () => void hideListeners.delete(l);
    },
  };
  return { platform, downloads, hideListeners };
}

function controller(platform: Platform, nextSeed: () => number = () => 7): SessionController {
  return new SessionController({ platform, entitySize: 20, nextSeed });
}

/** Wraps a store so tests can control append. */
function wrapStore(inner: EventStore, hooks: { append?: (events: readonly LoggedEvent[]) => Promise<void>; close?: () => void }): EventStore {
  return {
    append: hooks.append ?? ((e) => inner.append(e)),
    readAll: () => inner.readAll(),
    getMeta: (k) => inner.getMeta(k),
    setMeta: (k, v) => inner.setMeta(k, v),
    clear: () => inner.clear(),
    close: () => {
      hooks.close?.();
      inner.close();
    },
  };
}

describe('SessionController', () => {
  it('start on an empty store creates a player, starts run 0 and logs session.start with persistent=false for a memory store', async () => {
    const store = new MemoryEventStore();
    const { platform } = fakePlatform({ store });
    const c = controller(platform);
    await c.start();
    expect(c.ready).toBe(true);
    expect(c.history).toEqual([]);
    expect(c.stack.director.runIdx).toBe(0);
    await c.persist();
    const events = await store.readAll();
    expect(events[0].type).toBe('session.start');
    expect(events[0].persistent).toBe(false);
    expect(events.some((e) => e.type === 'run.start' && e.run_idx === 0)).toBe(true);
    expect(await store.getMeta('player_id')).toBe(c.status().playerId);
    expect(c.status().store).toBe('memory');
    await c.shutdown();
  });

  it('start with history rebuilds the profile and continues run numbering', async () => {
    const store = new MemoryEventStore();
    const first = controller(fakePlatform({ store }).platform);
    await first.start();
    first.stack.encounter.player.tryAction('sword_shield.light');
    first.stack.encounter.player.takeDamage(999);
    first.stack.step(16); // run 0 ends, run 1 starts
    await first.shutdown();

    const second = controller(fakePlatform({ store }).platform);
    await second.start();
    expect(second.history.length).toBeGreaterThan(0);
    expect(second.stack.director.runIdx).toBeGreaterThanOrEqual(1);
    expect(second.status().playerId).toBe(first.status().playerId);
    await second.shutdown();
  });

  it('start with an indexeddb-flavoured store that restored reports persistent=true', async () => {
    const store = new MemoryEventStore();
    const { platform } = fakePlatform({ store, persistent: true });
    const c = controller(platform);
    await c.start();
    expect(c.status().persistent).toBe(true);
    expect(c.status().store).toBe('indexeddb');
    await c.persist();
    expect((await store.readAll())[0].persistent).toBe(true);
    await c.shutdown();
  });

  it('onStackReady runs before session.start so subscribers see the first events', async () => {
    const { platform } = fakePlatform();
    const c = controller(platform);
    const seen: string[] = [];
    await c.start({
      onStackReady: (stack) => {
        expect(c.ready).toBe(false);
        stack.recorder.subscribe((e) => seen.push(e.type));
      },
    });
    expect(seen[0]).toBe('session.start');
    expect(seen).toContain('run.start');
    await c.shutdown();
  });

  it('persist drains the recorder buffer into the store and is serialized', async () => {
    const inner = new MemoryEventStore();
    let active = 0;
    let maxActive = 0;
    const starts: number[] = [];
    const store = wrapStore(inner, {
      append: async (events) => {
        active++;
        maxActive = Math.max(maxActive, active);
        starts.push(events.length);
        await new Promise((r) => setTimeout(r, 5));
        await inner.append(events);
        active--;
      },
    });
    const c = controller(fakePlatform({ store }).platform);
    await c.start();
    const before = c.status().buffered;
    expect(before).toBeGreaterThan(0);
    const p1 = c.persist();
    c.stack.recorder.log('obs.test', {});
    const p2 = c.persist();
    await Promise.all([p1, p2]);
    expect(maxActive).toBe(1);
    expect(c.status().buffered).toBe(0);
    expect(starts).toHaveLength(2);
    expect((await inner.readAll()).length).toBe(before + 1);
    await c.shutdown();
  });

  it('a failing append puts the batch back and the next persist retries it, warning once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inner = new MemoryEventStore();
    let failing = true;
    const store = wrapStore(inner, {
      append: async (events) => {
        if (failing) throw new Error('disk full');
        await inner.append(events);
      },
    });
    const c = controller(fakePlatform({ store }).platform);
    await c.start();
    const total = c.status().buffered;
    await c.persist(); // drains, the append fails, the batch is requeued
    expect(c.status().buffered).toBe(total);
    await c.persist(); // second consecutive failure
    await c.persist();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(c.status().writeFailures).toBe(1);
    failing = false;
    await c.persist();
    await c.persist();
    expect((await inner.readAll()).length).toBe(total);
    expect(c.status().buffered).toBe(0);
    await c.shutdown();
  });

  it('exportHistory downloads tcc-historico-<8 chars>-<yyyy-mm-dd>.ndjson with every stored event', async () => {
    const store = new MemoryEventStore();
    const { platform, downloads } = fakePlatform({ store });
    const c = controller(platform);
    await c.start();
    await c.exportHistory();
    expect(downloads).toHaveLength(1);
    const playerId = c.status().playerId.slice(0, 8);
    expect(downloads[0].filename).toBe(`tcc-historico-${playerId}-2026-10-16.ndjson`);
    expect(downloads[0].text).toBe(toNdjson(await store.readAll()));
    expect(downloads[0].text.split('\n').filter(Boolean).length).toBeGreaterThan(1);
    await c.shutdown();
  });

  it('importHistory merges, adopts the file player and returns restart; a cancelled picker returns kept', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const donor = new MemoryEventStore();
    const dc = controller(fakePlatform({ store: donor }).platform);
    await dc.start();
    dc.stack.encounter.player.takeDamage(999);
    dc.stack.step(16);
    await dc.shutdown();
    const text = toNdjson(await donor.readAll());
    const donorId = dc.status().playerId;

    const store = new MemoryEventStore();
    const kept = controller(fakePlatform({ store, picked: null }).platform);
    await kept.start();
    expect(await kept.importHistory()).toBe('kept');
    expect(kept.ready).toBe(true);
    await kept.shutdown();

    const { platform } = fakePlatform({ store, picked: text });
    const c = controller(platform);
    await c.start();
    const ownId = c.status().playerId;
    expect(ownId).not.toBe(donorId);
    expect(await c.importHistory()).toBe('restart');
    expect(c.ready).toBe(false);
    expect(await store.getMeta('player_id')).toBe(donorId);
    expect(warn.mock.calls.some((a) => String(a[0]).includes('other player'))).toBe(true);
    const stored = await store.readAll();
    expect(stored.some((e) => e.player_id === donorId)).toBe(true);
    await c.shutdown();
  });

  it('importHistory stops the simulation (ready=false) before awaiting, and a failed merge keeps playing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let breakMeta = false;
    const store = wrapStore(new MemoryEventStore(), {});
    const realGet = store.getMeta.bind(store);
    store.getMeta = (async (k: string) => {
      if (breakMeta) throw new Error('meta unreadable');
      return realGet(k);
    }) as EventStore['getMeta'];
    const donor = new MemoryEventStore();
    const dc = controller(fakePlatform({ store: donor }).platform);
    await dc.start();
    await dc.shutdown();
    const c = controller(fakePlatform({ store, picked: toNdjson(await donor.readAll()) }).platform);
    await c.start();
    breakMeta = true;
    const p = c.importHistory();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(c.ready).toBe(false);
    expect(await p).toBe('kept'); // the merge threw: nothing merged
    expect(c.ready).toBe(true);
    await c.shutdown();
  });

  it('shutdown flushes pending evidence and closes the store only after in-flight writes settle', async () => {
    const inner = new MemoryEventStore();
    const order: string[] = [];
    const store = wrapStore(inner, {
      append: async (events) => {
        order.push('append-start');
        await new Promise((r) => setTimeout(r, 10));
        await inner.append(events);
        order.push('append-end');
      },
      close: () => void order.push('close'),
    });
    const c = controller(fakePlatform({ store }).platform);
    await c.start();
    void c.persist(); // in flight
    c.stack.recorder.log('obs.last', {});
    await c.shutdown();
    expect(order).toEqual(['append-start', 'append-end', 'append-start', 'append-end', 'close']);
    expect(c.ready).toBe(false);
    expect((await inner.readAll()).some((e) => e.type === 'obs.last')).toBe(true);
  });

  it('shutdown unsubscribes the hide listener, and a hide event flushes while running', async () => {
    const store = new MemoryEventStore();
    const { platform, hideListeners } = fakePlatform({ store });
    const c = controller(platform);
    await c.start();
    expect(hideListeners.size).toBe(1);
    [...hideListeners][0]();
    await c.persist();
    expect((await store.readAll()).length).toBeGreaterThan(0);
    await c.shutdown();
    expect(hideListeners.size).toBe(0);
  });

  it('a restart (shutdown then a new controller with after=previous shutdown) loses no event', async () => {
    const store = new MemoryEventStore();
    const a = controller(fakePlatform({ store }).platform);
    await a.start();
    for (let i = 0; i < 40; i++) a.stack.step(16);
    const closed = a.shutdown();
    const b = controller(fakePlatform({ store }).platform);
    await b.start({ after: closed });
    for (let i = 0; i < 40; i++) b.stack.step(16);
    await b.shutdown();

    const events = await store.readAll();
    const bySession = new Map<string, number[]>();
    for (const e of events) bySession.set(e.session_id, [...(bySession.get(e.session_id) ?? []), e.seq]);
    expect(bySession.size).toBe(2);
    for (const seqs of bySession.values()) {
      const sorted = [...seqs].sort((x, y) => x - y);
      expect(sorted).toEqual(sorted.map((_, i) => i));
    }
    expect(b.history.length).toBeGreaterThan(0);
  });

  it('openStore failure falls back to a memory store, and a boot failure starts a fresh in-memory profile (never rejects)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const c1 = controller(fakePlatform({ openFails: true, persistent: true }).platform);
    await expect(c1.start()).resolves.toBeUndefined();
    expect(c1.ready).toBe(true);
    expect(c1.status().store).toBe('memory');
    expect(c1.status().persistent).toBe(false);
    await c1.shutdown();

    let calls = 0;
    const c2 = controller(
      fakePlatform({}).platform,
      () => {
        if (calls++ === 0) throw new Error('boom');
        return 3;
      },
    );
    await expect(c2.start()).resolves.toBeUndefined();
    expect(c2.ready).toBe(true);
    expect(c2.status().persistent).toBe(false);
    expect(c2.status().store).toBe('memory');
    await c2.shutdown();

    const c3 = controller(fakePlatform({}).platform, () => {
      throw new Error('always');
    });
    await expect(c3.start()).resolves.toBeUndefined();
    expect(c3.ready).toBe(false);
  });
});
