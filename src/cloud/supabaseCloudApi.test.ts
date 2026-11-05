import { describe, it, expect, vi, afterEach } from 'vitest';
import { batchToRow, rowToBatch, flattenBatches, toCloudError, createSupabaseCloudApi, afterFilter } from './supabaseCloudApi';
import { CloudError, type EventBatch } from './cloudApi';
import type { ClerkSession, ClerkSessionUser } from './clerkSession';
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

const CONFIG = { supabaseUrl: 'http://localhost:54321', anonKey: 'test-anon-key', clerkPublishableKey: 'test-clerk-key' };

/** A ClerkSession driven by the test: who is signed in and which token Clerk hands out. */
function fakeSession(user: ClerkSessionUser | null = null, token: string | null = null) {
  const listeners = new Set<() => void>();
  const state = { user, token };
  const emit = (): void => {
    for (const l of listeners) l();
  };
  const session = {
    load: vi.fn(async () => {}),
    getUser: () => state.user,
    getToken: vi.fn(async () => state.token),
    openSignIn: vi.fn(),
    signOut: vi.fn(async () => {
      state.user = null;
      state.token = null;
      emit();
    }),
    onChange: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  } satisfies ClerkSession;
  const set = (u: ClerkSessionUser | null, t: string | null): void => {
    state.user = u;
    state.token = t;
    emit();
  };
  return { session, state, set };
}

interface Seen {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

/** Stubs fetch with PostgREST answers; records every request. */
function stubFetch(answer: (req: Seen) => { status: number; body: unknown } = () => ({ status: 200, body: [] })) {
  const seen: Seen[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const req: Seen = {
      url: String(input),
      method: init?.method ?? 'GET',
      authorization: headers.get('Authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    seen.push(req);
    const { status, body } = answer(req);
    const text = status === 204 ? null : JSON.stringify(body);
    return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', spy);
  return { spy, seen };
}

const ANA: ClerkSessionUser = { id: 'user_2anaTEST', email: null };

describe('createSupabaseCloudApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('makes no request when created; getUser waits for Clerk and reads its user', async () => {
    const { spy } = stubFetch();
    const f = fakeSession(ANA, 'token-1');
    const api = createSupabaseCloudApi(CONFIG, f.session);
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).not.toHaveBeenCalled();
    expect(await api.getUser()).toEqual({ id: ANA.id, email: '' });
    expect(f.session.load).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('a failed Clerk load makes getUser reject with a network error', async () => {
    const f = fakeSession();
    f.session.load.mockRejectedValueOnce(new CloudError('network', 'could not load Clerk'));
    const api = createSupabaseCloudApi(CONFIG, f.session);
    await expect(api.getUser()).rejects.toMatchObject({ kind: 'network' });
  });

  it('refuses data calls without a user or without a token, without any request', async () => {
    const { spy } = stubFetch();
    const f = fakeSession();
    const api = createSupabaseCloudApi(CONFIG, f.session);
    const calls = (): Promise<unknown>[] => [
      api.pullPage(null),
      api.pushBatches([batch('s', 0, 0)], ANA.id),
      api.deleteMyData(ANA.id),
      api.isAdmin(),
      api.acceptedTermsVersion(),
      api.acceptTerms('t1'),
    ];
    for (const p of calls()) await expect(p).rejects.toMatchObject({ kind: 'auth' });
    f.set(ANA, null); // signed in, but Clerk has no token right now (expired while offline, say)
    for (const p of calls()) await expect(p).rejects.toMatchObject({ kind: 'auth' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('asks Clerk for the token on every data call and sends it as the bearer', async () => {
    const { seen } = stubFetch();
    const f = fakeSession(ANA, 'token-1');
    const api = createSupabaseCloudApi(CONFIG, f.session);
    const before = f.session.getToken.mock.calls.length; // the client may ask once at creation
    await api.isAdmin();
    f.state.token = 'token-2'; // refreshed by Clerk
    await api.pullPage(null);
    expect(seen.map((r) => r.authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(f.session.getToken.mock.calls.length - before).toBeGreaterThanOrEqual(2);
  });

  it('isAdmin and the pull filter on the Clerk user id', async () => {
    const { seen } = stubFetch((req) => ({ status: 200, body: req.url.includes('/admins') ? [{ user_id: ANA.id }] : [] }));
    const api = createSupabaseCloudApi(CONFIG, fakeSession(ANA, 'token-1').session);
    expect(await api.isAdmin()).toBe(true);
    expect(await api.pullPage(null)).toEqual({ events: [], next: null });
    expect(seen[0].url).toContain('/rest/v1/admins?');
    expect(seen[0].url).toContain(`user_id=eq.${ANA.id}`);
    expect(seen[1].url).toContain('/rest/v1/event_batches?');
    expect(seen[1].url).toContain(`user_id=eq.${ANA.id}`);
  });

  it('pushes rows with the bound user id, not the session one', async () => {
    const { seen } = stubFetch(() => ({ status: 201, body: [] }));
    const api = createSupabaseCloudApi(CONFIG, fakeSession(ANA, 'token-1').session);
    await api.pushBatches([batch('s', 0, 1)], 'user_bound');
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('POST');
    expect((seen[0].body as { user_id: string }[]).map((r) => r.user_id)).toEqual(['user_bound']);
  });

  it('deleteMyData refuses another user locally and calls delete_my_data with the expected id', async () => {
    const { seen } = stubFetch(() => ({ status: 204, body: null }));
    const api = createSupabaseCloudApi(CONFIG, fakeSession(ANA, 'token-1').session);
    await expect(api.deleteMyData('user_other')).rejects.toMatchObject({ kind: 'auth' });
    expect(seen).toHaveLength(0);
    await api.deleteMyData(ANA.id);
    expect(seen[0].url).toContain('/rest/v1/rpc/delete_my_data');
    expect(seen[0].body).toEqual({ expected: ANA.id });
  });

  it('a token PostgREST refuses (JWT errors) is auth; other failures keep their kinds', async () => {
    const api = createSupabaseCloudApi(CONFIG, fakeSession(ANA, 'token-1').session);
    const pgError = (code: string, message: string) => ({ code, message, details: null, hint: null });
    stubFetch(() => ({ status: 401, body: pgError('PGRST301', 'JWT expired') }));
    await expect(api.pullPage(null)).rejects.toMatchObject({ kind: 'auth' });
    stubFetch(() => ({ status: 401, body: pgError('PGRST303', 'JWT claims validation failed') }));
    await expect(api.isAdmin()).rejects.toMatchObject({ kind: 'auth' });
    stubFetch(() => ({ status: 401, body: { message: 'Invalid JWT' } })); // the gateway, before PostgREST
    await expect(api.acceptedTermsVersion()).rejects.toMatchObject({ kind: 'auth' });
    stubFetch(() => ({ status: 403, body: pgError('42501', 'new row violates row-level security policy') }));
    await expect(api.pushBatches([batch('s', 0, 0)], 'user_other')).rejects.toMatchObject({ kind: 'auth' });
    stubFetch(() => ({ status: 400, body: pgError('23514', 'check violation') }));
    await expect(api.pushBatches([batch('s', 0, 0)], ANA.id)).rejects.toMatchObject({ kind: 'other' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    // A push (POST: not retried by the client, unlike reads) that cannot reach the server.
    await expect(api.pushBatches([batch('s', 0, 0)], ANA.id)).rejects.toMatchObject({ kind: 'network' });
  });

  it('acceptTerms treats an already accepted version as done', async () => {
    stubFetch(() => ({ status: 409, body: { code: '23505', message: 'duplicate key', details: null, hint: null } }));
    const api = createSupabaseCloudApi(CONFIG, fakeSession(ANA, 'token-1').session);
    await expect(api.acceptTerms('t1')).resolves.toBeUndefined();
  });

  it('follows Clerk session changes synchronously and delegates sign-in and sign-out', async () => {
    const f = fakeSession();
    const api = createSupabaseCloudApi(CONFIG, f.session);
    const seen: (string | null)[] = [];
    const off = api.onAuthChange((u) => seen.push(u?.id ?? null));
    f.set(ANA, 'token-1');
    expect(seen).toEqual([ANA.id]);
    api.openSignIn();
    expect(f.session.openSignIn).toHaveBeenCalledTimes(1);
    await api.signOut();
    expect(seen).toEqual([ANA.id, null]);
    off();
    f.set(ANA, 'token-1');
    expect(seen).toHaveLength(2);
  });

  it('a Clerk sign-out failure becomes a CloudError', async () => {
    const f = fakeSession(ANA, 'token-1');
    f.session.signOut.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const api = createSupabaseCloudApi(CONFIG, f.session);
    await expect(api.signOut()).rejects.toMatchObject({ kind: 'network' });
  });
});
