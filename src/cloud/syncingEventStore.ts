import type { EventStore } from '../telemetry/eventStore';
import type { LoggedEvent } from '../telemetry/schema';
import { CloudError, type CloudApi } from './cloudApi';
import { buildBatches, MAX_BATCH_EVENTS } from './batching';

/** Meta key: session_id -> last seq the cloud has confirmed. */
export const CLOUD_SYNCED_KEY = 'cloud_synced';

type Progress = Record<string, number>;

const SYNC_DELAY_MS = 2000;
const defaultSchedule = (run: () => void): void => {
  setTimeout(run, SYNC_DELAY_MS);
};

/**
 * Local-first EventStore: every write lands in the local store first, and a background
 * sync pushes what the cloud does not have yet. The network never blocks or loses a
 * local event; progress only advances after the cloud confirms a push.
 */
export class SyncingEventStore implements EventStore {
  private readonly local: EventStore;
  private readonly api: CloudApi;
  private readonly schedule: (run: () => void) => void;
  private readonly maxBatch: number;
  private scheduled = false;
  /** Bumped by clear(), so a sync in flight across a clear does not write stale progress. */
  private generation = 0;
  /** Syncs and pulls run one at a time, so progress is never read and written by two at once. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: { local: EventStore; api: CloudApi; schedule?: (run: () => void) => void; maxBatch?: number }) {
    this.local = opts.local;
    this.api = opts.api;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.maxBatch = opts.maxBatch ?? MAX_BATCH_EVENTS;
  }

  async append(events: readonly LoggedEvent[]): Promise<void> {
    await this.local.append(events);
    if (events.length > 0) this.requestSync();
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
   * in the cleared store.
   */
  clear(): Promise<void> {
    this.generation++;
    return this.local.clear();
  }

  close(): void {
    this.local.close();
  }

  /**
   * Pushes everything not yet confirmed. A cloud failure (CloudError) resolves to
   * `failed: true` and leaves progress where it was; any other error is a bug or a
   * local-storage failure and is rethrown.
   */
  syncNow(): Promise<{ sent: number; failed: boolean }> {
    return this.enqueue(async () => {
      try {
        const gen = this.generation;
        const progress = await this.progress();
        const batches = buildBatches(await this.local.readAll(), progress, this.maxBatch);
        if (batches.length === 0) return { sent: 0, failed: false };
        await this.api.pushBatches(batches);
        const next = { ...(await this.progress()) };
        let sent = 0;
        for (const b of batches) {
          next[b.sessionId] = Math.max(next[b.sessionId] ?? -1, b.lastSeq);
          sent += b.events.length;
        }
        if (gen !== this.generation) return { sent: 0, failed: false };
        await this.local.setMeta(CLOUD_SYNCED_KEY, next);
        return { sent, failed: false };
      } catch (err) {
        if (err instanceof CloudError) return { sent: 0, failed: true };
        throw err;
      }
    });
  }

  /**
   * Brings in the cloud's events the local store lacks; returns how many were new.
   * Pulled events are marked as synced, so they are never pushed back (for an admin,
   * they include other users' events, which must not land in the admin's account).
   * Progress is written before the events: it only holds seqs the server confirmed, and
   * if the append is then lost the next pull re-appends them (they are still missing
   * locally). The other order could leave pulled events pending and push them back.
   * Errors propagate; nothing local is removed.
   */
  pull(): Promise<number> {
    return this.enqueue(async () => {
      const gen = this.generation;
      const remote = await this.api.pullEvents();
      const progress = await this.progress();
      const next = { ...progress };
      for (const e of remote) next[e.session_id] = Math.max(next[e.session_id] ?? -1, e.seq);
      if (Object.keys(next).some((k) => next[k] !== progress[k])) {
        if (gen !== this.generation) return 0;
        await this.local.setMeta(CLOUD_SYNCED_KEY, next);
      }
      const have = new Set((await this.local.readAll()).map((e) => `${e.session_id}#${e.seq}`));
      const fresh = remote.filter((e) => !have.has(`${e.session_id}#${e.seq}`));
      if (fresh.length === 0) return 0;
      if (gen !== this.generation) return 0;
      await this.local.append(fresh);
      return new Set(fresh.map((e) => `${e.session_id}#${e.seq}`)).size;
    });
  }

  /** Local events the cloud has not confirmed yet. */
  async pendingCount(): Promise<number> {
    const progress = await this.progress();
    return (await this.local.readAll()).filter((e) => e.seq > (progress[e.session_id] ?? -1)).length;
  }

  /** One scheduled sync per burst of appends. */
  private requestSync(): void {
    if (this.scheduled) return;
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
