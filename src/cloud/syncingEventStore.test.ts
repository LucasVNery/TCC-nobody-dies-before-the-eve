import { describe, it, expect } from 'vitest';
import { SyncingEventStore, CLOUD_SYNCED_KEY } from './syncingEventStore';
import { FakeCloudApi } from './fakeCloudApi';
import { CloudError, type EventBatch } from './cloudApi';
import { MemoryEventStore } from '../telemetry/eventStore';
import { createPrng } from '../core/prng';
import type { LoggedEvent } from '../telemetry/schema';

// Built at runtime: no credential or e-mail literals in the repo.
const MAIL = ['player', 'test.invalid'].join('@');
const PW = `pw-${4242}`;

function ev(session_id: string, seq: number, extra: Record<string, unknown> = {}): LoggedEvent {
  return { v: 2, seq, t_ms: seq, player_id: 'p', session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type: 'x', ...extra };
}
const range = (s: string, from: number, to: number): LoggedEvent[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ev(s, from + i));

async function signedInApi(): Promise<{ api: FakeCloudApi; userId: string }> {
  const api = new FakeCloudApi();
  await api.signUp(MAIL, PW);
  const user = await api.signIn(MAIL, PW);
  return { api, userId: user.id };
}

/** Collects scheduled runs instead of running them. */
function manualSchedule() {
  const runs: (() => void)[] = [];
  return {
    schedule: (run: () => void) => {
      runs.push(run);
    },
    runs,
    flush() {
      const pending = runs.splice(0);
      for (const r of pending) r();
    },
  };
}

/** Every event the fake server holds, as `${session}#${seq}` keys, sorted. */
function serverKeys(api: FakeCloudApi, userId: string): string[] {
  return api
    .batchesOf(userId)
    .flatMap((b) => b.events.map((e) => `${e.session_id}#${e.seq}`))
    .sort();
}

describe('SyncingEventStore', () => {
  it('append writes locally and schedules one sync per burst', async () => {
    const { api } = await signedInApi();
    const local = new MemoryEventStore();
    const sch = manualSchedule();
    const store = new SyncingEventStore({ local, api, schedule: sch.schedule });
    await store.append([ev('s', 0)]);
    await store.append([ev('s', 1)]);
    await store.append([ev('s', 2), ev('s', 3)]);
    expect(sch.runs).toHaveLength(1);
    expect((await local.readAll()).map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    await store.append([]);
    expect(sch.runs).toHaveLength(1);
    sch.flush();
    await store.syncNow(); // queued behind the scheduled one
    expect(await store.pendingCount()).toBe(0);
    await store.append([ev('s', 4)]);
    expect(sch.runs).toHaveLength(1); // a new burst gets a new schedule
  });

  it('syncNow sends what is missing, advances progress, and does not resend', async () => {
    const { api, userId } = await signedInApi();
    const local = new MemoryEventStore();
    const store = new SyncingEventStore({ local, api, schedule: () => {}, maxBatch: 3 });
    await store.append([...range('a', 0, 4), ...range('b', 0, 1)]);
    expect(await store.pendingCount()).toBe(7);
    expect(await store.syncNow()).toEqual({ sent: 7, failed: false });
    expect(await local.getMeta(CLOUD_SYNCED_KEY)).toEqual({ a: 4, b: 1 });
    expect(await store.pendingCount()).toBe(0);
    expect(await store.syncNow()).toEqual({ sent: 0, failed: false });
    expect(api.batchesOf(userId)).toHaveLength(3);
    await store.append(range('a', 5, 6));
    expect(await store.syncNow()).toEqual({ sent: 2, failed: false });
    expect(serverKeys(api, userId)).toHaveLength(9);
  });

  it('a network failure keeps events local and progress unchanged; the retry stores each event once', async () => {
    const { api, userId } = await signedInApi();
    const local = new MemoryEventStore();
    const store = new SyncingEventStore({ local, api, schedule: () => {}, maxBatch: 2 });
    await store.append(range('s', 0, 4));
    api.failNext(1);
    expect(await store.syncNow()).toEqual({ sent: 0, failed: true });
    expect(await local.getMeta(CLOUD_SYNCED_KEY)).toBeUndefined();
    expect(await store.pendingCount()).toBe(5);
    expect(await local.readAll()).toHaveLength(5);
    expect(api.batchesOf(userId)).toHaveLength(0);

    await store.append(range('s', 5, 5));
    expect(await store.syncNow()).toEqual({ sent: 6, failed: false });
    const keys = serverKeys(api, userId);
    expect(keys).toEqual([...new Set(keys)]);
    expect(keys).toHaveLength(6);
  });

  it('append never throws because of the network, signed out or failing', async () => {
    const api = new FakeCloudApi(); // not signed in: pushes fail with an auth error
    const local = new MemoryEventStore();
    const sch = manualSchedule();
    const store = new SyncingEventStore({ local, api, schedule: sch.schedule });
    api.failNext(5);
    await expect(store.append(range('s', 0, 2))).resolves.toBeUndefined();
    sch.flush();
    expect(await store.syncNow()).toEqual({ sent: 0, failed: true });
    expect(await local.readAll()).toHaveLength(3);
    expect(await store.pendingCount()).toBe(3);
  });

  it('a resend with more events and the same firstSeq replaces the stored batch', async () => {
    const { api, userId } = await signedInApi();
    // The server stores the push, but the answer is lost on the way back.
    let loseAnswer = true;
    const lossy = Object.create(api) as FakeCloudApi;
    lossy.pushBatches = async (batches: readonly EventBatch[]) => {
      await api.pushBatches(batches);
      if (loseAnswer) {
        loseAnswer = false;
        throw new CloudError('network', 'answer lost');
      }
    };
    const local = new MemoryEventStore();
    const store = new SyncingEventStore({ local, api: lossy, schedule: () => {}, maxBatch: 10 });
    await store.append(range('s', 0, 2));
    expect((await store.syncNow()).failed).toBe(true);
    expect(api.batchesOf(userId).map((b) => [b.firstSeq, b.lastSeq])).toEqual([[0, 2]]);
    await store.append(range('s', 3, 4));
    expect(await store.syncNow()).toEqual({ sent: 5, failed: false });
    expect(api.batchesOf(userId).map((b) => [b.firstSeq, b.lastSeq])).toEqual([[0, 4]]);
    expect(serverKeys(api, userId)).toHaveLength(5);
  });

  it('overlapping syncs neither duplicate nor send a shrinking batch', async () => {
    const { api, userId } = await signedInApi();
    const pushed: EventBatch[] = [];
    const spy = Object.create(api) as FakeCloudApi;
    spy.pushBatches = async (batches: readonly EventBatch[]) => {
      pushed.push(...batches.map((b) => structuredClone(b)));
      await api.pushBatches(batches);
    };
    const local = new MemoryEventStore();
    const store = new SyncingEventStore({ local, api: spy, schedule: () => {}, maxBatch: 4 });
    const rng = createPrng(4242);
    let seq = 0;
    const work: Promise<unknown>[] = [];
    for (let round = 0; round < 20; round++) {
      const n = 1 + rng.nextInt(5);
      work.push(store.append(range('s', seq, seq + n - 1)));
      seq += n;
      if (rng.next() < 0.5) work.push(store.syncNow());
    }
    await Promise.all(work);
    await store.syncNow();
    expect(await store.pendingCount()).toBe(0);
    const keys = serverKeys(api, userId);
    expect(keys).toHaveLength(seq);
    expect(new Set(keys).size).toBe(seq);
    // No push ever re-sent a range the server already had confirmed.
    const seen = new Set<string>();
    for (const b of pushed) {
      const k = `${b.sessionId}:${b.firstSeq}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('a new store over the same local storage resumes from cloud_synced', async () => {
    const { api, userId } = await signedInApi();
    const local = new MemoryEventStore();
    const first = new SyncingEventStore({ local, api, schedule: () => {} });
    await first.append(range('s', 0, 3));
    await first.syncNow();
    await local.append(range('s', 4, 6)); // written before the reload, never synced
    const reopened = new SyncingEventStore({ local, api, schedule: () => {} });
    expect(await reopened.pendingCount()).toBe(3);
    expect(await reopened.syncNow()).toEqual({ sent: 3, failed: false });
    expect(api.batchesOf(userId).map((b) => [b.firstSeq, b.lastSeq])).toEqual([[0, 3], [4, 6]]);
  });

  it('pull brings missing events, is idempotent, keeps local ones and does not push them back', async () => {
    const { api, userId } = await signedInApi();
    const other = new SyncingEventStore({ local: new MemoryEventStore(), api, schedule: () => {} });
    await other.append(range('remote', 0, 2));
    await other.syncNow();

    const local = new MemoryEventStore();
    const store = new SyncingEventStore({ local, api, schedule: () => {} });
    await local.append(range('mine', 0, 1));
    expect(await store.pull()).toBe(3);
    expect(await store.pull()).toBe(0);
    const keys = (await store.readAll()).map((e) => `${e.session_id}#${e.seq}`).sort();
    expect(keys).toEqual(['mine#0', 'mine#1', 'remote#0', 'remote#1', 'remote#2']);
    expect(await store.pendingCount()).toBe(2);
    expect(await store.syncNow()).toEqual({ sent: 2, failed: false });
    expect(serverKeys(api, userId)).toHaveLength(5);
  });

  it('pull propagates a network error and changes nothing local', async () => {
    const { api } = await signedInApi();
    const local = new MemoryEventStore();
    const store = new SyncingEventStore({ local, api, schedule: () => {} });
    await local.append(range('s', 0, 1));
    api.failNext(1);
    await expect(store.pull()).rejects.toBeInstanceOf(CloudError);
    expect(await local.readAll()).toHaveLength(2);
    expect(await store.pull()).toBe(0);
  });

  it('readAll, getMeta, setMeta, clear and close delegate to the local store', async () => {
    const { api } = await signedInApi();
    const local = new MemoryEventStore();
    let closed = false;
    local.close = () => {
      closed = true;
    };
    const store = new SyncingEventStore({ local, api, schedule: () => {} });
    await local.append([ev('s', 0)]);
    expect(await store.readAll()).toEqual(await local.readAll());
    await store.setMeta('k', { x: 1 });
    expect(await local.getMeta('k')).toEqual({ x: 1 });
    await local.setMeta('j', 2);
    expect(await store.getMeta('j')).toBe(2);
    await store.clear();
    expect(await local.readAll()).toEqual([]);
    expect(await local.getMeta('k')).toBeUndefined();
    store.close();
    expect(closed).toBe(true);
  });

  it("a pull that returns another user's events never pushes them into this account", async () => {
    // The real API returns own events only; this stub guards the store against a misbehaving server.
    const { api, userId } = await signedInApi();
    const foreign = range('theirs', 0, 2);
    const stub: FakeCloudApi = Object.assign(Object.create(api) as FakeCloudApi, {
      pullEvents: async () => structuredClone(foreign),
    });

    const store = new SyncingEventStore({ local: new MemoryEventStore(), api: stub, schedule: () => {} });
    expect(await store.pull()).toBe(3);
    expect(await store.pendingCount()).toBe(0);
    expect(await store.syncNow()).toEqual({ sent: 0, failed: false });
    expect(api.batchesOf(userId)).toEqual([]);
  });

  it('a lost append after pull wrote progress leaves nothing pending, and the next pull re-appends', async () => {
    const { api, userId } = await signedInApi();
    const other = new SyncingEventStore({ local: new MemoryEventStore(), api, schedule: () => {} });
    await other.append(range('remote', 0, 2));
    await other.syncNow();
    const before = api.batchesOf(userId);

    const local = new MemoryEventStore();
    const realAppend = local.append.bind(local);
    let breakAppend = true;
    local.append = async (events) => {
      if (breakAppend) {
        breakAppend = false;
        throw new Error('disk full');
      }
      return realAppend(events);
    };
    const store = new SyncingEventStore({ local, api, schedule: () => {} });
    await expect(store.pull()).rejects.toThrow('disk full');
    expect(await local.getMeta(CLOUD_SYNCED_KEY)).toEqual({ remote: 2 });
    expect(await store.pendingCount()).toBe(0);
    expect(await store.syncNow()).toEqual({ sent: 0, failed: false });
    expect(api.batchesOf(userId)).toEqual(before);
    expect(await store.pull()).toBe(3);
    expect(await local.readAll()).toHaveLength(3);
  });

  it('a clear() landing while a sync is in flight leaves the store empty with no stale progress', async () => {
    const { api, userId } = await signedInApi();
    let started!: () => void;
    const pushStarted = new Promise<void>((r) => (started = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = Object.create(api) as FakeCloudApi;
    slow.pushBatches = async (batches: readonly EventBatch[]) => {
      started();
      await gate;
      await api.pushBatches(batches);
    };
    const local = new MemoryEventStore();
    const store = new SyncingEventStore({ local, api: slow, schedule: () => {} });
    await store.append(range('s', 0, 2));
    const sync = store.syncNow();
    await pushStarted;
    await store.clear();
    release();
    await sync;
    expect(await local.readAll()).toEqual([]);
    expect(await local.getMeta(CLOUD_SYNCED_KEY)).toBeUndefined();
    expect(api.batchesOf(userId)).toHaveLength(1); // the cloud copy is separate (deleteMyData)
    await store.append(range('s', 0, 0));
    expect(await store.pendingCount()).toBe(1);
  });

  it('a clear() landing while a pull is in flight leaves the store empty with no stale progress', async () => {
    const { api } = await signedInApi();
    const other = new SyncingEventStore({ local: new MemoryEventStore(), api, schedule: () => {} });
    await other.append(range('remote', 0, 2));
    await other.syncNow();
    let started!: () => void;
    const pullStarted = new Promise<void>((r) => (started = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = Object.create(api) as FakeCloudApi;
    slow.pullEvents = async () => {
      started();
      await gate;
      return api.pullEvents();
    };
    const local = new MemoryEventStore();
    const store = new SyncingEventStore({ local, api: slow, schedule: () => {} });
    const pulled = store.pull();
    await pullStarted;
    await store.clear();
    release();
    expect(await pulled).toBe(0);
    expect(await local.readAll()).toEqual([]);
    expect(await local.getMeta(CLOUD_SYNCED_KEY)).toBeUndefined();
  });

  it('syncNow rethrows errors that are not CloudError', async () => {
    const { api } = await signedInApi();
    const buggy = Object.create(api) as FakeCloudApi;
    buggy.pushBatches = async () => {
      throw new TypeError('bug');
    };
    const store = new SyncingEventStore({ local: new MemoryEventStore(), api: buggy, schedule: () => {} });
    await store.append(range('s', 0, 1));
    await expect(store.syncNow()).rejects.toBeInstanceOf(TypeError);
    expect(await store.pendingCount()).toBe(2);

    const local = new MemoryEventStore();
    local.readAll = async () => {
      throw new Error('storage broken');
    };
    const broken = new SyncingEventStore({ local, api, schedule: () => {} });
    await expect(broken.syncNow()).rejects.toThrow('storage broken');
    // The queue survives a rejected task.
    const ok = new SyncingEventStore({ local: new MemoryEventStore(), api, schedule: () => {} });
    await expect(store.syncNow()).rejects.toBeInstanceOf(TypeError);
    expect(await ok.syncNow()).toEqual({ sent: 0, failed: false });
  });
});
