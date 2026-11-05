import { IndexedDbEventStore, type EventStore } from '../telemetry/eventStore';
import type { LoggedEvent } from '../telemetry/schema';
import { CloudError, type CloudApi, type EventBatch, type PullCursor, type PullPage } from './cloudApi';
import { accountDbName, type Account } from './account';
import { SyncingEventStore, SYNC_DELAY_MS, type SyncApi } from './syncingEventStore';

/** Longest the game waits for the account's history before starting on the local copy (what arrived by then is kept). */
export const PULL_TIMEOUT_MS = 5000;
/** Longest the game waits for the stored session to be restored before starting signed out. */
export const AUTH_TIMEOUT_MS = 5000;
/** Retry after a failed push: doubles from the first value up to the second. */
export const RETRY_MIN_MS = 2000;
export const RETRY_MAX_MS = 60000;

export interface SyncTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: SyncTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface CloudStoreDeps {
  factory: IDBFactory;
  timers?: SyncTimers;
  /** Subscribes to "the network is back" (the browser's `online` event); returns the unsubscribe function. */
  onOnline?: (listener: () => void) => () => void;
  pullTimeoutMs?: number;
}

const paused = (): CloudError => new CloudError('auth', 'account not signed in; sync paused');

/**
 * Per Account (one per page load): the signInToken whose pull finished. The history is pulled once
 * per sign-in per page load; every later store open (Análise, the next Arena) reuses it, unless that
 * pull did not finish (time limit, network), in which case the next open resumes it.
 */
const pullDone = new WeakMap<Account, number>();

/** The time limit of one pull: every page wait rejects once it is over, and late answers are dropped. */
interface PullGate {
  givenUp(): boolean;
  wait<T>(work: Promise<T>): Promise<T>;
}

/**
 * The account's local store with background sync. Every cloud call is bound to one user:
 * nothing is pushed or pulled while another user (or nobody) is signed in, and only events
 * whose player_id is that user ever leave the browser (pushed rows carry that user id). A failed
 * push is retried with growing delays, when the network comes back, and when the user is signed in
 * again. close() pushes once more before closing the database (the account waits for that on
 * sign-out and deletion). When the database is deleted from another tab, the store stops: no timer,
 * no push (its pending buffer would otherwise bring deleted events back).
 */
class AccountSyncStore implements EventStore {
  private readonly sync: SyncingEventStore;
  private readonly timers: SyncTimers;
  private closed = false;
  private syncTimer: unknown = null;
  private retryTimer: unknown = null;
  private retryMs = 0;
  private couldSync: boolean;
  private pullGate: PullGate | null = null;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    local: EventStore,
    private readonly api: CloudApi,
    private readonly userId: string,
    private readonly account: Account,
    private readonly deps: CloudStoreDeps,
  ) {
    this.timers = deps.timers ?? realTimers;
    this.sync = new SyncingEventStore({
      local,
      api: this.boundApi(),
      schedule: (run) => {
        if (this.closed) return;
        this.syncTimer = this.timers.set(() => {
          this.syncTimer = null;
          run();
        }, SYNC_DELAY_MS);
      },
    });
    this.couldSync = account.canSync(userId);
    this.unsubscribe.push(
      account.onChange(() => {
        const can = account.canSync(userId);
        if (can && !this.couldSync) this.kick(); // signed in again: send what piled up
        this.couldSync = can;
      }),
    );
    if (deps.onOnline) this.unsubscribe.push(deps.onOnline(() => this.kick()));
  }

  append(events: readonly LoggedEvent[]): Promise<void> {
    return this.sync.append(events);
  }

  readAll(): Promise<LoggedEvent[]> {
    return this.sync.readAll();
  }

  getMeta<T>(key: string): Promise<T | undefined> {
    return this.sync.getMeta<T>(key);
  }

  setMeta(key: string, value: unknown): Promise<void> {
    return this.sync.setMeta(key, value);
  }

  clear(): Promise<void> {
    return this.sync.clear();
  }

  close(): void {
    if (this.closed) return;
    this.stopTimersAndListeners();
    const last = this.sync
      .syncNow()
      .catch((err: unknown) => console.warn('[cloud] last sync before closing failed', err))
      .finally(() => this.sync.close());
    this.account.track(last);
  }

  /** The database was closed under us (deleted or upgraded from another tab): stop for good, push nothing more. */
  closedExternally(): void {
    this.sync.halt();
    if (this.closed) return;
    console.warn('[cloud] the account database was closed by another tab (data deleted?); this store stops syncing');
    this.stopTimersAndListeners();
  }

  /**
   * Never rejects: a failed or slow pull leaves the game on the local copy, with whatever pages
   * arrived before the time limit. Skipped when this sign-in already pulled to the end in this page load.
   */
  async pullBeforeStart(): Promise<void> {
    const token = this.account.signInToken;
    if (pullDone.get(this.account) === token) return;
    const ms = this.deps.pullTimeoutMs ?? PULL_TIMEOUT_MS;
    let givenUp = false;
    let abort: ((err: Error) => void) | null = null;
    const timeoutError = (): CloudError => new CloudError('network', `pull timed out after ${ms} ms`);
    const timer = this.timers.set(() => {
      givenUp = true;
      abort?.(timeoutError());
    }, ms);
    this.pullGate = {
      givenUp: () => givenUp,
      wait: <T>(work: Promise<T>) =>
        new Promise<T>((resolve, reject) => {
          if (givenUp) return reject(timeoutError());
          abort = reject;
          work.then(resolve, reject);
        }),
    };
    try {
      await this.sync.pull();
      if (this.account.signInToken === token) pullDone.set(this.account, token);
    } catch (err) {
      console.warn('[cloud] could not download the whole account history; starting on the local copy (the next start continues it)', err);
    } finally {
      this.timers.clear(timer);
      this.pullGate = null;
    }
  }

  /** Starts a push now, unless closed or the account is not ours right now. */
  kick(): void {
    if (this.closed || !this.account.canSync(this.userId)) return;
    if (this.retryTimer !== null) {
      this.timers.clear(this.retryTimer);
      this.retryTimer = null;
    }
    this.sync.syncNow().catch((err: unknown) => console.error('[cloud] sync failed', err));
  }

  private stopTimersAndListeners(): void {
    this.closed = true;
    if (this.syncTimer !== null) this.timers.clear(this.syncTimer);
    if (this.retryTimer !== null) this.timers.clear(this.retryTimer);
    this.syncTimer = null;
    this.retryTimer = null;
    for (const off of this.unsubscribe.splice(0)) off();
  }

  private onPushFailed(): void {
    if (this.closed) return;
    this.retryMs = this.retryMs === 0 ? RETRY_MIN_MS : Math.min(this.retryMs * 2, RETRY_MAX_MS);
    if (this.retryTimer !== null) return;
    this.retryTimer = this.timers.set(() => {
      this.retryTimer = null;
      this.kick();
    }, this.retryMs);
  }

  private async assertOurs(): Promise<void> {
    if (!this.account.canSync(this.userId)) throw paused();
    // The client's own session, checked right before the call (no network on the real client).
    const current = await this.api.getUser();
    if (current?.id !== this.userId || !this.account.canSync(this.userId)) throw paused();
  }

  /** The push and pull the SyncingEventStore sees: restricted to this user. */
  private boundApi(): SyncApi {
    const api = this.api;
    const userId = this.userId;
    return {
      pushBatches: async (batches: readonly EventBatch[]) => {
        await this.assertOurs();
        // A session is one player's; a batch with anyone else's events never goes to this account
        // (the SyncingEventStore then counts it as done, so it is not retried either).
        const own = batches.filter((b) => b.events.every((e) => e.player_id === userId));
        try {
          if (own.length > 0) await api.pushBatches(own, userId);
        } catch (err) {
          this.onPushFailed();
          throw err;
        }
        this.retryMs = 0;
      },
      pullPage: (after: PullCursor | null): Promise<PullPage> => {
        // Each page (session check included) waits within the pull's time limit; past it the wait
        // rejects, so the SyncingEventStore stops there, and the late answer is dropped.
        const gate = this.pullGate;
        const work = (async () => {
          await this.assertOurs();
          if (gate?.givenUp()) throw new CloudError('network', 'pull given up after the time limit');
          const page = await api.pullPage(after);
          return { events: page.events.filter((e) => e.player_id === userId), next: page.next };
        })();
        return gate ? gate.wait(work) : work;
      },
    };
  }
}

/** Settles like `work`, or rejects with onTimeout() after `ms`; the timer is always cleared. */
function withTimeout<T>(work: Promise<T>, ms: number, timers: SyncTimers, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = timers.set(() => reject(onTimeout()), ms);
    work.then(
      (value) => {
        timers.clear(timer);
        resolve(value);
      },
      (err: unknown) => {
        timers.clear(timer);
        reject(err);
      },
    );
  });
}

/**
 * Opens the signed-in account's own database (`tcc-telemetry-<user_id>`), with the order the
 * game relies on: open → meta.player_id = user id → pull (once per sign-in per page load,
 * time-limited, partial progress kept, failure tolerated) → background push of what is pending.
 * loadProfileState then rebuilds the profile from it.
 * Resolves null when there is no signed-in user, or the session restore takes longer than
 * AUTH_TIMEOUT_MS (in cloud mode the caller then uses an in-memory store, never the pre-login one);
 * rejects only when the database cannot be opened.
 */
export async function openAccountStore(account: Account, deps: CloudStoreDeps): Promise<{ store: EventStore; persistent: boolean } | null> {
  try {
    // Bounded: a slow session restore starts the game signed out;
    // the Account keeps restoring in the background and its auth listener catches up.
    await withTimeout(account.init(), AUTH_TIMEOUT_MS, deps.timers ?? realTimers, () => new Error('session restore timed out'));
  } catch (err) {
    console.warn('[cloud] the session was not restored in time; starting signed out', err);
    return null;
  }
  const api = account.cloud;
  const user = account.state.user;
  if (!api || !user) return null;
  let store: AccountSyncStore | null = null;
  let closedEarly = false;
  const local = await IndexedDbEventStore.open(deps.factory, accountDbName(user.id), {
    onVersionChange: () => {
      if (store) store.closedExternally();
      else closedEarly = true;
    },
  });
  try {
    await local.setMeta('player_id', user.id);
  } catch (err) {
    local.close();
    throw err;
  }
  store = new AccountSyncStore(local, api, user.id, account, deps);
  if (closedEarly) store.closedExternally();
  await store.pullBeforeStart();
  store.kick();
  return { store, persistent: true };
}
