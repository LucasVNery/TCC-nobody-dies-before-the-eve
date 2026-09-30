import { describe, it, expect } from 'vitest';
import { toNdjson, parseNdjson, importInto } from './ndjson';
import { MemoryEventStore } from './eventStore';
import type { LoggedEvent } from './schema';

function ev(session_id: string, seq: number, player_id = 'p', extra: Record<string, unknown> = {}): LoggedEvent {
  return { v: 2, seq, t_ms: seq, player_id, session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type: 'x', ...extra };
}

describe('ndjson', () => {
  it('round-trips events through text without loss', () => {
    const events = [ev('a', 0, 'p', { ctx: { dist: 12.3, aim: [0.707, -0.707] } }), ev('a', 1)];
    const text = toNdjson(events);
    expect(text.split('\n').filter(Boolean)).toHaveLength(2);
    expect(parseNdjson(text)).toEqual({ events, invalidLines: 0 });
  });

  it('skips and counts invalid lines, ignores blank lines and CRLF', () => {
    const good = JSON.stringify(ev('a', 0));
    const text = [good, '', 'not json', JSON.stringify({ ...ev('a', 1), v: 1 }), JSON.stringify({ type: 'x' }), good].join('\r\n');
    const result = parseNdjson(text);
    expect(result.invalidLines).toBe(3);
    expect(result.events).toHaveLength(2);
  });

  it('importing into a store merges, dedupes by (session_id, seq) and adopts the file player_id', async () => {
    const store = new MemoryEventStore();
    await store.append([ev('local', 0, 'old-id')]);
    await store.setMeta('player_id', 'old-id');
    const text = toNdjson([ev('remote', 0, 'imported-id'), ev('remote', 1, 'imported-id')]);

    const first = await importInto(store, text);
    const second = await importInto(store, text);

    expect(first).toEqual({ imported: 2, invalidLines: 0, playerId: 'imported-id' });
    expect(second.imported).toBe(2);
    expect((await store.readAll()).map((e) => `${e.session_id}#${e.seq}`).sort()).toEqual(['local#0', 'remote#0', 'remote#1']);
    expect(await store.getMeta('player_id')).toBe('imported-id');
  });

  it('importing an empty or all-invalid file changes nothing', async () => {
    const store = new MemoryEventStore();
    await store.setMeta('player_id', 'keep');
    expect(await importInto(store, 'garbage\n')).toEqual({ imported: 0, invalidLines: 1, playerId: undefined });
    expect(await store.getMeta('player_id')).toBe('keep');
  });
});
