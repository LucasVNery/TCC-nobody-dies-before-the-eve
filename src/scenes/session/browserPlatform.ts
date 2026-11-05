// src/scenes/session/browserPlatform.ts
import { IndexedDbEventStore, MemoryEventStore, type EventStore } from '../../telemetry/eventStore';
import type { Account } from '../../cloud/account';
import { openAccountStore, type CloudStoreDeps } from '../../cloud/syncBoot';
import type { Platform } from './platform';

/**
 * UUID v4. `crypto.randomUUID` only exists in secure contexts (https or
 * localhost); lab machines may open the game over plain HTTP on a LAN IP, so
 * fall back to one built from `crypto.getRandomValues` (available everywhere).
 */
function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  // Firefox only follows a click on an anchor that is in the document, and
  // the URL must outlive the click's navigation task.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ndjson,.jsonl,.txt';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) resolve(null);
      else file.text().then(resolve, () => resolve(null));
    };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function browserSyncDeps(): CloudStoreDeps {
  return {
    factory: indexedDB,
    onOnline(listener) {
      window.addEventListener('online', listener);
      return () => window.removeEventListener('online', listener);
    },
  };
}

/** The signed-in account's own synced store, or null when nobody is signed in (never the pre-login database). */
export function openBrowserAccountStore(account: Account): Promise<{ store: EventStore; persistent: boolean } | null> {
  return openAccountStore(account, browserSyncDeps());
}

/**
 * Shown in the Arena when a cloud-mode run is in memory only: no signed-in account at that moment
 * (see openCloudStore) or the account's database could not be opened. Neutral on purpose (either case).
 */
export const UNSAVED_RUN_NOTICE = 'Esta partida não está sendo salva neste navegador. Esc volta ao menu.';

/**
 * Cloud mode: the signed-in account's own synced database. Without one (nobody signed in at that
 * moment, or the session restore timed out) the run goes to an in-memory store (persistent: false,
 * its events are lost when the run ends) and NEVER to the pre-login `tcc-telemetry` database: that
 * one is not the account's, and writing a cloud-mode run into it would mix the two histories.
 */
export async function openCloudStore(account: Account, deps: CloudStoreDeps): Promise<{ store: EventStore; persistent: boolean }> {
  const opened = await openAccountStore(account, deps);
  if (opened) return opened;
  console.warn('[cloud] no signed-in account: this run is kept in memory only and will not be saved');
  return { store: new MemoryEventStore(), persistent: false };
}

/**
 * Local mode (no account, or no credentials): the store is the local `tcc-telemetry` database, as
 * before accounts existed. Cloud mode: see openCloudStore.
 */
export function createBrowserPlatform(account?: Account): Platform {
  const openLocal = async () => ({ store: await IndexedDbEventStore.open(), persistent: true });
  return {
    newUuid,
    nowIso: () => new Date().toISOString(),
    openStore: account?.mode === 'cloud' ? () => openCloudStore(account, browserSyncDeps()) : openLocal,
    downloadText,
    pickFile,
    onHide(listener) {
      const onVisibility = (): void => {
        if (document.visibilityState === 'hidden') listener();
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', listener);
      return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', listener);
      };
    },
  };
}
