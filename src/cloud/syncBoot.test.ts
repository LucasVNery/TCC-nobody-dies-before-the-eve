import { describe, it, expect, vi, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Account, accountDbName } from './account';
import { FakeCloudApi } from './fakeCloudApi';
import { openAccountStore, AUTH_TIMEOUT_MS, PULL_TIMEOUT_MS, RETRY_MIN_MS, type SyncTimers } from './syncBoot';
import { CLOUD_SYNCED_KEY } from './syncingEventStore';
import { IndexedDbEventStore, type EventStore } from '../telemetry/eventStore';
import { loadProfileState, type BootState } from '../telemetry/bootstrap';
import type { LoggedEvent } from '../telemetry/schema';
import { SessionController } from '../scenes/session/sessionController';
import { createBrowserPlatform } from '../scenes/session/browserPlatform';
import type { Platform } from '../scenes/session/platform';

// Built at runtime: no credential or e-mail literals in the repo.
const mail = (name: string): string => [name, 'test.invalid'].join('@');
const PW = `pw-${4242}`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Collects timers instead of running them; fire() runs the ones pending at call time. */
function manualTimers() {
  let next = 1;
  const pending = new Map<number, { run: () => void; ms: number }>();
  const timers: SyncTimers = {
    set: (run, ms) => {
      const id = next++;
      pending.set(id, { run, ms });
      return id;
    },
    clear: (handle) => void pending.delete(handle as number),
  };
  return {
    timers,
    pending,
    delays: () => [...pending.values()].map((t) => t.ms),
    fire(ms?: number) {
      for (const [id, t] of [...pending]) {
        if (ms !== undefined && t.ms !== ms) continue;
        pending.delete(id);
        t.run();
      }
    },
  };
}

interface Machine {
  factory: IDBFactory;
  account: Account;
  clock: ReturnType<typeof manualTimers>;
  online: Set<() => void>;
  platform: Platform;
}

/** One browser: its own IndexedDB and Account, sharing the fake server. */
function machine(api: FakeCloudApi): Machine {
  const factory = new IDBFactory() as unknown as IDBFactory;
  const account = new Account(api, { idb: () => factory, defer: queueMicrotask });
  const clock = manualTimers();
  const online = new Set<() => void>();
  let n = 0;
  const platform: Platform = {
    newUuid: () => `uuid-${n++}-${Math.random().toString(16).slice(2)}`,
    nowIso: () => '2026-11-04T12:00:00.000Z',
    openStore: async () => {
      const opened = await openAccountStore(account, {
        factory,
        timers: clock.timers,
        onOnline: (l) => {
          online.add(l);
          return () => void online.delete(l);
        },
      });
      if (!opened) throw new Error('no account store');
      return opened;
    },
    downloadText: () => {},
    pickFile: async () => null,
    onHide: () => () => {},
  };
  return { factory, account, clock, online, platform };
}

async function register(api: FakeCloudApi, name: string): Promise<void> {
  await api.signUp(mail(name), PW);
}

/** A short session: one death (run 0 ends) and an action in run 1, then the scene leaves. */
async function playSession(m: Machine): Promise<SessionController> {
  const c = new SessionController({ platform: m.platform, entitySize: 20, nextSeed: () => 4242 });
  await c.start();
  expect(c.ready).toBe(true);
  c.stack.encounter.player.tryAction('sword_shield.light');
  c.stack.encounter.player.takeDamage(999);
  c.stack.step(16); // run 0 ends, run 1 starts
  c.stack.encounter.player.tryAction('sword_shield.light');
  for (let i = 0; i < 10; i++) c.stack.step(16);
  await c.shutdown();
  return c;
}

/** The profile in a comparable form. */
function profileOf(boot: BootState): string {
  const acc = boot.accumulator;
  const skills = ['distance', 'patience', 'action_repertoire'].flatMap((s) =>
    (['trait', 'state'] as const).map((clock) => [s, clock, acc.domain(s, clock), acc.confidence(s, clock)]),
  );
  return JSON.stringify({ snap: acc.snapshot('room.exit'), skills, firstRunIdx: boot.firstRunIdx, abandoned: boot.abandonedRun });
}

const keys = (events: readonly LoggedEvent[]): string[] => events.map((e) => `${e.session_id}#${e.seq}`).sort();
const serverEvents = (api: FakeCloudApi, userId: string): LoggedEvent[] => api.batchesOf(userId).flatMap((b) => b.events);

async function databases(factory: IDBFactory): Promise<string[]> {
  return (await factory.databases()).map((d) => d.name ?? '').sort();
}

/** Lets in-flight IndexedDB work finish. */
const idle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

function ev(player_id: string, session_id: string, seq: number): LoggedEvent {
  return { v: 2, seq, t_ms: seq, player_id, session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type: 'x' };
}

describe('openAccountStore (boot with sync)', () => {
  it('a new machine rebuilds, from the downloaded log, the same profile the original local log gives', async () => {
    const api = new FakeCloudApi();
    await register(api, 'ana');
    const a = machine(api);
    const user = await a.account.signIn(mail('ana'), PW);
    await playSession(a);
    await playSession(a);
    await a.account.signOut(); // waits for the last push of the closed store

    const original = await IndexedDbEventStore.open(a.factory, accountDbName(user.id));
    const originalEvents = await original.readAll();
    const fromLocal = await loadProfileState(original, () => 'unused');
    original.close();
    expect(keys(serverEvents(api, user.id))).toEqual(keys(originalEvents));

    const b = machine(api);
    await b.account.signIn(mail('ana'), PW);
    const opened = await b.platform.openStore();
    expect(keys(await opened.store.readAll())).toEqual(keys(originalEvents));
    const fromCloud = await loadProfileState(opened.store, () => 'unused');
    expect(profileOf(fromCloud)).toEqual(profileOf(fromLocal));
    expect(fromCloud.history).toHaveLength(fromLocal.history.length);
    opened.store.close();
  });

  it('new sessions log the account id as player_id, set in meta before the profile is loaded', async () => {
    const api = new FakeCloudApi();
    await register(api, 'ana');
    const m = machine(api);
    const user = await m.account.signIn(mail('ana'), PW);
    const c = await playSession(m);
    expect(c.status().playerId).toBe(user.id);
    const store = await IndexedDbEventStore.open(m.factory, accountDbName(user.id));
    expect(await store.getMeta('player_id')).toBe(user.id);
    const events = await store.readAll();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.player_id === user.id)).toBe(true);
    store.close();
  });

  it('two accounts in one browser use separate databases and never see or push each other\'s events', async () => {
    const api = new FakeCloudApi();
    await register(api, 'ana');
    await register(api, 'bia');
    const m = machine(api);
    const ana = await m.account.signIn(mail('ana'), PW);
    await playSession(m);
    await m.account.signOut();

    const bia = await m.account.signIn(mail('bia'), PW);
    const c = await playSession(m);
    expect(c.status().playerId).toBe(bia.id);
    await m.account.signOut();

    expect(await databases(m.factory)).toEqual([accountDbName(ana.id), accountDbName(bia.id)].sort());
    const anaLocal = await IndexedDbEventStore.open(m.factory, accountDbName(ana.id));
    const biaLocal = await IndexedDbEventStore.open(m.factory, accountDbName(bia.id));
    const anaEvents = await anaLocal.readAll();
    const biaEvents = await biaLocal.readAll();
    expect(anaEvents.every((e) => e.player_id === ana.id)).toBe(true);
    expect(biaEvents.every((e) => e.player_id === bia.id)).toBe(true);
    expect(serverEvents(api, ana.id).every((e) => e.player_id === ana.id)).toBe(true);
    expect(serverEvents(api, bia.id).every((e) => e.player_id === bia.id)).toBe(true);
    expect(keys(serverEvents(api, bia.id))).toEqual(keys(biaEvents));
    anaLocal.close();
    biaLocal.close();
  });

  it('a store left open by one account pushes nothing while another account is signed in', async () => {
    const api = new FakeCloudApi();
    await register(api, 'ana');
    await register(api, 'bia');
    const m = machine(api);
    const ana = await m.account.signIn(mail('ana'), PW);
    const { store } = await m.platform.openStore();
    // ana's session expires and bia signs in elsewhere on the same client; ana's game keeps recording
    await api.signOut();
    const bia = await m.account.signIn(mail('bia'), PW);
    await store.append([ev(ana.id, 's-ana', 0), ev(ana.id, 's-ana', 1)]);
    m.clock.fire();
    for (const l of m.online) l();
    await vi.waitFor(async () => expect(m.clock.pending.size).toBe(0));
    expect(serverEvents(api, bia.id)).toEqual([]);
    expect(serverEvents(api, ana.id)).toEqual([]);
    store.close();
  });

  it('only events of the account itself are pushed (an imported foreign session stays local)', async () => {
    const api = new FakeCloudApi();
    await register(api, 'ana');
    const m = machine(api);
    const ana = await m.account.signIn(mail('ana'), PW);
    const { store } = await m.platform.openStore();
    await store.append([ev('someone-else', 's-x', 0), ev(ana.id, 's-ana', 0)]);
    store.close();
    await m.account.signOut();
    expect(keys(serverEvents(api, ana.id))).toEqual(['s-ana#0']);
  });

  it('the local (pre-login) database is never synced', async () => {
    const api = new FakeCloudApi();
    await register(api, 'ana');
    const m = machine(api);
    const legacy = await IndexedDbEventStore.open(m.factory); // tcc-telemetry
    await legacy.setMeta('player_id', 'browser-uuid');
    await legacy.append([ev('browser-uuid', 's-old', 0)]);
    legacy.close();
    const ana = await m.account.signIn(mail('ana'), PW);
    await playSession(m);
    await m.account.signOut();
    expect(serverEvents(api, ana.id).some((e) => e.session_id === 's-old')).toBe(false);
    const again = await IndexedDbEventStore.open(m.factory);
    expect(await again.getMeta(CLOUD_SYNCED_KEY)).toBeUndefined();
    expect(await again.readAll()).toHaveLength(1);
    again.close();
  });

  it('a failing pull does not stop the game from starting on the local copy', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = new FakeCloudApi();
    await register(api, 'ana');
    const m = machine(api);
    const ana = await m.account.signIn(mail('ana'), PW);
    await playSession(m);
    const local = await IndexedDbEventStore.open(m.factory, accountDbName(ana.id));
    const before = (await local.readAll()).length;
    local.close();

    api.failNext(5);
    const c = new SessionController({ platform: m.platform, entitySize: 20, nextSeed: () => 4242 });
    await c.start();
    expect(c.ready).toBe(true);
    expect(c.status().store).toBe('indexeddb');
    expect(c.stack.director.runIdx).toBeGreaterThanOrEqual(2); // continued from the local history
    expect(before).toBeGreaterThan(0);
    await c.shutdown();
  });

  it('a pull that hangs is given up after the time limit, and its late answer writes nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = new FakeCloudApi();
    await register(api, 'ana');
    const m = machine(api);
    const ana = await m.account.signIn(mail('ana'), PW);
    let answer!: (events: LoggedEvent[]) => void;
    vi.spyOn(api, 'pullEvents').mockImplementation(() => new Promise((r) => (answer = r)));

    const c = new SessionController({ platform: m.platform, entitySize: 20, nextSeed: () => 4242 });
    const starting = c.start();
    await vi.waitFor(() => expect(m.clock.delays()).toContain(PULL_TIMEOUT_MS));
    m.clock.fire(PULL_TIMEOUT_MS);
    await starting;
    expect(c.ready).toBe(true);

    answer([ev(ana.id, 'late', 0)]);
    await new Promise((r) => setTimeout(r, 0));
    await c.shutdown();
    await m.account.signOut();
    const local = await IndexedDbEventStore.open(m.factory, accountDbName(ana.id));
    expect((await local.readAll()).some((e) => e.session_id === 'late')).toBe(false);
    local.close();
  });

  it('a pull whose session check hangs is given up after the time limit too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = new FakeCloudApi();
    await register(api, 'ana');
    const m = machine(api);
    await m.account.init();
    const ana = await m.account.signIn(mail('ana'), PW);
    await api.signIn(mail('ana'), PW);
    const getUser = api.getUser.bind(api);
    let answer!: () => void;
    const gate = new Promise<void>((r) => (answer = r));
    vi.spyOn(api, 'getUser').mockImplementation(async () => {
      await gate;
      return getUser();
    });
    const pull = vi.spyOn(api, 'pullEvents').mockResolvedValue([ev(ana.id, 'late', 0)]);

    const c = new SessionController({ platform: m.platform, entitySize: 20, nextSeed: () => 4242 });
    const starting = c.start();
    await vi.waitFor(() => expect(m.clock.delays()).toContain(PULL_TIMEOUT_MS));
    m.clock.fire(PULL_TIMEOUT_MS);
    await starting;
    expect(c.ready).toBe(true);

    answer(); // the late session check passes, but the pull was given up: nothing is written
    await idle();
    expect(pull).not.toHaveBeenCalled();
    await c.shutdown();
    await idle();
    const local = await IndexedDbEventStore.open(m.factory, accountDbName(ana.id));
    expect((await local.readAll()).some((e) => e.session_id === 'late')).toBe(false);
    local.close();
  });

  it('a session restore that hangs starts the game signed out, and the account catches up later', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = new FakeCloudApi();
    await register(api, 'ana');
    const ana = await api.signIn(mail('ana'), PW); // stored session from an earlier visit
    const getUser = api.getUser.bind(api);
    let answer!: () => void;
    const gate = new Promise<void>((r) => (answer = r));
    vi.spyOn(api, 'getUser').mockImplementation(async () => {
      await gate;
      return getUser();
    });
    const m = machine(api);
    const opening = openAccountStore(m.account, { factory: m.factory, timers: m.clock.timers });
    await vi.waitFor(() => expect(m.clock.delays()).toContain(AUTH_TIMEOUT_MS));
    m.clock.fire(AUTH_TIMEOUT_MS);
    expect(await opening).toBeNull(); // the caller falls back to the local store
    expect(await databases(m.factory)).toEqual([]);

    answer();
    await vi.waitFor(() => expect(m.account.state.user?.id).toBe(ana.id));
  });

  it('losing the session mid-game pauses the push; signing in again sends what piled up', async () => {
    const api = new FakeCloudApi();
    await register(api, 'ana');
    const m = machine(api);
    const ana = await m.account.signIn(mail('ana'), PW);
    const { store } = await m.platform.openStore();

    await api.signOut(); // expired session, reported through onAuthChange
    expect(m.account.state.user).toBeNull();
    await expect(store.append([ev(ana.id, 's', 0), ev(ana.id, 's', 1)])).resolves.toBeUndefined();
    m.clock.fire(); // the scheduled push finds nobody signed in
    await new Promise((r) => setTimeout(r, 0));
    expect(serverEvents(api, ana.id)).toEqual([]);
    expect(m.clock.pending.size).toBe(0); // no retry loop while signed out

    await m.account.signIn(mail('ana'), PW);
    await vi.waitFor(() => expect(keys(serverEvents(api, ana.id))).toEqual(['s#0', 's#1']));
    store.close();
  });

  it('a failed push is retried on a timer with growing delays, and when the network comes back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = new FakeCloudApi();
    await register(api, 'ana');
    const m = machine(api);
    const ana = await m.account.signIn(mail('ana'), PW);
    const { store } = await m.platform.openStore();
    await idle(); // the boot push (nothing pending) is done

    api.failNext(2);
    await store.append([ev(ana.id, 's', 0)]);
    m.clock.fire(); // scheduled push: fails
    await vi.waitFor(() => expect(m.clock.delays()).toEqual([RETRY_MIN_MS]));
    m.clock.fire(RETRY_MIN_MS); // retry: fails again, longer delay
    await vi.waitFor(() => expect(m.clock.delays()).toEqual([RETRY_MIN_MS * 2]));
    expect(serverEvents(api, ana.id)).toEqual([]);

    for (const l of m.online) l(); // back online: pushed right away, retry timer dropped
    await vi.waitFor(() => expect(keys(serverEvents(api, ana.id))).toEqual(['s#0']));
    expect(m.clock.pending.size).toBe(0);
    store.close();
  });

  it('close cancels its timers and listeners, and still pushes the last events', async () => {
    const api = new FakeCloudApi();
    await register(api, 'ana');
    const m = machine(api);
    const ana = await m.account.signIn(mail('ana'), PW);
    const { store } = await m.platform.openStore();
    await store.append([ev(ana.id, 's', 0)]);
    expect(m.clock.pending.size).toBe(1);
    store.close();
    expect(m.clock.pending.size).toBe(0);
    expect(m.online.size).toBe(0);
    await m.account.signOut();
    expect(keys(serverEvents(api, ana.id))).toEqual(['s#0']);
  });

  it('resolves null without a signed-in user', async () => {
    const api = new FakeCloudApi();
    const m = machine(api);
    expect(await openAccountStore(m.account, { factory: m.factory, timers: m.clock.timers })).toBeNull();
    expect(await databases(m.factory)).toEqual([]);
  });
});

describe('createBrowserPlatform store', () => {
  async function openWith(account?: Account): Promise<{ store: EventStore; factory: IDBFactory }> {
    const factory = new IDBFactory() as unknown as IDBFactory;
    vi.stubGlobal('indexedDB', factory);
    const { store, persistent } = await createBrowserPlatform(account).openStore();
    expect(persistent).toBe(true);
    return { store, factory };
  }

  it('without credentials (local mode) opens tcc-telemetry, exactly as before accounts', async () => {
    for (const account of [undefined, new Account(null)]) {
      const { store, factory } = await openWith(account);
      expect(store).toBeInstanceOf(IndexedDbEventStore);
      expect(await databases(factory)).toEqual(['tcc-telemetry']);
      expect(await store.getMeta('player_id')).toBeUndefined(); // loadProfileState mints the local id, as before
      store.close();
    }
  });

  it('in cloud mode with nobody signed in, falls back to the local, unsynced database', async () => {
    const { store, factory } = await openWith(new Account(new FakeCloudApi(), { defer: queueMicrotask }));
    expect(store).toBeInstanceOf(IndexedDbEventStore);
    expect(await databases(factory)).toEqual(['tcc-telemetry']);
    store.close();
  });
});
