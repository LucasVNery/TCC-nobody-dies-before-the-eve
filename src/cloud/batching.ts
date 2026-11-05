import type { LoggedEvent } from '../telemetry/schema';
import type { EventBatch } from './cloudApi';

/** About 145 KB of NDJSON per batch (docs/supabase-volume.md). */
export const MAX_BATCH_EVENTS = 500;

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
