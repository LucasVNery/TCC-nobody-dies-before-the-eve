import { SCHEMA_VERSION, type LoggedEvent } from './schema';
import type { EventStore } from './eventStore';
import { orderEvents } from './replay';

/** One JSON object per line, trailing newline. */
export function toNdjson(events: readonly LoggedEvent[]): string {
  return events.length === 0 ? '' : events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

export function isLoggedEvent(x: unknown): x is LoggedEvent {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    e.v === SCHEMA_VERSION &&
    Number.isInteger(e.seq) && (e.seq as number) >= 0 &&
    typeof e.t_ms === 'number' &&
    typeof e.player_id === 'string' &&
    typeof e.session_id === 'string' &&
    typeof e.run_idx === 'number' &&
    typeof e.room_idx === 'number' &&
    typeof e.enc_idx === 'number' &&
    typeof e.type === 'string'
  );
}

export function parseNdjson(text: string): { events: LoggedEvent[]; invalidLines: number } {
  const events: LoggedEvent[] = [];
  let invalidLines = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isLoggedEvent(parsed)) events.push(parsed);
      else invalidLines += 1;
    } catch {
      invalidLines += 1;
    }
  }
  return { events, invalidLines };
}

export interface ImportResult {
  imported: number;
  invalidLines: number;
  /** player_id adopted from the file (undefined when nothing was imported). */
  playerId: string | undefined;
  /**
   * player_ids in the file that differ from the store's previous player_id
   * (empty when the store had none). Their events stay in the store, but only
   * the adopted player's are replayed.
   */
  foreignPlayerIds: string[];
}

/**
 * Merges an exported history into `store` (idempotent: the store keys events
 * by (session_id, seq)) and adopts the player_id of the file's most recent
 * event, so the rebuilt profile is the imported player's.
 */
export async function importInto(store: EventStore, text: string): Promise<ImportResult> {
  const { events, invalidLines } = parseNdjson(text);
  if (events.length === 0) return { imported: 0, invalidLines, playerId: undefined, foreignPlayerIds: [] };
  const previous = await store.getMeta<string>('player_id');
  const foreignPlayerIds =
    previous === undefined ? [] : [...new Set(events.map((e) => e.player_id))].filter((id) => id !== previous);
  await store.append(events);
  const ordered = orderEvents(events);
  const playerId = ordered[ordered.length - 1].player_id;
  await store.setMeta('player_id', playerId);
  return { imported: events.length, invalidLines, playerId, foreignPlayerIds };
}
