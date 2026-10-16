// src/scenes/session/platform.ts
import type { EventStore } from '../../telemetry/eventStore';

/** Everything the session controller needs from the outside world (browser APIs live behind this). */
export interface Platform {
  newUuid(): string;
  nowIso(): string;
  /** Opens the event store; rejects when persistent storage is unavailable. */
  openStore(): Promise<{ store: EventStore; persistent: boolean }>;
  downloadText(filename: string, text: string): void;
  /** Lets the user pick a history file; resolves with its text, or null when cancelled. */
  pickFile(): Promise<string | null>;
  /** Calls `listener` when the page is being hidden or left. Returns the unsubscribe function. */
  onHide(listener: () => void): () => void;
}
