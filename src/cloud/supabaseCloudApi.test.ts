import { describe, it, expect, vi, afterEach } from 'vitest';
import { batchToRow, rowToBatch, flattenBatches, toCloudError, createSupabaseCloudApi, afterFilter } from './supabaseCloudApi';
import { CloudError, type EventBatch } from './cloudApi';
import type { LoggedEvent } from '../telemetry/schema';

function ev(session_id: string, seq: number, tag = 'x'): LoggedEvent {
  return { v: 2, seq, t_ms: seq, player_id: 'p', session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type: tag };
}
function batch(sessionId: string, firstSeq: number, lastSeq: number, tag = 'x'): EventBatch {
  const events: LoggedEvent[] = [];
  for (let s = firstSeq; s <= lastSeq; s++) events.push(ev(sessionId, s, tag));
  return { sessionId, firstSeq, lastSeq, events };
}

describe('batch <-> row', () => {
  it('round-trips and writes only client-writable columns, user_id included explicitly', () => {
    const b = batch('s1', 3, 5);
    const row = batchToRow(b, 'user-bound');
    expect(Object.keys(row).sort()).toEqual(['events', 'first_seq', 'last_seq', 'session_id', 'user_id']);
    expect(row.user_id).toBe('user-bound');
    expect(rowToBatch(row)).toEqual(b);
  });

  it('the pull cursor becomes a keyset filter on (session_id, first_seq), with the session quoted', () => {
    expect(afterFilter({ sessionId: 's-1', firstSeq: 40 })).toBe('session_id.gt."s-1",and(session_id.eq."s-1",first_seq.gt.40)');
    expect(afterFilter({ sessionId: 'a"b\\c', firstSeq: 0 })).toBe('session_id.gt."a\\"b\\\\c",and(session_id.eq."a\\"b\\\\c",first_seq.gt.0)');
    expect(() => afterFilter({ sessionId: 's', firstSeq: 1.5 })).toThrow();
  });
});

describe('flattenBatches', () => {
  it('orders by session then seq', () => {
    const out = flattenBatches([batch('b', 0, 1), batch('a', 2, 3), batch('a', 0, 1)]);
    expect(out.map((e) => `${e.session_id}${e.seq}`)).toEqual(['a0', 'a1', 'a2', 'a3', 'b0', 'b1']);
  });

  it('keeps one copy per (session, seq), from the batch with the highest lastSeq', () => {
    const out = flattenBatches([batch('s', 0, 2, 'old'), batch('s', 2, 4, 'new')]);
    expect(out.map((e) => [e.seq, e.type])).toEqual([[0, 'old'], [1, 'old'], [2, 'new'], [3, 'new'], [4, 'new']]);
  });

  it('is empty for no batches', () => {
    expect(flattenBatches([])).toEqual([]);
  });
});

describe('toCloudError', () => {
  it('passes a CloudError through', () => {
    const e = new CloudError('auth', 'x');
    expect(toCloudError(e)).toBe(e);
  });
  it('classifies fetch failures as network', () => {
    expect(toCloudError(new TypeError('Failed to fetch')).kind).toBe('network');
    expect(toCloudError({ name: 'AuthRetryableFetchError', message: 'm', status: 0 }).kind).toBe('network');
    expect(toCloudError({ message: 'TypeError: fetch failed', code: '' }).kind).toBe('network');
  });
  it('classifies 400/401/403 and auth codes as auth', () => {
    expect(toCloudError({ name: 'AuthApiError', message: 'Invalid login credentials', status: 400 }).kind).toBe('auth');
    expect(toCloudError({ message: 'm', status: 401 }).kind).toBe('auth');
    expect(toCloudError({ message: 'm', code: '42501' }, 403).kind).toBe('auth');
    expect(toCloudError({ message: 'm', code: '28000' }, 401).kind).toBe('auth');
    expect(toCloudError({ message: 'm', code: '42501' }).kind).toBe('auth');
    expect(toCloudError({ message: 'JWT expired', code: 'PGRST301' }).kind).toBe('auth');
    expect(toCloudError({ message: 'm' }, 403).kind).toBe('auth');
  });
  it('does not treat a bare PostgREST 400 as auth', () => {
    expect(toCloudError({ message: 'bad request' }, 400).kind).toBe('other');
  });
  it('classifies the rest as other', () => {
    expect(toCloudError({ message: 'weak password', status: 422 }).kind).toBe('other');
    for (const code of ['23514', '22P02', '21000', 'P0001', 'PGRST102', 'PGRST204']) {
      expect(toCloudError({ message: 'm', code }, 400).kind).toBe('other');
    }
    expect(toCloudError('boom').kind).toBe('other');
    expect(toCloudError(null).kind).toBe('other');
  });
});

describe('createSupabaseCloudApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes no request when created', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    const api = createSupabaseCloudApi({ url: 'http://localhost:54321', anonKey: 'test-anon-key' });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    const unsubscribe = api.onAuthChange(() => {});
    expect(typeof unsubscribe).toBe('function');
    expect(await api.getUser()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('refuses data calls without a session, without any request', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    const api = createSupabaseCloudApi({ url: 'http://localhost:54321', anonKey: 'test-anon-key' });
    await expect(api.pullPage(null)).rejects.toMatchObject({ kind: 'auth' });
    await expect(api.pushBatches([batch('s', 0, 0)], 'user-x')).rejects.toMatchObject({ kind: 'auth' });
    await expect(api.deleteMyData('user-x')).rejects.toMatchObject({ kind: 'auth' });
    await expect(api.updatePassword('pw-new')).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
