import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { LoggedEvent } from '../telemetry/schema';
import { CloudError, type CloudApi, type CloudUser, type EventBatch } from './cloudApi';
import type { CloudConfig } from './cloudConfig';

/** Batches fetched per request when pulling (each holds up to ~500 events). */
const PULL_PAGE_SIZE = 20;

/** The writable columns of event_batches (the server fills user_id and created_at). */
export interface BatchRow {
  session_id: string;
  first_seq: number;
  last_seq: number;
  events: LoggedEvent[];
}

export function batchToRow(batch: EventBatch): BatchRow {
  return { session_id: batch.sessionId, first_seq: batch.firstSeq, last_seq: batch.lastSeq, events: batch.events };
}

export function rowToBatch(row: BatchRow): EventBatch {
  return { sessionId: row.session_id, firstSeq: row.first_seq, lastSeq: row.last_seq, events: row.events };
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

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
}

const FETCH_FAILURE = /failed to fetch|fetch failed|networkerror|network request failed|load failed/i;

/**
 * Maps any error the Supabase client returns or throws to a CloudError.
 * auth-js errors (name starts with 'Auth'): network on fetch failures, auth on 400/401/403.
 * PostgREST errors: auth only on HTTP 401/403, SQLSTATE 42501, class 28 and PGRST30x;
 * check violations and the like (even at HTTP 400) are 'other'.
 */
export function toCloudError(err: unknown, httpStatus?: number): CloudError {
  if (err instanceof CloudError) return err;
  const e: ErrorLike = typeof err === 'object' && err !== null ? (err as ErrorLike) : {};
  const message = typeof e.message === 'string' && e.message ? e.message : String(err);
  const name = typeof e.name === 'string' ? e.name : '';
  const status = typeof e.status === 'number' ? e.status : httpStatus;
  const code = typeof e.code === 'string' ? e.code : '';
  const isAuthJs = name.startsWith('Auth') || (typeof err === 'object' && err !== null && '__isAuthError' in err);

  if (name === 'AuthRetryableFetchError' || status === 0 || (!status && FETCH_FAILURE.test(message))) {
    return new CloudError('network', message);
  }
  if (isAuthJs) {
    return new CloudError(status === 400 || status === 401 || status === 403 ? 'auth' : 'other', message);
  }
  if (status === 401 || status === 403 || code === '42501' || code.startsWith('28') || /^PGRST30[0-9]$/.test(code)) {
    return new CloudError('auth', message);
  }
  return new CloudError('other', message);
}

function toCloudUser(user: User | null | undefined): CloudUser | null {
  return user ? { id: user.id, email: user.email ?? '' } : null;
}

/** Throws the converted error of a result; `status` is the HTTP status of PostgREST calls. */
function check(result: { error: unknown; status?: number }): void {
  if (result.error) throw toCloudError(result.error, result.status);
}

async function guard<T>(fn: () => PromiseLike<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toCloudError(err);
  }
}

/** Redirect links in auth e-mails go back to the page that asked, when running in a browser. */
function redirectOptions(key: 'emailRedirectTo'): { emailRedirectTo?: string };
function redirectOptions(key: 'redirectTo'): { redirectTo?: string };
function redirectOptions(key: string): Record<string, string> {
  return typeof window !== 'undefined' && window.location ? { [key]: window.location.origin } : {};
}

export function createSupabaseCloudApi(config: CloudConfig): CloudApi {
  // With empty storage creating the client makes no request. A stored expired session, or a
  // confirmation/recovery URL, may trigger auth requests at creation.
  const client: SupabaseClient = createClient(config.url, config.anonKey);

  async function currentUser(): Promise<CloudUser | null> {
    // Local session (refreshed automatically); getUser() would hit the network.
    const { data, error } = await client.auth.getSession();
    check({ error });
    return toCloudUser(data.session?.user);
  }

  async function requireUser(): Promise<CloudUser> {
    const user = await currentUser();
    if (!user) throw new CloudError('auth', 'not signed in');
    return user;
  }

  return {
    getUser: () => guard(currentUser),

    signUp: (email, password) =>
      guard(async () => {
        const { data, error } = await client.auth.signUp({ email, password, options: redirectOptions('emailRedirectTo') });
        check({ error });
        return { needsEmailConfirmation: data.session === null };
      }),

    signIn: (email, password) =>
      guard(async () => {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        check({ error });
        const user = toCloudUser(data.user);
        if (!user) throw new CloudError('other', 'sign-in returned no user');
        return user;
      }),

    signOut: () =>
      guard(async () => {
        const { error } = await client.auth.signOut();
        if (error) {
          // A failed global sign-out must not trap the user: end the local session regardless.
          if (toCloudError(error).kind !== 'network') throw toCloudError(error);
          const local = await client.auth.signOut({ scope: 'local' });
          check({ error: local.error });
        }
      }),

    resetPassword: (email) =>
      guard(async () => {
        const { error } = await client.auth.resetPasswordForEmail(email, redirectOptions('redirectTo'));
        check({ error });
      }),

    updatePassword: (newPassword) =>
      guard(async () => {
        await requireUser();
        const { error } = await client.auth.updateUser({ password: newPassword });
        check({ error });
      }),

    isAdmin: () =>
      guard(async () => {
        const user = await requireUser();
        const res = await client.from('admins').select('user_id').eq('user_id', user.id).limit(1);
        check(res);
        return (res.data ?? []).length > 0;
      }),

    acceptedTermsVersion: () =>
      guard(async () => {
        const user = await requireUser();
        const res = await client
          .from('consents')
          .select('terms_version')
          .eq('user_id', user.id)
          .order('accepted_at', { ascending: false })
          .limit(1);
        check(res);
        const row = (res.data ?? [])[0] as { terms_version: string } | undefined;
        return row ? row.terms_version : null;
      }),

    acceptTerms: (version) =>
      guard(async () => {
        await requireUser();
        const res = await client.from('consents').insert({ terms_version: version });
        // 23505: this version was already accepted; the goal is reached.
        if (res.error && res.error.code === '23505') return;
        check(res);
      }),

    pushBatches: (batches) =>
      guard(async () => {
        if (batches.length === 0) return;
        await requireUser();
        const res = await client
          .from('event_batches')
          .upsert(batches.map(batchToRow), { onConflict: 'user_id,session_id,first_seq' });
        check(res);
      }),

    pullEvents: () =>
      guard(async () => {
        const user = await requireUser();
        const batches: EventBatch[] = [];
        // Stable pages: (session_id, first_seq) is unique within one user. Admins can read
        // every row through RLS, but the sync pull wants the own account only, so filter.
        for (let from = 0; ; from += PULL_PAGE_SIZE) {
          const res = await client
            .from('event_batches')
            .select('session_id, first_seq, last_seq, events')
            .eq('user_id', user.id)
            .order('session_id', { ascending: true })
            .order('first_seq', { ascending: true })
            .range(from, from + PULL_PAGE_SIZE - 1);
          check(res);
          const rows = (res.data ?? []) as BatchRow[];
          batches.push(...rows.map(rowToBatch));
          if (rows.length < PULL_PAGE_SIZE) break;
        }
        return flattenBatches(batches);
      }),

    deleteMyData: () =>
      guard(async () => {
        await requireUser();
        check(await client.rpc('delete_my_data'));
      }),

    onAuthChange: (listener) => {
      // Synchronous: awaiting another client call inside this callback deadlocks supabase-js.
      const { data } = client.auth.onAuthStateChange((event, session) => {
        listener(toCloudUser(session?.user), event === 'PASSWORD_RECOVERY' ? 'recovery' : 'other');
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
