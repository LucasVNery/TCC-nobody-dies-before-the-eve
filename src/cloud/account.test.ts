import { describe, it, expect, vi, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Account, accountDbName, accountFromRegistry, ACCOUNT_REGISTRY_KEY, type AccountState } from './account';
import { FakeCloudApi } from './fakeCloudApi';
import { CloudError } from './cloudApi';
import { TERMS_VERSION } from './consentText';
import { openAccountStore } from './syncBoot';
import { IndexedDbEventStore } from '../telemetry/eventStore';
import type { LoggedEvent } from '../telemetry/schema';

// Built at runtime: no credential or e-mail literals in the repo.
const mail = (name: string): string => [name, 'test.invalid'].join('@');
const PW = `pw-${4242}`;

afterEach(() => vi.restoreAllMocks());

/** Runs deferred work only when asked, to observe what happens inside the auth callback. */
function manualDefer() {
  const runs: (() => void)[] = [];
  return {
    defer: (run: () => void) => void runs.push(run),
    flush: () => {
      for (const r of runs.splice(0)) r();
    },
  };
}

const idle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

function ev(player_id: string, session_id: string, seq: number): LoggedEvent {
  return { v: 2, seq, t_ms: seq, player_id, session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type: 'x' };
}

async function apiWith(...names: string[]): Promise<FakeCloudApi> {
  const api = new FakeCloudApi();
  for (const n of names) await api.signUp(mail(n), PW);
  return api;
}

describe('Account', () => {
  it('local mode (no CloudApi): no user, init resolves, cloud actions reject', async () => {
    const account = new Account(null);
    await account.init();
    expect(account.state).toEqual({ mode: 'local', user: null, isAdmin: false, termsAccepted: false });
    expect(account.cloud).toBeNull();
    await expect(account.signIn(mail('ana'), PW)).rejects.toBeInstanceOf(CloudError);
    await expect(account.signUp(mail('ana'), PW)).rejects.toBeInstanceOf(CloudError);
    await expect(account.signOut()).rejects.toBeInstanceOf(CloudError);
    await expect(account.acceptTerms()).rejects.toBeInstanceOf(CloudError);
    await expect(account.deleteMyData()).rejects.toBeInstanceOf(CloudError);
  });

  it('init restores a stored session with its admin role and consent', async () => {
    const api = await apiWith('ana');
    const user = await api.signIn(mail('ana'), PW);
    api.setAdmin(user.id);
    await api.acceptTerms(TERMS_VERSION);
    const account = new Account(api, { defer: queueMicrotask });
    await account.init();
    expect(account.state).toEqual({ mode: 'cloud', user, isAdmin: true, termsAccepted: true });
  });

  it('a session restore that fails leaves the game signed out instead of throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = await apiWith();
    vi.spyOn(api, 'getUser').mockRejectedValue(new CloudError('network', 'offline'));
    const account = new Account(api);
    await expect(account.init()).resolves.toBeUndefined();
    expect(account.state.user).toBeNull();
  });

  it('signIn loads the details; consent counts only for the current terms version', async () => {
    const api = await apiWith('ana');
    await api.signIn(mail('ana'), PW);
    await api.acceptTerms('an-older-version');
    await api.signOut();
    const account = new Account(api, { defer: queueMicrotask });
    await account.init();
    const seen: AccountState[] = [];
    account.onChange((s) => seen.push(s));
    const user = await account.signIn(mail('ana'), PW);
    expect(account.state).toEqual({ mode: 'cloud', user, isAdmin: false, termsAccepted: false });
    expect(seen[0].user).toEqual(user);

    await account.acceptTerms();
    expect(account.state.termsAccepted).toBe(true);
    expect(await api.acceptedTermsVersion()).toBe(TERMS_VERSION);
  });

  it('the auth callback only updates state: client calls run afterwards, outside it', async () => {
    const api = await apiWith('ana');
    const d = manualDefer();
    const account = new Account(api, { defer: d.defer });
    await account.init();
    const isAdmin = vi.spyOn(api, 'isAdmin');
    await api.signIn(mail('ana'), PW); // signed in by another path: only onAuthChange reports it
    expect(account.state.user?.email).toBe(mail('ana'));
    expect(isAdmin).not.toHaveBeenCalled();
    d.flush();
    await idle();
    expect(isAdmin).toHaveBeenCalledTimes(1);
  });

  it('a session lost mid-game only clears the user (sync pauses); signing in again restores it', async () => {
    const api = await apiWith('ana');
    const account = new Account(api, { defer: queueMicrotask });
    await account.init();
    const user = await account.signIn(mail('ana'), PW);
    expect(account.canSync(user.id)).toBe(true);
    await api.signOut(); // expiry reported by the client
    expect(account.state.user).toBeNull();
    expect(account.canSync(user.id)).toBe(false);
    await account.signIn(mail('ana'), PW);
    expect(account.canSync(user.id)).toBe(true);
    expect(account.canSync('someone-else')).toBe(false);
  });

  it('a token refresh of the same user does not reset the details nor notify', async () => {
    const api = await apiWith('ana');
    const user = await api.signIn(mail('ana'), PW);
    await api.acceptTerms(TERMS_VERSION);
    let emit!: (u: typeof user | null) => void;
    vi.spyOn(api, 'onAuthChange').mockImplementation((l) => {
      emit = l;
      return () => {};
    });
    const account = new Account(api, { defer: queueMicrotask });
    await account.init();
    const listener = vi.fn();
    account.onChange(listener);
    emit({ ...user });
    expect(listener).not.toHaveBeenCalled();
    expect(account.state.termsAccepted).toBe(true);
  });

  it('a failing change listener does not break the others', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = await apiWith('ana');
    const account = new Account(api, { defer: queueMicrotask });
    const ok = vi.fn();
    account.onChange(() => {
      throw new Error('boom');
    });
    account.onChange(ok);
    await account.signIn(mail('ana'), PW);
    expect(ok).toHaveBeenCalled();
  });

  it('signOut ends the session and keeps the account database', async () => {
    const api = await apiWith('ana');
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask });
    const user = await account.signIn(mail('ana'), PW);
    const opened = await openAccountStore(account, { factory, timers: { set: () => 0, clear: () => {} } });
    opened!.store.close();
    await account.signOut();
    expect(account.state.user).toBeNull();
    expect(await api.getUser()).toBeNull();
    expect((await factory.databases()).map((d) => d.name)).toEqual([accountDbName(user.id)]);
  });

  it('deleteMyData clears the cloud and the account database, so nothing is pushed back later', async () => {
    const api = await apiWith('ana');
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask });
    const user = await account.signIn(mail('ana'), PW);
    await account.acceptTerms();
    const timers = { set: () => 0, clear: () => {} };
    const first = await openAccountStore(account, { factory, timers });
    await first!.store.append([ev(user.id, 's', 0), ev(user.id, 's', 1)]);
    first!.store.close(); // last push in the background; deleteMyData waits for it
    await account.deleteMyData();

    expect(api.batchesOf(user.id)).toEqual([]);
    expect(await api.acceptedTermsVersion()).toBeNull();
    expect(account.state.termsAccepted).toBe(false);
    expect(await factory.databases()).toEqual([]);

    const again = await openAccountStore(account, { factory, timers });
    expect(await again!.store.readAll()).toEqual([]);
    again!.store.close();
    await account.signOut();
    expect(api.batchesOf(user.id)).toEqual([]);
  });

  it('a last push that lands after the settle wait does not bring deleted server data back', async () => {
    const api = await apiWith('ana');
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask, settleTimeoutMs: 10 });
    const user = await account.signIn(mail('ana'), PW);
    const timers = { set: () => 0, clear: () => {} };
    const opened = await openAccountStore(account, { factory, timers });
    await idle(); // boot push (nothing pending) done
    let releasePush!: () => void;
    const gate = new Promise<void>((r) => (releasePush = r));
    const push = api.pushBatches.bind(api);
    const pushing = vi.spyOn(api, 'pushBatches').mockImplementation(async (b) => {
      await gate;
      return push(b);
    });
    const del = api.deleteMyData.bind(api);
    const deletes = vi.spyOn(api, 'deleteMyData').mockImplementation(async () => {
      await del();
      releasePush(); // the slow push lands right after the first server delete
    });
    await opened!.store.append([ev(user.id, 's', 0)]);
    opened!.store.close(); // last push hangs past settleTimeoutMs
    await vi.waitFor(() => expect(pushing).toHaveBeenCalled()); // on the wire before the deletion starts
    await account.deleteMyData();
    expect(deletes).toHaveBeenCalledTimes(2);
    expect(api.batchesOf(user.id)).toEqual([]);
    expect(await factory.databases()).toEqual([]);
  });

  it('pausing and resuming for a deletion notifies listeners', async () => {
    const api = await apiWith('ana');
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask });
    const user = await account.signIn(mail('ana'), PW);
    const seen: boolean[] = [];
    account.onChange(() => seen.push(account.canSync(user.id)));
    await account.deleteMyData();
    expect(seen[0]).toBe(false);
    expect(seen[seen.length - 1]).toBe(true);
  });

  it('no push for the user starts while their data is being deleted', async () => {
    const api = await apiWith('ana');
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask });
    const user = await account.signIn(mail('ana'), PW);
    let release!: () => void;
    vi.spyOn(api, 'deleteMyData').mockImplementation(() => new Promise<void>((r) => (release = r)));
    const deleting = account.deleteMyData();
    await idle();
    expect(account.canSync(user.id)).toBe(false);
    release();
    await deleting;
    expect(account.canSync(user.id)).toBe(true);
  });

  it('a recovery link sets passwordRecovery synchronously; updatePassword clears it and sets the password', async () => {
    const api = await apiWith('ana');
    const d = manualDefer();
    const account = new Account(api, { defer: d.defer });
    await account.init();
    const updates = vi.spyOn(api, 'updatePassword');
    const seen: boolean[] = [];
    account.onChange(() => seen.push(account.passwordRecovery));
    api.simulateRecovery(mail('ana'));
    expect(account.passwordRecovery).toBe(true);
    expect(account.state.user?.email).toBe(mail('ana'));
    expect(seen).toEqual([true]);
    expect(updates).not.toHaveBeenCalled(); // nothing awaited inside the auth callback
    d.flush();
    await account.updatePassword('pw-new');
    expect(account.passwordRecovery).toBe(false);
    expect(seen[seen.length - 1]).toBe(false);
    await account.signOut();
    await account.signIn(mail('ana'), 'pw-new');
  });

  it('a recovery event for the already signed-in user still notifies; dismiss and sign-out clear it', async () => {
    const api = await apiWith('ana');
    const account = new Account(api, { defer: queueMicrotask });
    await account.init();
    await account.signIn(mail('ana'), PW);
    const listener = vi.fn();
    account.onChange(listener);
    api.simulateRecovery(mail('ana'));
    expect(account.passwordRecovery).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    account.dismissPasswordRecovery();
    expect(account.passwordRecovery).toBe(false);
    api.simulateRecovery(mail('ana'));
    await account.signOut();
    expect(account.passwordRecovery).toBe(false);
  });

  it('updatePassword needs a signed-in user; a failure keeps the recovery state', async () => {
    const api = await apiWith('ana');
    const account = new Account(api, { defer: queueMicrotask });
    await account.init();
    await expect(account.updatePassword('pw-new')).rejects.toMatchObject({ kind: 'auth' });
    api.simulateRecovery(mail('ana'));
    api.failNext(1);
    await expect(account.updatePassword('pw-new')).rejects.toMatchObject({ kind: 'network' });
    expect(account.passwordRecovery).toBe(true);
    await expect(new Account(null).updatePassword('pw-new')).rejects.toBeInstanceOf(CloudError);
  });

  it('simulated is set only with a CloudApi and the option', async () => {
    expect(new Account(null, { simulated: true }).simulated).toBe(false);
    expect(new Account(await apiWith(), { simulated: true }).simulated).toBe(true);
    expect(new Account(await apiWith()).simulated).toBe(false);
  });

  it('is found in the game registry', () => {
    const account = new Account(null);
    const values = new Map<string, unknown>([[ACCOUNT_REGISTRY_KEY, account]]);
    expect(accountFromRegistry({ get: (k) => values.get(k) })).toBe(account);
    expect(accountFromRegistry({ get: () => undefined })).toBeUndefined();
  });

  it('events recorded offline stay in the account database and go out on the next boot', async () => {
    const api = await apiWith('ana');
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask });
    const user = await account.signIn(mail('ana'), PW);
    api.failNext(10); // offline the whole time
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const timers = { set: () => 0, clear: () => {} };
    const s1 = await openAccountStore(account, { factory, timers });
    await s1!.store.append([ev(user.id, 's', 0)]);
    s1!.store.close();
    await idle();
    const local = await IndexedDbEventStore.open(factory, accountDbName(user.id));
    expect((await local.readAll()).map((e) => e.seq)).toEqual([0]);
    local.close();
    api.failNext(0);
    const s2 = await openAccountStore(account, { factory, timers }); // boot push sends it
    await idle();
    expect(api.batchesOf(user.id).flatMap((b) => b.events.map((e) => e.seq))).toEqual([0]);
    s2!.store.close();
  });
});
