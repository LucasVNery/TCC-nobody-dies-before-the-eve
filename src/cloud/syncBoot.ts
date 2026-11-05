import { IndexedDbEventStore, type EventStore } from '../telemetry/eventStore';
import type { LoggedEvent } from '../telemetry/schema';
import { CloudError, type CloudApi, type EventBatch } from './cloudApi';
import { accountDbName, type Account } from './account';
import { SyncingEventStore, SYNC_DELAY_MS } from './syncingEventStore';

/** Longest the game waits for the account's history before starting on the local copy. */
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
 * The account's local store with background sync. Every cloud call is bound to one user:
 * nothing is pushed or pulled while another user (or nobody) is signed in, and only events
 * whose player_id is that user ever leave the browser. A failed push is retried with growing
 * delays, when the network comes back, and when the user is signed in again. close() pushes
 * once more before closing the database (the account waits for that on sign-out and deletion).
 */
class AccountSyncStore implements EventStore {
  private readonly sync: SyncingEventStore;
  private readonly timers: SyncTimers;
  private closed = false;
  private syncTimer: unknown = null;
  private retryTimer: unknown = null;
  private retryMs = 0;
  private couldSync: boolean;
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
    this.closed = true;
    this.cancelTimers();
    for (const off of this.unsubscribe.splice(0)) off();
    const last = this.sync
      .syncNow()
      .catch((err: unknown) => console.warn('[cloud] last sync before closing failed', err))
      .finally(() => this.sync.close());
    this.account.track(last);
  }

  /** Never rejects: a failed or slow pull leaves the game on the local copy. */
  async pullBeforeStart(): Promise<void> {
    try {
      await this.sync.pull();
    } catch (err) {
      console.warn('[cloud] could not download the account history; starting on the local copy', err);
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

  private onPushFailed(): void {
    if (this.closed) return;
    this.retryMs = this.retryMs === 0 ? RETRY_MIN_MS : Math.min(this.retryMs * 2, RETRY_MAX_MS);
    if (this.retryTimer !== null) return;
    this.retryTimer = this.timers.set(() => {
      this.retryTimer = null;
      this.kick();
    }, this.retryMs);
  }

  private cancelTimers(): void {
    if (this.syncTimer !== null) this.timers.clear(this.syncTimer);
    if (this.retryTimer !== null) this.timers.clear(this.retryTimer);
    this.syncTimer = null;
    this.retryTimer = null;
  }

  private async assertOurs(): Promise<void> {
    if (!this.account.canSync(this.userId)) throw paused();
    // The client's own session, checked right before the call (no network on the real client).
    const current = await this.api.getUser();
    if (current?.id !== this.userId || !this.account.canSync(this.userId)) throw paused();
  }

  /** The CloudApi the SyncingEventStore sees: push and pull restricted to this user. */
  private boundApi(): CloudApi {
    const api = this.api;
    const userId = this.userId;
    return {
      getUser: () => api.getUser(),
      signUp: (e, p) => api.signUp(e, p),
      signIn: (e, p) => api.signIn(e, p),
      signOut: () => api.signOut(),
      resetPassword: (e) => api.resetPassword(e),
      updatePassword: (p) => api.updatePassword(p),
      isAdmin: () => api.isAdmin(),
      acceptedTermsVersion: () => api.acceptedTermsVersion(),
      acceptTerms: (v) => api.acceptTerms(v),
      deleteMyData: () => api.deleteMyData(),
      onAuthChange: (l) => api.onAuthChange(l),
      pushBatches: async (batches: readonly EventBatch[]) => {
        await this.assertOurs();
        // A session is one player's; a batch with anyone else's events never goes to this account
        // (the SyncingEventStore then counts it as done, so it is not retried either).
        const own = batches.filter((b) => b.events.every((e) => e.player_id === userId));
        try {
          if (own.length > 0) await api.pushBatches(own);
        } catch (err) {
          this.onPushFailed();
          throw err;
        }
        this.retryMs = 0;
      },
      pullEvents: () => {
        // The whole pull (session check included) is time-limited. On timeout it rejects, so the
        // SyncingEventStore writes nothing; the late answer is dropped once the game may have started.
        let givenUp = false;
        const work = (async () => {
          await this.assertOurs();
          if (givenUp) throw new CloudError('network', 'pull given up after the time limit');
          const events = await api.pullEvents();
          if (givenUp) throw new CloudError('network', 'pull answered after the time limit');
          return events.filter((e) => e.player_id === userId);
        })();
        const ms = this.deps.pullTimeoutMs ?? PULL_TIMEOUT_MS;
        return withTimeout(work, ms, this.timers, () => {
          givenUp = true;
          return new CloudError('network', `pull timed out after ${ms} ms`);
        });
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
 * game relies on: open → meta.player_id = user id → pull (time-limited, failure tolerated) →
 * background push of what is pending. loadProfileState then rebuilds the profile from it.
 * Resolves null when there is no signed-in user, or the session restore takes longer than
 * AUTH_TIMEOUT_MS (the caller then uses the local store);
 * rejects only when the database cannot be opened.
 */
export async function openAccountStore(account: Account, deps: CloudStoreDeps): Promise<{ store: EventStore; persistent: boolean } | null> {
  try {
    // Bounded: a slow session restore starts the game signed out (the caller's local store);
    // the Account keeps restoring in the background and its auth listener catches up.
    await withTimeout(account.init(), AUTH_TIMEOUT_MS, deps.timers ?? realTimers, () => new Error('session restore timed out'));
  } catch (err) {
    console.warn('[cloud] the session was not restored in time; starting signed out', err);
    return null;
  }
  const api = account.cloud;
  const user = account.state.user;
  if (!api || !user) return null;
  const local = await IndexedDbEventStore.open(deps.factory, accountDbName(user.id));
  try {
    await local.setMeta('player_id', user.id);
  } catch (err) {
    local.close();
    throw err;
  }
  const store = new AccountSyncStore(local, api, user.id, account, deps);
  await store.pullBeforeStart();
  store.kick();
  return { store, persistent: true };
}
