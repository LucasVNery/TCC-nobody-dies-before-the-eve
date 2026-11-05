import { describe, it, expect } from 'vitest';
import { buildBatches, MAX_BATCH_EVENTS } from './batching';
import type { LoggedEvent } from '../telemetry/schema';

function ev(session_id: string, seq: number): LoggedEvent {
  return { v: 2, seq, t_ms: seq, player_id: 'p', session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type: 'x' };
}
const range = (s: string, from: number, to: number): LoggedEvent[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ev(s, from + i));

describe('buildBatches', () => {
  it('uses the measured batch size by default', () => {
    expect(MAX_BATCH_EVENTS).toBe(500);
    const batches = buildBatches(range('s', 0, 1200), {});
    expect(batches.map((b) => b.events.length)).toEqual([500, 500, 201]);
  });

  it('respects the limit and leaves no seq holes between blocks', () => {
    const batches = buildBatches(range('s', 0, 9), {}, 4);
    expect(batches.map((b) => [b.firstSeq, b.lastSeq])).toEqual([[0, 3], [4, 7], [8, 9]]);
    for (const b of batches) {
      expect(b.events.map((e) => e.seq)).toEqual(range('s', b.firstSeq, b.lastSeq).map((e) => e.seq));
    }
  });

  it('orders by seq whatever the input order', () => {
    const batches = buildBatches([ev('s', 2), ev('s', 0), ev('s', 1)], {}, 10);
    expect(batches[0].events.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('skips what was already sent and starts right after it', () => {
    const batches = buildBatches(range('s', 0, 9), { s: 5 }, 3);
    expect(batches.map((b) => [b.firstSeq, b.lastSeq])).toEqual([[6, 8], [9, 9]]);
  });

  it('separates sessions', () => {
    const batches = buildBatches([...range('a', 0, 2), ...range('b', 0, 1)], { b: 0 }, 10);
    expect(batches.map((b) => [b.sessionId, b.firstSeq, b.lastSeq, b.events.length])).toEqual([
      ['a', 0, 2, 3],
      ['b', 1, 1, 1],
    ]);
    for (const b of batches) expect(b.events.every((e) => e.session_id === b.sessionId)).toBe(true);
  });

  it('keeps the same keys when more events arrive, only the last block grows', () => {
    const before = buildBatches(range('s', 0, 5), { s: 1 }, 3);
    const after = buildBatches(range('s', 0, 7), { s: 1 }, 3);
    expect(before.map((b) => [b.firstSeq, b.lastSeq])).toEqual([[2, 4], [5, 5]]);
    expect(after.map((b) => [b.firstSeq, b.lastSeq])).toEqual([[2, 4], [5, 7]]);
  });

  it('returns nothing when nothing is missing', () => {
    expect(buildBatches([], {})).toEqual([]);
    expect(buildBatches(range('s', 0, 4), { s: 4 })).toEqual([]);
  });

  it('rejects a non-positive limit', () => {
    expect(() => buildBatches(range('s', 0, 1), {}, 0)).toThrow();
  });
});
