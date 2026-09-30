// src/telemetry/eventStore.ts
import type { LoggedEvent } from './schema';
import { orderEvents } from './replay';

/**
 * Where the event log lives. The game never depends on a concrete store, so a
 * server-backed implementation can be added later without touching it.
 * Events are keyed by (session_id, seq): re-appending an event overwrites it,
 * which makes imports idempotent.
 */
export interface EventStore {
  append(events: readonly LoggedEvent[]): Promise<void>;
  /** All events, chronologically ordered (see orderEvents). */
  readAll(): Promise<LoggedEvent[]>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

const keyOf = (e: LoggedEvent): string => `${e.session_id}#${e.seq}`;

/** Fallback when IndexedDB is unavailable (private window), and for tests. */
export class MemoryEventStore implements EventStore {
  private events = new Map<string, LoggedEvent>();
  private meta = new Map<string, unknown>();

  async append(events: readonly LoggedEvent[]): Promise<void> {
    for (const e of events) this.events.set(keyOf(e), e);
  }

  async readAll(): Promise<LoggedEvent[]> {
    return orderEvents([...this.events.values()]);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.meta.get(key) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, value);
  }

  async clear(): Promise<void> {
    this.events.clear();
    this.meta.clear();
  }

  close(): void {}
}

const DB_NAME = 'tcc-telemetry';
const DB_VERSION = 1;
const EVENTS = 'events';
const META = 'meta';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IndexedDbEventStore implements EventStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, name: string = DB_NAME): Promise<IndexedDbEventStore> {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(EVENTS, { keyPath: ['session_id', 'seq'] });
      db.createObjectStore(META);
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      let gaveUp = false;
      req.onsuccess = () => {
        // Opened after we gave up on it: don't leak the connection.
        if (gaveUp) req.result.close();
        else resolve(req.result);
      };
      req.onerror = () => reject(req.error);
      // Another tab holds an older-version connection open: reject instead of
      // hanging, so boot falls back to the in-memory store.
      req.onblocked = () => {
        gaveUp = true;
        reject(new Error(`IndexedDB "${name}" open blocked by another connection`));
      };
    });
    return new IndexedDbEventStore(db);
  }

  async append(events: readonly LoggedEvent[]): Promise<void> {
    if (events.length === 0) return;
    const tx = this.db.transaction(EVENTS, 'readwrite');
    const store = tx.objectStore(EVENTS);
    for (const e of events) store.put(e);
    await done(tx);
  }

  async readAll(): Promise<LoggedEvent[]> {
    const tx = this.db.transaction(EVENTS, 'readonly');
    const all = (await request(tx.objectStore(EVENTS).getAll())) as LoggedEvent[];
    return orderEvents(all);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const tx = this.db.transaction(META, 'readonly');
    return (await request(tx.objectStore(META).get(key))) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(META, 'readwrite');
    tx.objectStore(META).put(value, key);
    await done(tx);
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction([EVENTS, META], 'readwrite');
    tx.objectStore(EVENTS).clear();
    tx.objectStore(META).clear();
    await done(tx);
  }

  close(): void {
    this.db.close();
  }
}
