// src/scenes/session/browserPlatform.ts
import { IndexedDbEventStore } from '../../telemetry/eventStore';
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

export function createBrowserPlatform(): Platform {
  return {
    newUuid,
    nowIso: () => new Date().toISOString(),
    openStore: async () => ({ store: await IndexedDbEventStore.open(), persistent: true }),
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
