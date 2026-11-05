import type { EventStore } from '../telemetry/eventStore';
import type { LoggedEvent } from '../telemetry/schema';
import { CloudError, type CloudApi, type EventBatch, type PullCursor, type PullPage } from './cloudApi';
import { buildBatches, MAX_BATCH_EVENTS, MAX_BATCHES_PER_PUSH } from './batching';

/** Meta key: session_id -> last seq the cloud has confirmed. */
export const CLOUD_SYNCED_KEY = 'cloud_synced';
/** Meta key: where an unfinished pull resumes (the last row whose events are stored locally); null once a pull finished. */
export const CLOUD_PULL_CURSOR_KEY = 'cloud_pull_cursor';

type Progress = Record<string, number>;

/** What the store needs from the cloud: push and pull, already bound to one user. */
export interface SyncApi {
  pushBatches(batches: readonly EventBatch[]): Promise<void>;
  pullPage(after: PullCursor | null): Promise<PullPage>;
}

/** A CloudApi's push and pull for `userId` (pushed rows carry that user id). */
export function syncApiFor(api: CloudApi, userId: string): SyncApi {
  return {
    pushBatches: (batches) => api.pushBatches(batches, userId),
    pullPage: (after) => api.pullPage(after),
  };
}

/** Delay between a burst of appends and its push. */
export const SYNC_DELAY_MS = 2000;
const defaultSchedule = (run: () => void): void => {
  setTimeout(run, SYNC_DELAY_MS);
};

const keyOf = (e: LoggedEvent): string => `${e.session_id}#${e.seq}`;

/**
 * Local-first EventStore: every write lands in the local store first, and a background
 * sync pushes what the cloud does not have yet. The network never blocks or loses a
 * local event; progress only advances after the cloud confirms a push.
 *
 * The events not yet confirmed are kept in memory (the pending buffer): filled by ONE scan of
 * the local store (on the first sync, pull or pendingCount), then by append(), and trimmed by
 * the progress after every confirmed push or pull. Steady-state syncs never read the whole store.
 */
export class SyncingEventStore implements EventStore {
  private readonly local: EventStore;
  private readonly api: SyncApi;
  private readonly schedule: (run: () => void) => void;
  private readonly maxBatch: number;
  private readonly maxBatchesPerPush: number;
  /** Batches per request now: halved after a refused request ('other'), back to the maximum after a success. */
  private batchesPerPush: number;
  private scheduled = false;
  private halted = false;
  /** Bumped by clear(), so a sync in flight across a clear does not write stale progress. */
  private generation = 0;
  /** Syncs and pulls run one at a time, so progress is never read and written by two at once. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Events possibly not confirmed yet, by `${session}#${seq}` (may hold confirmed ones until the next trim). */
  private pending = new Map<string, LoggedEvent>();
  private loaded = false;
  private loading: Promise<void> | null = null;

  constructor(opts: {
    local: EventStore;
    api: SyncApi;
    schedule?: (run: () => void) => void;
    maxBatch?: number;
    maxBatchesPerPush?: number;
  }) {
    this.local = opts.local;
    this.api = opts.api;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.maxBatch = opts.maxBatch ?? MAX_BATCH_EVENTS;
    this.maxBatchesPerPush = opts.maxBatchesPerPush ?? MAX_BATCHES_PER_PUSH;
    if (!Number.isInteger(this.maxBatchesPerPush) || this.maxBatchesPerPush < 1) {
      throw new Error(`maxBatchesPerPush must be a positive integer, got ${this.maxBatchesPerPush}`);
    }
    this.batchesPerPush = this.maxBatchesPerPush;
  }

  async append(events: readonly LoggedEvent[]): Promise<void> {
    const gen = this.generation;
    await this.local.append(events);
    if (events.length === 0) return;
    // A clear() that came in meanwhile wiped these from the local store (its transaction ran after ours).
    if (gen === this.generation) for (const e of events) this.pending.set(keyOf(e), e);
    this.requestSync();
  }

  readAll(): Promise<LoggedEvent[]> {
    return this.local.readAll();
  }

  getMeta<T>(key: string): Promise<T | undefined> {
    return this.local.getMeta<T>(key);
  }

  setMeta(key: string, value: unknown): Promise<void> {
    return this.local.setMeta(key, value);
  }

  /**
   * Not queued (a hanging push must not block it); instead the bumped generation is
   * re-checked right before every write a sync or pull makes, so nothing stale lands
   * in the cleared store. The pending buffer restarts empty (the store is empty).
   */
  clear(): Promise<void> {
    this.generation++;
    this.pending = new Map();
    this.loaded = true;
    return this.local.clear();
  }

  close(): void {
    this.local.close();
  }

  /** No push starts from now on (the local database was closed under us, e.g. deleted from another tab). */
  halt(): void {
    this.halted = true;
  }

  /**
   * Pushes everything not yet confirmed, at most maxBatchesPerPush batches per request, advancing
   * the progress after each confirmed request. A cloud failure (CloudError) stops there and resolves
   * to `failed: true` (what was confirmed before stays confirmed); a refused request ('other') also
   * halves the next requests, down to one batch. Any other error is a bug or a local-storage
   * failure and is rethrown.
   */
  syncNow(): Promise<{ sent: number; failed: boolean }> {
    return this.enqueue(async () => {
      const gen = this.generation;
      let sent = 0;
      try {
        await this.ensureLoaded();
        for (;;) {
          if (this.halted || gen !== this.generation) return { sent, failed: false };
          const progress = await this.progress();
          this.trim(progress);
          const batches = buildBatches([...this.pending.values()], progress, this.maxBatch);
          if (batches.length === 0) return { sent, failed: false };
          const chunk = batches.slice(0, this.batchesPerPush);
          await this.api.pushBatches(chunk);
          this.batchesPerPush = this.maxBatchesPerPush;
          const next = { ...(await this.progress()) };
          for (const b of chunk) next[b.sessionId] = Math.max(next[b.sessionId] ?? -1, b.lastSeq);
          if (gen !== this.generation) return { sent, failed: false };
          await this.local.setMeta(CLOUD_SYNCED_KEY, next);
          this.trim(next);
          for (const b of chunk) sent += b.events.length;
        }
      } catch (err) {
        if (err instanceof CloudError) {
          if (err.kind === 'other') {
            this.batchesPerPush = Math.max(1, Math.floor(this.batchesPerPush / 2));
            console.warn(`[cloud] the server refused a push; retrying later with at most ${this.batchesPerPush} batches per request`, err);
          }
          return { sent, failed: true };
        }
        throw err;
      }
    });
  }

  /**
   * Brings in the cloud's events the local store lacks, page by page; returns how many were new.
   * Each page is kept as soon as it arrives, so a pull cut short (time limit, network) keeps what it
   * fetched, and the next pull resumes after the last stored row (CLOUD_PULL_CURSOR_KEY).
   * Pulled events are marked as synced, so they are never pushed back (the server
   * returns the caller's own events only; this also guards against foreign ones leaking in).
   * Per page, progress is written before the events: it only holds seqs the server confirmed, and
   * if the append is then lost the next pull re-appends them (they are still missing
   * locally, and the cursor only moves after the append). The other order could leave pulled
   * events pending and push them back. Errors propagate; nothing local is removed.
   */
  pull(): Promise<number> {
    return this.enqueue(async () => {
      const gen = this.generation;
      const all = await this.local.readAll(); // one scan: what is held, and the pending buffer if not loaded yet
      if (gen !== this.generation) return 0;
      const have = new Set(all.map(keyOf));
      if (!this.loaded) {
        this.absorb(all, await this.progress());
        this.loaded = true;
      }
      let cursor = (await this.local.getMeta<PullCursor | null>(CLOUD_PULL_CURSOR_KEY)) ?? null;
      let added = 0;
      for (;;) {
        const page = await this.api.pullPage(cursor);
        if (gen !== this.generation) return added;
        const progress = await this.progress();
        const next = { ...progress };
        for (const e of page.events) next[e.session_id] = Math.max(next[e.session_id] ?? -1, e.seq);
        if (Object.keys(next).some((k) => next[k] !== progress[k])) {
          if (gen !== this.generation) return added;
          await this.local.setMeta(CLOUD_SYNCED_KEY, next);
          this.trim(next);
        }
        const fresh = page.events.filter((e) => !have.has(keyOf(e)));
        if (fresh.length > 0) {
          if (gen !== this.generation) return added;
          await this.local.append(fresh);
          const before = have.size;
          for (const e of fresh) have.add(keyOf(e));
          added += have.size - before;
        }
        if (gen !== this.generation) return added;
        await this.local.setMeta(CLOUD_PULL_CURSOR_KEY, page.next);
        if (!page.next) return added;
        cursor = page.next;
      }
    });
  }

  /** Local events the cloud has not confirmed yet. */
  async pendingCount(): Promise<number> {
    await this.ensureLoaded();
    const progress = await this.progress();
    let n = 0;
    for (const e of this.pending.values()) if (e.seq > (progress[e.session_id] ?? -1)) n++;
    return n;
  }

  /** One scan of the local store fills the pending buffer (merged with what append() added meanwhile). */
  private ensureLoaded(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (!this.loading) {
      const gen = this.generation;
      this.loading = (async () => {
        const progress = await this.progress();
        const all = await this.local.readAll();
        if (gen !== this.generation) return; // a clear() reset the buffer already
        this.absorb(all, progress);
        this.loaded = true;
      })().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  private absorb(events: readonly LoggedEvent[], progress: Progress): void {
    for (const e of events) if (e.seq > (progress[e.session_id] ?? -1)) this.pending.set(keyOf(e), e);
  }

  /** Drops the buffered events the progress covers. */
  private trim(progress: Progress): void {
    for (const [k, e] of this.pending) if (e.seq <= (progress[e.session_id] ?? -1)) this.pending.delete(k);
  }

  /** One scheduled sync per burst of appends. */
  private requestSync(): void {
    if (this.scheduled || this.halted) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      // Cloud failures resolve; only a local/programming error lands here.
      this.syncNow().catch((err: unknown) => console.error('cloud sync failed', err));
    });
  }

  private async progress(): Promise<Progress> {
    return (await this.local.getMeta<Progress>(CLOUD_SYNCED_KEY)) ?? {};
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
