import { describe, it, expect } from 'vitest';
import { FakeCloudApi } from './fakeCloudApi';
import { CloudError, type EventBatch } from './cloudApi';
import type { LoggedEvent } from '../telemetry/schema';

const MAIL_A = 'a@test.invalid';
const MAIL_B = 'b@test.invalid';
const PW = 'pw-one';

function ev(session_id: string, seq: number, extra: Record<string, unknown> = {}): LoggedEvent {
  return { v: 2, seq, t_ms: seq, player_id: 'p', session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type: 'x', ...extra };
}
function batch(sessionId: string, firstSeq: number, n = 2, extra: Record<string, unknown> = {}): EventBatch {
  const events = Array.from({ length: n }, (_, i) => ev(sessionId, firstSeq + i, extra));
  return { sessionId, firstSeq, lastSeq: firstSeq + n - 1, events };
}
async function expectKind(p: Promise<unknown>, kind: string): Promise<void> {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof CloudError && e.kind === kind);
}
async function signedIn(api: FakeCloudApi, email = MAIL_A) {
  await api.signUp(email, PW);
  return api.signIn(email, PW);
}

describe('FakeCloudApi', () => {
  it('signs up and signs in, returning the user', async () => {
    const api = new FakeCloudApi();
    expect(await api.signUp(MAIL_A, PW)).toEqual({ needsEmailConfirmation: false });
    const user = await api.signIn(MAIL_A, PW);
    expect(user.email).toBe(MAIL_A);
    expect(await api.getUser()).toEqual(user);
    await api.signOut();
    expect(await api.getUser()).toBeNull();
  });

  it('rejects a wrong password with an auth error', async () => {
    const api = new FakeCloudApi();
    await api.signUp(MAIL_A, PW);
    await expectKind(api.signIn(MAIL_A, 'wrong'), 'auth');
  });

  it('notifies auth listeners until unsubscribed', async () => {
    const api = new FakeCloudApi();
    const seen: (string | null)[] = [];
    const off = api.onAuthChange((u) => seen.push(u?.email ?? null));
    await signedIn(api);
    await api.signOut();
    off();
    await api.signIn(MAIL_A, PW);
    expect(seen).toEqual([MAIL_A, null]);
  });

  it('replaces a batch with the same (sessionId, firstSeq)', async () => {
    const api = new FakeCloudApi();
    const user = await signedIn(api);
    await api.pushBatches([batch('s1', 0, 2, { tag: 'old' }), batch('s1', 2)], user.id);
    await api.pushBatches([batch('s1', 0, 3, { tag: 'new' })], user.id);
    const stored = api.batchesOf(user.id);
    expect(stored).toHaveLength(2);
    const first = stored.find((b) => b.firstSeq === 0)!;
    expect(first.lastSeq).toBe(2);
    expect(first.events.every((e) => e.tag === 'new')).toBe(true);
  });

  it('never shrinks a stored batch on a shorter resend, but grows on a larger one', async () => {
    const api = new FakeCloudApi();
    const user = await signedIn(api);
    await api.pushBatches([batch('s1', 0, 3)], user.id);
    await api.pushBatches([batch('s1', 0, 2)], user.id);
    expect(api.batchesOf(user.id)[0].lastSeq).toBe(2);
    await api.pushBatches([batch('s1', 0, 5)], user.id);
    expect(api.batchesOf(user.id)[0].lastSeq).toBe(4);
  });

  it('copies batches so callers cannot mutate stored state', async () => {
    const api = new FakeCloudApi();
    const user = await signedIn(api);
    const b = batch('s1', 0, 2);
    await api.pushBatches([b], user.id);
    b.events.pop();
    api.batchesOf(user.id)[0].events.pop();
    (await api.pullAll()).pop();
    expect(api.batchesOf(user.id)[0].events).toHaveLength(2);
    expect(await api.pullAll()).toHaveLength(2);
  });

  it('can require e-mail confirmation on sign-up', async () => {
    const api = new FakeCloudApi({ needsEmailConfirmation: true });
    expect(await api.signUp(MAIL_A, PW)).toEqual({ needsEmailConfirmation: true });
  });

  it('pulls only the signed-in user events', async () => {
    const api = new FakeCloudApi();
    const a = await signedIn(api, MAIL_A);
    await api.pushBatches([batch('sa', 0)], a.id);
    await api.signOut();
    const b = await signedIn(api, MAIL_B);
    await api.pushBatches([batch('sb', 0, 3)], b.id);
    const pulled = await api.pullAll();
    expect(pulled).toHaveLength(3);
    expect(pulled.every((e) => e.session_id === 'sb')).toBe(true);
  });

  it('fails the next n pushes with a network error, then recovers', async () => {
    const api = new FakeCloudApi();
    const user = await signedIn(api);
    api.failNext(1);
    await expectKind(api.pushBatches([batch('s1', 0)], user.id), 'network');
    expect(api.batchesOf(user.id)).toHaveLength(0);
    await api.pushBatches([batch('s1', 0)], user.id);
    expect(api.batchesOf(user.id)).toHaveLength(1);
  });

  it('requires sign-in to push', async () => {
    await expectKind(new FakeCloudApi().pushBatches([batch('s1', 0)], 'user-1'), 'auth');
  });

  it('deleteMyData empties only the current user', async () => {
    const api = new FakeCloudApi();
    const a = await signedIn(api, MAIL_A);
    await api.pushBatches([batch('sa', 0)], a.id);
    await api.signOut();
    const b = await signedIn(api, MAIL_B);
    await api.pushBatches([batch('sb', 0)], b.id);
    await api.acceptTerms('t1');
    await expectKind(api.deleteMyData(a.id), 'auth'); // not the signed-in user: refused, nothing deleted
    expect(api.batchesOf(b.id)).toHaveLength(1);
    await api.deleteMyData(b.id);
    expect(await api.acceptedTermsVersion()).toBeNull();
    expect(api.batchesOf(b.id)).toHaveLength(0);
    expect(await api.pullAll()).toEqual([]);
    expect(api.batchesOf(a.id)).toHaveLength(1);
  });

  it('isAdmin is true only for users marked admin', async () => {
    const api = new FakeCloudApi();
    const user = await signedIn(api);
    expect(await api.isAdmin()).toBe(false);
    api.setAdmin(user.id);
    expect(await api.isAdmin()).toBe(true);
  });

  it('updatePassword changes the signed-in user password and requires a session', async () => {
    const api = new FakeCloudApi();
    await expectKind(api.updatePassword('pw-two'), 'auth');
    await signedIn(api);
    await api.updatePassword('pw-two');
    await api.signOut();
    await expectKind(api.signIn(MAIL_A, PW), 'auth');
    expect((await api.signIn(MAIL_A, 'pw-two')).email).toBe(MAIL_A);
  });

  it('updatePassword fails with a network error when asked to', async () => {
    const api = new FakeCloudApi();
    await signedIn(api);
    api.failNext(1);
    await expectKind(api.updatePassword('pw-two'), 'network');
    await api.signOut();
    expect((await api.signIn(MAIL_A, PW)).email).toBe(MAIL_A);
  });

  it('simulateRecovery signs the account in with a recovery event', async () => {
    const api = new FakeCloudApi();
    await api.signUp(MAIL_A, PW);
    const seen: [string | null, string | undefined][] = [];
    api.onAuthChange((u, event) => seen.push([u?.email ?? null, event]));
    api.simulateRecovery(MAIL_A);
    expect(seen).toEqual([[MAIL_A, 'recovery']]);
    expect((await api.getUser())?.email).toBe(MAIL_A);
    await api.signOut();
    expect(seen[1]).toEqual([null, 'other']);
    expect(() => api.simulateRecovery(MAIL_B)).toThrow(CloudError);
  });

  it('refuses rows of another user than the session (as RLS WITH CHECK)', async () => {
    const api = new FakeCloudApi();
    const user = await signedIn(api);
    await expectKind(api.pushBatches([batch('s1', 0)], 'someone-else'), 'auth');
    expect(api.batchesOf(user.id)).toHaveLength(0);
  });

  it('pulls in pages ordered by (session, firstSeq), each page starting after the cursor', async () => {
    const api = new FakeCloudApi({ pullPageSize: 2 });
    const user = await signedIn(api);
    await api.pushBatches([batch('b', 0), batch('a', 2), batch('a', 0), batch('c', 0, 1)], user.id);
    const first = await api.pullPage(null);
    expect(first.events.map((e) => `${e.session_id}${e.seq}`)).toEqual(['a0', 'a1', 'a2', 'a3']);
    expect(first.next).toEqual({ sessionId: 'a', firstSeq: 2 });
    const second = await api.pullPage(first.next);
    expect(second.events.map((e) => `${e.session_id}${e.seq}`)).toEqual(['b0', 'b1', 'c0']);
    expect(second.next).toEqual({ sessionId: 'c', firstSeq: 0 });
    expect(await api.pullPage(second.next)).toEqual({ events: [], next: null });
  });

  it('stores the accepted terms version per user', async () => {
    const api = new FakeCloudApi();
    await signedIn(api);
    expect(await api.acceptedTermsVersion()).toBeNull();
    await api.acceptTerms('t1');
    expect(await api.acceptedTermsVersion()).toBe('t1');
  });
});
