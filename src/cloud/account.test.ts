import { describe, it, expect, vi, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Account, accountDbName, accountFromRegistry, ACCOUNT_REGISTRY_KEY, LAST_USER_KEY, SIGNOUT_PENDING_KEY, termsCacheKey, type AccountState, type TermsStorage } from './account';
import { createClerkSession, type ClerkLike, type ClerkLoader, type ClerkLoadOptions } from './clerkSession';
import { createSupabaseCloudApi } from './supabaseCloudApi';
import { playAction } from '../scenes/menu/menuState';
import { FakeCloudApi } from './fakeCloudApi';
import { CloudError, type CloudUser } from './cloudApi';
import { TERMS_VERSION } from './consentText';
import { openAccountStore } from './syncBoot';
import { IndexedDbEventStore } from '../telemetry/eventStore';
import type { LoggedEvent } from '../telemetry/schema';

// Built at runtime: no credential or e-mail literals in the repo.
const mail = (name: string): string => [name, 'test.invalid'].join('@');

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


/** Signs in through the fake (as finishing Clerk's window would) and waits until the account loaded the details. */
async function signIn(account: Account, email: string): Promise<CloudUser> {
  await account.init();
  const user = (account.cloud as FakeCloudApi).signInAs(email);
  await account.whenReady();
  return user;
}

describe('Account', () => {
  it('local mode (no CloudApi): no user, init resolves, cloud actions reject', async () => {
    const account = new Account(null);
    await account.init();
    expect(account.state).toEqual({ mode: 'local', user: null, isAdmin: false, termsAccepted: false });
    expect(account.cloud).toBeNull();
    expect(account.loading).toBe(false);
    expect(account.loadError).toBeNull();
    expect(() => account.openSignIn()).toThrow(CloudError);
    await expect(account.signOut()).rejects.toBeInstanceOf(CloudError);
    await expect(account.acceptTerms()).rejects.toBeInstanceOf(CloudError);
    await expect(account.deleteMyData()).rejects.toBeInstanceOf(CloudError);
  });

  it('init restores a stored session with its admin role and consent', async () => {
    const api = new FakeCloudApi();
    const user = api.signInAs(mail('ana'));
    api.setAdmin(user.id);
    await api.acceptTerms(TERMS_VERSION);
    const account = new Account(api, { defer: queueMicrotask });
    await account.init();
    expect(account.state).toEqual({ mode: 'cloud', user, isAdmin: true, termsAccepted: true });
  });

  it('a session restore that fails leaves the game signed out instead of throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = new FakeCloudApi();
    vi.spyOn(api, 'getUser').mockRejectedValue(new CloudError('network', 'offline'));
    const account = new Account(api);
    await expect(account.init()).resolves.toBeUndefined();
    expect(account.state.user).toBeNull();
  });

  it('signIn loads the details; consent counts only for the current terms version', async () => {
    const api = new FakeCloudApi();
    api.signInAs(mail('ana'));
    await api.acceptTerms('an-older-version');
    await api.signOut();
    const account = new Account(api, { defer: queueMicrotask });
    await account.init();
    const seen: AccountState[] = [];
    account.onChange((s) => seen.push(s));
    const user = await signIn(account, mail('ana'));
    expect(account.state).toEqual({ mode: 'cloud', user, isAdmin: false, termsAccepted: false });
    expect(seen[0].user).toEqual(user);

    await account.acceptTerms();
    expect(account.state.termsAccepted).toBe(true);
    expect(await api.acceptedTermsVersion()).toBe(TERMS_VERSION);
  });

  it('the auth callback only updates state: client calls run afterwards, outside it', async () => {
    const api = new FakeCloudApi();
    const d = manualDefer();
    const account = new Account(api, { defer: d.defer });
    await account.init();
    const isAdmin = vi.spyOn(api, 'isAdmin');
    api.signInAs(mail('ana')); // signed in by another path: only onAuthChange reports it
    expect(account.state.user?.email).toBe(mail('ana'));
    expect(isAdmin).not.toHaveBeenCalled();
    d.flush();
    await idle();
    expect(isAdmin).toHaveBeenCalledTimes(1);
  });

  it('a session lost mid-game only clears the user (sync pauses); signing in again restores it', async () => {
    const api = new FakeCloudApi();
    const account = new Account(api, { defer: queueMicrotask });
    await account.init();
    const user = await signIn(account, mail('ana'));
    expect(account.canSync(user.id)).toBe(true);
    await api.signOut(); // expiry reported by the client
    expect(account.state.user).toBeNull();
    expect(account.canSync(user.id)).toBe(false);
    await signIn(account, mail('ana'));
    expect(account.canSync(user.id)).toBe(true);
    expect(account.canSync('someone-else')).toBe(false);
  });

  it('a token refresh of the same user does not reset the details nor notify', async () => {
    const api = new FakeCloudApi();
    const user = api.signInAs(mail('ana'));
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
    const api = new FakeCloudApi();
    const account = new Account(api, { defer: queueMicrotask });
    const ok = vi.fn();
    account.onChange(() => {
      throw new Error('boom');
    });
    account.onChange(ok);
    await signIn(account, mail('ana'));
    expect(ok).toHaveBeenCalled();
  });

  it('signOut ends the session and keeps the account database', async () => {
    const api = new FakeCloudApi();
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask });
    const user = await signIn(account, mail('ana'));
    const opened = await openAccountStore(account, { factory, timers: { set: () => 0, clear: () => {} } });
    opened!.store.close();
    await account.signOut();
    expect(account.state.user).toBeNull();
    expect(await api.getUser()).toBeNull();
    expect((await factory.databases()).map((d) => d.name)).toEqual([accountDbName(user.id)]);
  });

  it('deleteMyData clears the cloud and the account database, so nothing is pushed back later', async () => {
    const api = new FakeCloudApi();
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask });
    const user = await signIn(account, mail('ana'));
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
    const api = new FakeCloudApi();
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask, settleTimeoutMs: 10 });
    const user = await signIn(account, mail('ana'));
    const timers = { set: () => 0, clear: () => {} };
    const opened = await openAccountStore(account, { factory, timers });
    await idle(); // boot push (nothing pending) done
    let releasePush!: () => void;
    const gate = new Promise<void>((r) => (releasePush = r));
    const push = api.pushBatches.bind(api);
    const pushing = vi.spyOn(api, 'pushBatches').mockImplementation(async (b, u) => {
      await gate;
      return push(b, u);
    });
    const del = api.deleteMyData.bind(api);
    const deletes = vi.spyOn(api, 'deleteMyData').mockImplementation(async (expected) => {
      await del(expected);
      releasePush(); // the slow push lands right after the first server delete
    });
    await opened!.store.append([ev(user.id, 's', 0)]);
    opened!.store.close(); // last push hangs past settleTimeoutMs
    await vi.waitFor(() => expect(pushing).toHaveBeenCalled()); // on the wire before the deletion starts
    await account.deleteMyData();
    expect(deletes).toHaveBeenCalledTimes(2);
    expect(deletes.mock.calls.every((call) => call[0] === user.id)).toBe(true); // the server checks it is this user
    expect(api.batchesOf(user.id)).toEqual([]);
    expect(await factory.databases()).toEqual([]);
  });

  it('a last push that lands after the local database is gone (but within the second wait) is removed by the second delete', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // the closed store's progress write fails, as expected
    const api = new FakeCloudApi();
    const factory = new IDBFactory() as unknown as IDBFactory;
    let releasePush!: () => void;
    // The push is released right after the local database is deleted (which no longer waits for it,
    // since connections close themselves on versionchange): it lands after the first server delete.
    const deletingFactory = {
      deleteDatabase: (name: string) => {
        const req = factory.deleteDatabase(name);
        req.addEventListener('success', () => setTimeout(() => releasePush(), 0));
        return req;
      },
    } as unknown as IDBFactory;
    const account = new Account(api, { idb: () => deletingFactory, defer: queueMicrotask, settleTimeoutMs: 60 });
    const user = await signIn(account, mail('ana'));
    const opened = await openAccountStore(account, { factory, timers: { set: () => 0, clear: () => {} } });
    await idle(); // boot push (nothing pending) done
    const gate = new Promise<void>((r) => (releasePush = r));
    const push = api.pushBatches.bind(api);
    const pushing = vi.spyOn(api, 'pushBatches').mockImplementation(async (b, u) => {
      await gate;
      return push(b, u);
    });
    const deletes = vi.spyOn(api, 'deleteMyData');
    await opened!.store.append([ev(user.id, 's', 0)]);
    opened!.store.close(); // the last push hangs past the first wait
    await vi.waitFor(() => expect(pushing).toHaveBeenCalled());
    await account.deleteMyData();
    await idle(); // whatever was still on the wire has landed by now
    expect(deletes).toHaveBeenCalledTimes(2);
    expect(api.batchesOf(user.id)).toEqual([]); // the push landed between the deletes, the second one removed it
    expect(await factory.databases()).toEqual([]);
  });

  it('pausing and resuming for a deletion notifies listeners', async () => {
    const api = new FakeCloudApi();
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask });
    const user = await signIn(account, mail('ana'));
    const seen: boolean[] = [];
    account.onChange(() => seen.push(account.canSync(user.id)));
    await account.deleteMyData();
    expect(seen[0]).toBe(false);
    expect(seen[seen.length - 1]).toBe(true);
  });

  it('no push for the user starts while their data is being deleted', async () => {
    const api = new FakeCloudApi();
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask });
    const user = await signIn(account, mail('ana'));
    let release!: () => void;
    // The first server delete hangs until released; the second (after the local database) answers at once.
    vi.spyOn(api, 'deleteMyData')
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined);
    const deleting = account.deleteMyData();
    await idle();
    expect(account.canSync(user.id)).toBe(false);
    release();
    await deleting;
    expect(account.canSync(user.id)).toBe(true);
  });

  it('loading lasts until the session restore settles, and notifies', async () => {
    const api = new FakeCloudApi();
    let release!: () => void;
    const getUser = api.getUser.bind(api);
    vi.spyOn(api, 'getUser').mockImplementation(async () => {
      await new Promise<void>((r) => (release = r)); // Clerk still loading
      return getUser();
    });
    const account = new Account(api, { defer: queueMicrotask });
    expect(account.loading).toBe(true);
    const seen: boolean[] = [];
    account.onChange(() => seen.push(account.loading));
    const init = account.init();
    await idle();
    expect(account.loading).toBe(true);
    release();
    await init;
    expect(account.loading).toBe(false);
    expect(account.loadError).toBeNull();
    expect(seen).toEqual([false]);
  });

  it('a failed load (Clerk unreachable) leaves the game signed out with a retryable network error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = new FakeCloudApi();
    api.signInAs(mail('ana')); // the session Clerk would find once it loads
    const getUser = vi.spyOn(api, 'getUser').mockRejectedValueOnce(new CloudError('network', 'could not load Clerk'));
    const account = new Account(api, { defer: queueMicrotask });
    await expect(account.init()).resolves.toBeUndefined();
    expect(account.loading).toBe(false);
    expect(account.loadError?.kind).toBe('network');
    expect(account.state.user).toBeNull();

    const seen: [boolean, string | null][] = [];
    account.onChange(() => seen.push([account.loading, account.loadError?.kind ?? null]));
    await account.retry();
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(account.loadError).toBeNull();
    expect(account.state.user?.email).toBe(mail('ana'));
    expect(seen[0]).toEqual([true, null]);
    expect(seen).toContainEqual([false, null]);
  });

  it('follows the auth provider: sign-in, switch to another user, sign-out; never opens the sign-in window itself', async () => {
    const api = new FakeCloudApi();
    const opens = vi.spyOn(api, 'openSignIn');
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask });
    await account.init();
    expect(account.state.user).toBeNull();
    const tokens = [account.signInToken];

    const ana = api.signInAs(mail('ana'));
    api.setAdmin(ana.id);
    await account.whenReady();
    expect(account.state).toEqual({ mode: 'cloud', user: ana, isAdmin: true, termsAccepted: false });
    tokens.push(account.signInToken);

    const bia = api.signInAs(mail('bia')); // another account, without signing out first
    expect(account.state.user).toEqual(bia);
    expect(account.state.isAdmin).toBe(false); // reset at once, before bia's details load
    expect(account.canSync(ana.id)).toBe(false);
    await account.whenReady();
    expect(account.state.isAdmin).toBe(false);
    tokens.push(account.signInToken);

    await api.signOut(); // ended in Clerk (another tab, expiry)
    expect(account.state.user).toBeNull();
    tokens.push(account.signInToken);
    expect(new Set(tokens).size).toBe(4);
    expect(opens).not.toHaveBeenCalled();
  });

  it('openSignIn asks the CloudApi (the fake signs in at once)', async () => {
    const api = new FakeCloudApi();
    const account = new Account(api, { defer: queueMicrotask });
    await account.init();
    account.openSignIn();
    await account.whenReady();
    expect(account.state.user).not.toBeNull();
  });

  it('simulated is set only with a CloudApi and the option', async () => {
    expect(new Account(null, { simulated: true }).simulated).toBe(false);
    expect(new Account(new FakeCloudApi(), { simulated: true }).simulated).toBe(true);
    expect(new Account(new FakeCloudApi()).simulated).toBe(false);
  });

  it('is found in the game registry', () => {
    const account = new Account(null);
    const values = new Map<string, unknown>([[ACCOUNT_REGISTRY_KEY, account]]);
    expect(accountFromRegistry({ get: (k) => values.get(k) })).toBe(account);
    expect(accountFromRegistry({ get: () => undefined })).toBeUndefined();
  });

  describe('offline reload: cached terms version (I6)', () => {
    function memoryStorage(): TermsStorage & { map: Map<string, string> } {
      const map = new Map<string, string>();
      return {
        map,
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => void map.set(k, v),
        removeItem: (k) => void map.delete(k),
      };
    }

    /** A reload: a new Account over the same api and storage, with the consent check failing as `kind`. */
    async function reload(api: FakeCloudApi, storage: TermsStorage, kind?: 'network' | 'other'): Promise<Account> {
      if (kind) vi.spyOn(api, 'acceptedTermsVersion').mockRejectedValue(new CloudError(kind, 'consent check failed'));
      const account = new Account(api, { defer: queueMicrotask, termsStorage: storage });
      await account.init();
      return account;
    }

    it('acceptTerms caches only the version, per user; a network failure on reload uses it', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const api = new FakeCloudApi();
      const storage = memoryStorage();
      const account = new Account(api, { defer: queueMicrotask, termsStorage: storage });
      const user = await signIn(account, mail('ana'));
      await account.acceptTerms();
      expect([...storage.map].filter(([k]) => k !== LAST_USER_KEY)).toEqual([[termsCacheKey(user.id), TERMS_VERSION]]);
      expect(termsCacheKey(user.id)).toBe(`tcc-terms-${user.id}`);

      const offline = await reload(api, storage, 'network');
      expect(offline.state.user?.id).toBe(user.id);
      expect(offline.state.termsAccepted).toBe(true);
      expect(offline.state.isAdmin).toBe(false);
    });

    it('a successful details load refreshes the cache; any other failure or another version does not count', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const api = new FakeCloudApi();
      const user = api.signInAs(mail('ana'));
      await api.acceptTerms(TERMS_VERSION);
      const storage = memoryStorage();
      expect((await reload(api, storage)).state.termsAccepted).toBe(true);
      expect(storage.getItem(termsCacheKey(user.id))).toBe(TERMS_VERSION);

      expect((await reload(api, storage, 'other')).state.termsAccepted).toBe(false);
      vi.restoreAllMocks();
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      storage.setItem(termsCacheKey(user.id), 'an-older-version');
      expect((await reload(api, storage, 'network')).state.termsAccepted).toBe(false);
      vi.restoreAllMocks();

      await api.deleteMyData(user.id); // consent gone on the server: a successful load clears the cache
      storage.setItem(termsCacheKey(user.id), TERMS_VERSION);
      expect((await reload(api, storage)).state.termsAccepted).toBe(false);
      expect(storage.getItem(termsCacheKey(user.id))).toBeNull();
    });

    it('deleteMyData clears the cache; a broken storage is ignored', async () => {
      const api = new FakeCloudApi();
      const factory = new IDBFactory() as unknown as IDBFactory;
      const storage = memoryStorage();
      const account = new Account(api, { idb: () => factory, defer: queueMicrotask, termsStorage: storage });
      const user = await signIn(account, mail('ana'));
      await account.acceptTerms();
      await account.deleteMyData();
      expect(storage.getItem(termsCacheKey(user.id))).toBeNull();

      const broken: TermsStorage = {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
      };
      const other = new Account(api, { defer: queueMicrotask, termsStorage: broken });
      await other.init();
      await other.acceptTerms();
      expect(other.state.termsAccepted).toBe(true);
    });
  });

  describe('offline reload: last signed-in user (I1)', () => {
    function memoryStorage(): TermsStorage & { map: Map<string, string> } {
      const map = new Map<string, string>();
      return {
        map,
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => void map.set(k, v),
        removeItem: (k) => void map.delete(k),
      };
    }

    /** Signs `email` in, accepts the terms, and returns the user (the browser now remembers them). */
    async function playedOnce(api: FakeCloudApi, storage: TermsStorage, email: string): Promise<CloudUser> {
      const account = new Account(api, { defer: queueMicrotask, termsStorage: storage });
      const user = await signIn(account, email);
      await account.acceptTerms();
      account.dispose();
      return user;
    }

    /** A reload while Clerk cannot load (offline, or Clerk down). */
    async function offlineReload(api: FakeCloudApi, storage: TermsStorage, idb?: IDBFactory): Promise<Account> {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(api, 'getUser').mockRejectedValue(new CloudError('network', 'could not load Clerk'));
      const account = new Account(api, { defer: queueMicrotask, termsStorage: storage, ...(idb ? { idb: () => idb } : {}) });
      await account.init();
      return account;
    }

    it('every sign-in remembers the user (id and e-mail) under tcc-last-user', async () => {
      const api = new FakeCloudApi();
      const storage = memoryStorage();
      const account = new Account(api, { defer: queueMicrotask, termsStorage: storage });
      const ana = await signIn(account, mail('ana'));
      expect(LAST_USER_KEY).toBe('tcc-last-user');
      expect(JSON.parse(storage.getItem(LAST_USER_KEY)!)).toEqual({ id: ana.id, email: ana.email });
      const bia = await signIn(account, mail('bia'));
      expect(JSON.parse(storage.getItem(LAST_USER_KEY)!)).toEqual({ id: bia.id, email: bia.email });
    });

    it('a reload with Clerk unreachable restores the last user with the saved terms: the player can play, nothing syncs', async () => {
      const api = new FakeCloudApi();
      const storage = memoryStorage();
      const factory = new IDBFactory() as unknown as IDBFactory;
      const ana = await playedOnce(api, storage, mail('ana'));
      const pushes = vi.spyOn(api, 'pushBatches');
      const terms = vi.spyOn(api, 'acceptedTermsVersion');

      const account = await offlineReload(api, storage, factory);
      expect(account.state).toEqual({ mode: 'cloud', user: ana, isAdmin: false, termsAccepted: true });
      expect(playAction(account.state)).toBe('start');
      expect(account.loadError?.kind).toBe('network');
      expect(account.canSync(ana.id)).toBe(false);
      expect(terms).not.toHaveBeenCalled(); // no session: the server is not asked

      // The game plays on the account's own database; nothing leaves the browser.
      const opened = await openAccountStore(account, { factory, timers: { set: () => 0, clear: () => {} } });
      expect(opened?.persistent).toBe(true);
      await opened!.store.append([ev(ana.id, 's', 0)]);
      opened!.store.close();
      await idle();
      expect(pushes).not.toHaveBeenCalled();
      expect((await factory.databases()).map((d) => d.name)).toEqual([accountDbName(ana.id)]);
    });

    it('the cached user never enables the admin tools, nor server actions', async () => {
      const api = new FakeCloudApi();
      const storage = memoryStorage();
      const ana = await playedOnce(api, storage, mail('ana'));
      api.setAdmin(ana.id);
      const isAdmin = vi.spyOn(api, 'isAdmin');
      const account = await offlineReload(api, storage);
      expect(account.state.user?.id).toBe(ana.id);
      expect(account.state.isAdmin).toBe(false);
      expect(isAdmin).not.toHaveBeenCalled();
      await expect(account.acceptTerms()).rejects.toMatchObject({ kind: 'network' });
      await expect(account.deleteMyData()).rejects.toMatchObject({ kind: 'network' });
      expect(api.batchesOf(ana.id)).toEqual([]); // untouched
    });

    it('without saved terms the cached user still needs the term (which needs the network)', async () => {
      const api = new FakeCloudApi();
      const storage = memoryStorage();
      const ana = await playedOnce(api, storage, mail('ana'));
      storage.removeItem(termsCacheKey(ana.id));
      const account = await offlineReload(api, storage);
      expect(account.state.user?.id).toBe(ana.id);
      expect(playAction(account.state)).toBe('terms');
    });

    it('once Clerk loads, the same user is confirmed: details from the server, sync resumes', async () => {
      const api = new FakeCloudApi();
      const storage = memoryStorage();
      const ana = await playedOnce(api, storage, mail('ana'));
      api.setAdmin(ana.id);
      const account = await offlineReload(api, storage);
      const token = account.signInToken;
      vi.mocked(api.getUser).mockRestore();
      await account.retry();
      await account.whenReady();
      expect(account.loadError).toBeNull();
      expect(account.state).toEqual({ mode: 'cloud', user: ana, isAdmin: true, termsAccepted: true });
      expect(account.canSync(ana.id)).toBe(true);
      expect(account.signInToken).toBe(token); // the same sign-in
    });

    it('when the network comes back, Clerk is loaded again by itself (only after a failed load)', async () => {
      const api = new FakeCloudApi();
      const storage = memoryStorage();
      const ana = await playedOnce(api, storage, mail('ana'));
      let online!: () => void;
      const onOnline = vi.fn((l: () => void) => {
        online = l;
        return () => {};
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const getUser = vi.spyOn(api, 'getUser').mockRejectedValueOnce(new CloudError('network', 'could not load Clerk'));
      const account = new Account(api, { defer: queueMicrotask, termsStorage: storage, onOnline });
      await account.init();
      expect(account.offline).toBe(true);
      online();
      await vi.waitFor(() => expect(account.offline).toBe(false));
      await account.whenReady();
      expect(account.canSync(ana.id)).toBe(true);
      expect(getUser).toHaveBeenCalledTimes(2);
      online(); // loaded: nothing more to do
      await idle();
      expect(getUser).toHaveBeenCalledTimes(2);
      account.dispose();
    });

    it('once Clerk reports another user, the cached one is dropped and replaced', async () => {
      const api = new FakeCloudApi();
      const storage = memoryStorage();
      const ana = await playedOnce(api, storage, mail('ana'));
      const account = await offlineReload(api, storage);
      const bia = api.signInAs(mail('bia')); // Clerk loaded (another tab signed bia in): its session wins
      expect(account.state.user).toEqual(bia);
      expect(account.state.termsAccepted).toBe(false);
      expect(account.canSync(ana.id)).toBe(false);
      expect(JSON.parse(storage.getItem(LAST_USER_KEY)!)).toEqual({ id: bia.id, email: bia.email });
      vi.mocked(api.getUser).mockRestore();
      await account.retry();
      await account.whenReady();
      expect(account.state.user).toEqual(bia);
      expect(account.canSync(bia.id)).toBe(true);
    });

    it('once Clerk loads with nobody signed in, the cached user is dropped and forgotten', async () => {
      const api = new FakeCloudApi();
      const storage = memoryStorage();
      const ana = await playedOnce(api, storage, mail('ana'));
      await api.signOut(); // ended in Clerk meanwhile (expired, another device)
      const account = await offlineReload(api, storage);
      expect(account.state.user?.id).toBe(ana.id);
      vi.mocked(api.getUser).mockRestore();
      await account.retry();
      expect(account.state.user).toBeNull();
      expect(account.canSync(ana.id)).toBe(false);
      expect(storage.getItem(LAST_USER_KEY)).toBeNull();
      expect(storage.getItem(termsCacheKey(ana.id))).toBe(TERMS_VERSION); // the saved acceptance stays for a later sign-in
    });

    it('signOut forgets the last user, online and offline', async () => {
      const api = new FakeCloudApi();
      const storage = memoryStorage();
      const account = new Account(api, { defer: queueMicrotask, termsStorage: storage });
      await signIn(account, mail('ana'));
      await account.signOut();
      expect(storage.getItem(LAST_USER_KEY)).toBeNull();

      const ana = await playedOnce(api, storage, mail('ana'));
      const offline = await offlineReload(api, storage);
      expect(offline.state.user?.id).toBe(ana.id);
      await offline.signOut();
      expect(offline.state.user).toBeNull();
      expect(storage.getItem(LAST_USER_KEY)).toBeNull();
      const again = await offlineReload(api, storage);
      expect(again.state.user).toBeNull();
    });

    describe('Sair while Clerk is not loaded (R1), with the real ClerkSession', () => {
      const CONFIG = { supabaseUrl: 'http://localhost:54321', anonKey: 'test-anon-key', clerkPublishableKey: 'test-clerk-key' };

      /** A Clerk stand-in shaped like clerk-js: its session survives until its own signOut runs. */
      class FakeClerk implements ClerkLike {
        loaded = true;
        user: ClerkLike['user'];
        private readonly listeners = new Set<() => void>();
        readonly signOut = vi.fn(async (callback?: () => unknown) => {
          this.user = null;
          for (const l of this.listeners) l();
          if (callback) await callback();
        });
        readonly openSignIn = vi.fn();
        constructor(user: CloudUser | null) {
          this.user = user ? { id: user.id, primaryEmailAddress: { emailAddress: user.email } } : null;
        }
        get session(): ClerkLike['session'] {
          return this.user ? { getToken: async () => 'token' } : null;
        }
        async load(_options: ClerkLoadOptions): Promise<void> {}
        addListener(listener: () => void): () => void {
          this.listeners.add(listener);
          listener(); // as clerk-js: an initial emit on registration
          return () => void this.listeners.delete(listener);
        }
      }

      /** Clerk's loader: offline (rejects) until `goOnline(clerk)`; `hold()` keeps the next load in flight. */
      function network() {
        let clerk: FakeClerk | null = null;
        let gate: Promise<void> | null = null;
        let release = (): void => {};
        const loader: ClerkLoader = async () => {
          if (gate) await gate;
          if (!clerk) throw new Error('offline');
          return clerk;
        };
        return {
          loader,
          goOnline: (c: FakeClerk) => void (clerk = c),
          hold: () => void (gate = new Promise<void>((r) => (release = r))),
          release: () => {
            gate = null;
            release();
          },
        };
      }

      const ANA: CloudUser = { id: 'user_ana', email: mail('ana') };

      /** A browser where ANA signed in and accepted the terms earlier. */
      function rememberedAna(): TermsStorage & { map: Map<string, string> } {
        const storage = memoryStorage();
        storage.setItem(LAST_USER_KEY, JSON.stringify(ANA));
        storage.setItem(termsCacheKey(ANA.id), TERMS_VERSION);
        return storage;
      }

      async function boot(net: ReturnType<typeof network>, storage: TermsStorage) {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })));
        let online = (): void => {};
        const api = createSupabaseCloudApi(CONFIG, createClerkSession(CONFIG.clerkPublishableKey, net.loader));
        const account = new Account(api, {
          defer: queueMicrotask,
          termsStorage: storage,
          onOnline: (l) => {
            online = l;
            return () => {};
          },
        });
        await account.init();
        return { account, online: () => online() };
      }

      afterEach(() => vi.unstubAllGlobals());

      it('the network coming back does not sign the user back in: Clerk is signed out first', async () => {
        const net = network();
        const storage = rememberedAna();
        const { account, online } = await boot(net, storage);
        expect(account.offline).toBe(true);
        await account.signOut();
        expect(account.state.user).toBeNull();
        expect(storage.getItem(SIGNOUT_PENDING_KEY)).not.toBeNull();

        const clerk = new FakeClerk(ANA); // Clerk's own session is still there
        net.goOnline(clerk);
        online();
        await vi.waitFor(() => expect(clerk.signOut).toHaveBeenCalledTimes(1));
        await account.whenReady();
        expect(typeof clerk.signOut.mock.calls[0][0]).toBe('function'); // no navigation
        expect(account.state.user).toBeNull();
        expect(account.canSync(ANA.id)).toBe(false);
        expect(storage.getItem(LAST_USER_KEY)).toBeNull();
        expect(storage.getItem(SIGNOUT_PENDING_KEY)).toBeNull();
        account.dispose();
      });

      it('the pending sign-out survives a reload', async () => {
        const net = network();
        const storage = rememberedAna();
        const first = await boot(net, storage);
        await first.account.signOut();
        first.account.dispose();

        const clerk = new FakeClerk(ANA);
        net.goOnline(clerk);
        const { account } = await boot(net, storage); // reloaded, online now
        await account.whenReady();
        expect(clerk.signOut).toHaveBeenCalledTimes(1);
        expect(account.state.user).toBeNull();
        expect(storage.getItem(SIGNOUT_PENDING_KEY)).toBeNull();
        expect(storage.getItem(LAST_USER_KEY)).toBeNull();
      });

      it('a Sair clicked while a Clerk load is in flight is not undone by that load', async () => {
        const net = network();
        const storage = rememberedAna();
        const { account } = await boot(net, storage);
        const clerk = new FakeClerk(ANA);
        net.goOnline(clerk);
        net.hold();
        const retrying = account.retry(); // e.g. the menu's retry on return
        await account.signOut();
        net.release();
        await retrying;
        await account.whenReady();
        expect(clerk.signOut).toHaveBeenCalledTimes(1);
        expect(account.state.user).toBeNull();
        expect(storage.getItem(LAST_USER_KEY)).toBeNull();
        expect(storage.getItem(SIGNOUT_PENDING_KEY)).toBeNull();
      });

      it('Clerk loading with nobody signed in just clears the pending sign-out', async () => {
        const net = network();
        const storage = rememberedAna();
        const { account, online } = await boot(net, storage);
        await account.signOut();
        const clerk = new FakeClerk(null);
        net.goOnline(clerk);
        online();
        await vi.waitFor(() => expect(storage.getItem(SIGNOUT_PENDING_KEY)).toBeNull());
        expect(clerk.signOut).not.toHaveBeenCalled();
        expect(account.state.user).toBeNull();
        expect(account.loadError).toBeNull();
      });

      it('a pending sign-out that Clerk refuses stays pending and keeps the user out', async () => {
        const net = network();
        const storage = rememberedAna();
        const { account } = await boot(net, storage);
        await account.signOut();
        const clerk = new FakeClerk(ANA);
        clerk.signOut.mockRejectedValueOnce(new Error('clerk refused'));
        net.goOnline(clerk);
        await account.retry();
        expect(account.state.user).toBeNull();
        expect(storage.getItem(SIGNOUT_PENDING_KEY)).not.toBeNull();
        expect(account.loadError).not.toBeNull(); // retryable
        await account.retry();
        expect(clerk.signOut).toHaveBeenCalledTimes(2);
        expect(account.state.user).toBeNull();
        expect(storage.getItem(SIGNOUT_PENDING_KEY)).toBeNull();
      });

      it('after the pending sign-out is done, a new sign-in is followed normally', async () => {
        const net = network();
        const storage = rememberedAna();
        const { account, online } = await boot(net, storage);
        await account.signOut();
        const clerk = new FakeClerk(ANA);
        net.goOnline(clerk);
        online();
        await vi.waitFor(() => expect(storage.getItem(SIGNOUT_PENDING_KEY)).toBeNull());
        const bia = { id: 'user_bia', primaryEmailAddress: { emailAddress: mail('bia') } };
        clerk.user = bia;
        clerk.signOut.mockClear();
        (clerk as unknown as { listeners: Set<() => void> }).listeners.forEach((l) => l());
        expect(account.state.user?.id).toBe('user_bia');
        expect(clerk.signOut).not.toHaveBeenCalled();
      });
    });

    it('a failed sign-out keeps the last user remembered', async () => {
      const api = new FakeCloudApi();
      const storage = memoryStorage();
      const account = new Account(api, { defer: queueMicrotask, termsStorage: storage });
      const ana = await signIn(account, mail('ana'));
      vi.spyOn(api, 'signOut').mockRejectedValueOnce(new CloudError('network', 'offline'));
      await expect(account.signOut()).rejects.toBeInstanceOf(CloudError);
      expect(JSON.parse(storage.getItem(LAST_USER_KEY)!).id).toBe(ana.id);
    });

    it('a non-network load failure, a broken storage or a malformed entry restore nobody', async () => {
      const api = new FakeCloudApi();
      const storage = memoryStorage();
      await playedOnce(api, storage, mail('ana'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(api, 'getUser').mockRejectedValue(new CloudError('other', 'bad key'));
      const other = new Account(api, { defer: queueMicrotask, termsStorage: storage });
      await other.init();
      expect(other.state.user).toBeNull();
      vi.restoreAllMocks();

      storage.setItem(LAST_USER_KEY, '{not json');
      expect((await offlineReload(api, storage)).state.user).toBeNull();
      storage.setItem(LAST_USER_KEY, JSON.stringify({ id: 42 }));
      expect((await offlineReload(api, storage)).state.user).toBeNull();

      const broken: TermsStorage = {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
      };
      expect((await offlineReload(api, broken)).state.user).toBeNull();
    });
  });

  it('events recorded offline stay in the account database and go out on the next boot', async () => {
    const api = new FakeCloudApi();
    const factory = new IDBFactory() as unknown as IDBFactory;
    const account = new Account(api, { idb: () => factory, defer: queueMicrotask });
    const user = await signIn(account, mail('ana'));
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
