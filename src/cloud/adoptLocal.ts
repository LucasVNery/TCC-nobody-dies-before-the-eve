// The pre-login history: events the browser logged in the global `tcc-telemetry` database before
// accounts existed. That database is never synced, never written and never deleted here; adopting
// copies the local player's events into the account's own store (with the account's player_id).
import type { EventStore } from '../telemetry/eventStore';
import { isLoggedEvent } from '../telemetry/ndjson';
import { orderEvents } from '../telemetry/replay';
import type { LoggedEvent } from '../telemetry/schema';

/** The global database of the game before accounts (same name and layout as IndexedDbEventStore's default). */
export const LEGACY_DB_NAME = 'tcc-telemetry';
const EVENTS = 'events';
const META = 'meta';

/** Account meta key holding the player's answer to the import offer. */
export const LEGACY_IMPORT_KEY = 'legacy_import';
export type LegacyImportAnswer = 'imported' | 'discarded';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Opens the legacy database for reading only. Resolves null when it does not exist: opening a missing
 * database creates it, so the upgrade is aborted (which discards it) and nothing is left behind.
 */
async function openExisting(factory: IDBFactory): Promise<IDBDatabase | null> {
  if (typeof factory.databases === 'function') {
    try {
      const all = await factory.databases();
      if (!all.some((d) => d.name === LEGACY_DB_NAME)) return null;
    } catch {
      // Not usable here: the aborted-upgrade check below still protects.
    }
  }
  return new Promise<IDBDatabase | null>((resolve, reject) => {
    let created = false;
    let gaveUp = false;
    const req = factory.open(LEGACY_DB_NAME);
    req.onupgradeneeded = () => {
      created = true;
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      if (gaveUp) req.result.close(); // opened after we gave up: do not leak the connection
      else if (created) {
        req.result.close();
        resolve(null);
      } else resolve(req.result);
    };
    req.onerror = () => {
      if (created) resolve(null);
      else reject(req.error);
    };
    req.onblocked = () => {
      gaveUp = true;
      reject(new Error(`IndexedDB "${LEGACY_DB_NAME}" open blocked by another connection`));
    };
  });
}

/**
 * The legacy history of the browser's local player (the events whose player_id is the database's
 * meta.player_id), oldest first. Read only; [] when there is no legacy database, no local player or no events.
 */
export async function readLocalGuestHistory(factory: IDBFactory = indexedDB): Promise<LoggedEvent[]> {
  const db = await openExisting(factory);
  if (!db) return [];
  try {
    if (!db.objectStoreNames.contains(EVENTS) || !db.objectStoreNames.contains(META)) return [];
    const tx = db.transaction([EVENTS, META], 'readonly');
    const playerId = (await request(tx.objectStore(META).get('player_id'))) as unknown;
    if (typeof playerId !== 'string') return [];
    const all = (await request(tx.objectStore(EVENTS).getAll())) as unknown[];
    return orderEvents(all.filter(isLoggedEvent).filter((e) => e.player_id === playerId));
  } finally {
    db.close();
  }
}

/**
 * Appends copies of `events` to `target` with player_id set to the account's id; the (session_id, seq)
 * keys do not change, so importing twice overwrites instead of duplicating. The inputs are not modified.
 * Returns how many events were written.
 */
export async function adoptHistory(events: readonly LoggedEvent[], userId: string, target: EventStore): Promise<number> {
  if (events.length === 0) return 0;
  await target.append(events.map((e) => ({ ...e, player_id: userId })));
  return events.length;
}

/** Per-browser marker, outside every IndexedDB: the legacy history is offered to (and taken by) one account only. */
export const LEGACY_MARKER_KEY = 'tcc-legacy-import';
export interface MarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface LegacyMarker {
  by: string;
  answer: LegacyImportAnswer;
}

function defaultStorage(): MarkerStorage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/** The marker, or null when absent, malformed or the storage is unavailable. */
export function readLegacyMarker(storage: MarkerStorage | undefined = defaultStorage()): LegacyMarker | null {
  try {
    const raw = storage?.getItem(LEGACY_MARKER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LegacyMarker>;
    if (typeof v.by !== 'string' || (v.answer !== 'imported' && v.answer !== 'discarded')) return null;
    return { by: v.by, answer: v.answer };
  } catch {
    return null;
  }
}

/** Records who answered the offer (user id and answer only); false when it could not be stored. */
export function writeLegacyMarker(by: string, answer: LegacyImportAnswer, storage: MarkerStorage | undefined = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(LEGACY_MARKER_KEY, JSON.stringify({ by, answer }));
    return true;
  } catch {
    return false;
  }
}
