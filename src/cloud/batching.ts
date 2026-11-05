import type { LoggedEvent } from '../telemetry/schema';
import type { EventBatch, PullCursor } from './cloudApi';

/** About 145 KB of NDJSON per batch (docs/supabase-volume.md). */
export const MAX_BATCH_EVENTS = 500;

/** Most batches (rows) sent in one push request; a longer backlog goes out in several requests. */
export const MAX_BATCHES_PER_PUSH = 20;

/**
 * Rows fetched per pull request. A row written by the 2 s background push holds about 30-60 events
 * (about 9-18 KiB), so a page is typically 1-2 MB; a page of full 500-event rows (after a long offline
 * stretch) is at most about 14.5 MB.
 */
export const PULL_PAGE_SIZE = 100;

/**
 * Per session, the events with seq above `syncedUpTo[session]`, in seq order, cut into
 * blocks of at most `maxBatch`. Blocks leave no holes: each one starts at the previous
 * block's lastSeq + 1 (the first at syncedUpTo + 1), so a resend from the same progress
 * reuses the same (sessionId, firstSeq) keys and only the last block can grow.
 */
export function buildBatches(
  events: readonly LoggedEvent[],
  syncedUpTo: Readonly<Record<string, number>>,
  maxBatch: number = MAX_BATCH_EVENTS,
): EventBatch[] {
  if (!Number.isInteger(maxBatch) || maxBatch < 1) throw new Error(`maxBatch must be a positive integer, got ${maxBatch}`);
  const bySession = new Map<string, LoggedEvent[]>();
  for (const e of events) {
    const done = syncedUpTo[e.session_id];
    if (done !== undefined && e.seq <= done) continue;
    let list = bySession.get(e.session_id);
    if (!list) bySession.set(e.session_id, (list = []));
    list.push(e);
  }
  const out: EventBatch[] = [];
  for (const [sessionId, list] of bySession) {
    list.sort((a, b) => a.seq - b.seq);
    const done = syncedUpTo[sessionId];
    let next = done !== undefined ? done + 1 : list[0].seq;
    for (let i = 0; i < list.length; i += maxBatch) {
      const chunk = list.slice(i, i + maxBatch);
      const lastSeq = chunk[chunk.length - 1].seq;
      out.push({ sessionId, firstSeq: next, lastSeq, events: chunk });
      next = lastSeq + 1;
    }
  }
  return out;
}

/**
 * Batches to events, ordered by (session, seq). Resent batches overlap, so an event
 * (session, seq) present in several keeps the copy from the batch with the highest lastSeq.
 */
export function flattenBatches(batches: readonly EventBatch[]): LoggedEvent[] {
  const best = new Map<string, { sessionId: string; lastSeq: number; event: LoggedEvent }>();
  for (const b of batches) {
    for (const event of b.events) {
      const key = `${b.sessionId}\u0000${event.seq}`;
      const cur = best.get(key);
      if (!cur || b.lastSeq > cur.lastSeq) best.set(key, { sessionId: b.sessionId, lastSeq: b.lastSeq, event });
    }
  }
  return [...best.values()]
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : a.event.seq - b.event.seq))
    .map((v) => v.event);
}

/** The pull order of rows: session_id, then first_seq. */
export function compareRowKey(a: PullCursor, b: PullCursor): number {
  if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
  return a.firstSeq - b.firstSeq;
}
