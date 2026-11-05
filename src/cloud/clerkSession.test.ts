import { describe, it, expect, vi, afterEach } from 'vitest';
import { clerkFrontendHost, createClerkLoader, createClerkSession, type ClerkLike, type ClerkLoader, type ClerkLoadOptions } from './clerkSession';
import { CloudError } from './cloudApi';

const KEY = 'test-clerk-key';
// Built at runtime: no e-mail literals in the repo.
const mail = (name: string): string => [name, 'test.invalid'].join('@');

afterEach(() => vi.restoreAllMocks());

/** A Clerk stand-in: the test drives its user, token and listeners. */
class FakeClerk implements ClerkLike {
  loaded = true;
  user: ClerkLike['user'] = null;
  readonly load = vi.fn(async (_options: ClerkLoadOptions) => {});
  token: string | null = null;
  tokenError: Error | null = null;
  readonly listeners = new Set<() => void>();
  readonly openSignIn = vi.fn();
  readonly signOut = vi.fn(async () => {
    this.setUser(null);
  });

  get session(): ClerkLike['session'] {
    if (!this.user) return null;
    return {
      getToken: async () => {
        if (this.tokenError) throw this.tokenError;
        return this.token;
      },
    };
  }

  addListener(listener: () => void): () => void {
    this.listeners.add(listener);
    listener(); // as Clerk: an initial emit on registration
    return () => void this.listeners.delete(listener);
  }

  setUser(user: ClerkLike['user']): void {
    this.user = user;
    for (const l of this.listeners) l();
  }
}

function deferredLoader(clerk: FakeClerk) {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const calls: string[] = [];
  const loader: ClerkLoader = (key) => {
    calls.push(key);
    return new Promise<ClerkLike>((res, rej) => {
      resolve = () => res(clerk);
      reject = rej;
    });
  };
  return { loader, calls, resolve: () => resolve(), reject: (e: Error) => reject(e) };
}

describe('createClerkSession', () => {
  it('is empty until Clerk loads: no user, no token, sign-in window not opened, sign-out a no-op', async () => {
    const clerk = new FakeClerk();
    clerk.user = { id: 'user_ana', primaryEmailAddress: { emailAddress: mail('ana') } };
    clerk.token = 'token-1';
    const d = deferredLoader(clerk);
    const session = createClerkSession(KEY, d.loader);
    expect(d.calls).toEqual([]); // nothing loads before load()
    const loading = session.load();
    expect(d.calls).toEqual([KEY]);
    expect(session.getUser()).toBeNull();
    expect(await session.getToken()).toBeNull();
    session.openSignIn();
    expect(clerk.openSignIn).not.toHaveBeenCalled();
    await session.signOut();
    expect(clerk.signOut).not.toHaveBeenCalled();

    d.resolve();
    await loading;
    expect(session.getUser()).toEqual({ id: 'user_ana', email: mail('ana') });
    expect(await session.getToken()).toBe('token-1');
  });

  it('a slow load is shared by concurrent callers and runs once', async () => {
    const clerk = new FakeClerk();
    const d = deferredLoader(clerk);
    const session = createClerkSession(KEY, d.loader);
    const a = session.load();
    const b = session.load();
    d.resolve();
    await Promise.all([a, b]);
    await session.load();
    expect(d.calls).toHaveLength(1);
  });

  it('a failed load rejects with a network CloudError, and the next load tries again', async () => {
    const clerk = new FakeClerk();
    const d = deferredLoader(clerk);
    const session = createClerkSession(KEY, d.loader);
    const first = session.load();
    d.reject(new Error('offline'));
    await expect(first).rejects.toSatisfy((e: unknown) => e instanceof CloudError && e.kind === 'network');
    const second = session.load();
    expect(d.calls).toHaveLength(2);
    d.resolve();
    await expect(second).resolves.toBeUndefined();
  });

  it('a loader that throws synchronously is a network error too', async () => {
    const session = createClerkSession(KEY, () => {
      throw new Error('boom');
    });
    await expect(session.load()).rejects.toMatchObject({ kind: 'network' });
  });

  it('no signed-in user: getUser and getToken are null; a user without e-mail has a null e-mail', async () => {
    const clerk = new FakeClerk();
    const session = createClerkSession(KEY, async () => clerk);
    await session.load();
    expect(session.getUser()).toBeNull();
    expect(await session.getToken()).toBeNull();
    clerk.setUser({ id: 'user_bia', primaryEmailAddress: null });
    expect(session.getUser()).toEqual({ id: 'user_bia', email: null });
  });

  it('getToken asks Clerk on every call and resolves null instead of throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clerk = new FakeClerk();
    clerk.user = { id: 'user_ana' };
    const session = createClerkSession(KEY, async () => clerk);
    await session.load();
    clerk.token = 'token-1';
    expect(await session.getToken()).toBe('token-1');
    clerk.token = 'token-2'; // refreshed by Clerk
    expect(await session.getToken()).toBe('token-2');
    clerk.token = '';
    expect(await session.getToken()).toBeNull();
    clerk.tokenError = new Error('network down');
    expect(await session.getToken()).toBeNull();
  });

  it('every session change reaches the listeners (the initial one included) until unsubscribed', async () => {
    const clerk = new FakeClerk();
    const session = createClerkSession(KEY, async () => clerk);
    const seen: (string | null)[] = [];
    const off = session.onChange(() => seen.push(session.getUser()?.id ?? null));
    await session.load();
    clerk.setUser({ id: 'user_ana' });
    clerk.setUser({ id: 'user_bia' });
    await session.signOut();
    expect(clerk.signOut).toHaveBeenCalledTimes(1);
    off();
    clerk.setUser({ id: 'user_ana' });
    expect(seen).toEqual([null, 'user_ana', 'user_bia', null]);
  });

  it('a failing listener does not break the others', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clerk = new FakeClerk();
    const session = createClerkSession(KEY, async () => clerk);
    const ok = vi.fn();
    session.onChange(() => {
      throw new Error('boom');
    });
    session.onChange(ok);
    await session.load();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('openSignIn opens Clerk once loaded and swallows its refusal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clerk = new FakeClerk();
    const session = createClerkSession(KEY, async () => clerk);
    await session.load();
    session.openSignIn();
    expect(clerk.openSignIn).toHaveBeenCalledTimes(1);
    clerk.openSignIn.mockImplementation(() => {
      throw new Error('already signed in');
    });
    expect(() => session.openSignIn()).not.toThrow();
  });

  it('signOut passes a Clerk failure on', async () => {
    const clerk = new FakeClerk();
    const session = createClerkSession(KEY, async () => clerk);
    await session.load();
    clerk.signOut.mockRejectedValueOnce(new Error('offline'));
    await expect(session.signOut()).rejects.toThrow('offline');
  });
});

describe('clerkFrontendHost', () => {
  it('decodes the host from the key and refuses a malformed key', () => {
    // A made-up key in Clerk's shape, built at runtime (no key-like literal in the repo).
    const keyFor = (host: string): string => ['pk', 'test', btoa(host)].join('_');
    expect(clerkFrontendHost(keyFor('clerk.example.test$'))).toBe('clerk.example.test');
    expect(() => clerkFrontendHost('test-clerk-key')).toThrow();
    expect(() => clerkFrontendHost(keyFor('no-dollar'))).toThrow();
  });
});

describe('createClerkLoader', () => {
  const UI = { name: 'fake-ui-ctor' };

  /** A fake Clerk class whose instances' load() succeeds or gives up quietly, as the test says. */
  function fakeDeps(opts: { loads?: boolean[]; ui?: (() => Promise<unknown>)[] } = {}) {
    const instances: FakeClerk[] = [];
    const loads = [...(opts.loads ?? [true])];
    const uiAnswers = [...(opts.ui ?? [async () => UI])];
    const loadUi = vi.fn(async (_key: string) => (uiAnswers.shift() ?? (async () => UI))());
    const ClerkClass = vi.fn(function (this: unknown, _key: string) {
      const clerk = new FakeClerk();
      clerk.loaded = false;
      clerk.load.mockImplementation(async () => {
        clerk.loaded = loads.shift() ?? true;
      });
      instances.push(clerk);
      return clerk;
    });
    const deps = {
      importClerk: async () => ClerkClass as unknown as new (key: string) => ClerkLike,
      loadUi,
    };
    return { deps, instances, ClerkClass, loadUi };
  }

  it('loads Clerk with the UI and telemetry off', async () => {
    const f = fakeDeps();
    const clerk = await createClerkLoader(f.deps)(KEY);
    expect(f.ClerkClass).toHaveBeenCalledWith(KEY);
    expect(f.instances[0].load).toHaveBeenCalledWith({ ui: { ClerkUI: UI }, telemetry: false });
    expect(clerk).toBe(f.instances[0]);
  });

  it('a load() that resolves without loading (offline) is a network error; the retry reuses the instance', async () => {
    const f = fakeDeps({ loads: [false, true] });
    const session = createClerkSession(KEY, createClerkLoader(f.deps));
    await expect(session.load()).rejects.toSatisfy((e: unknown) => e instanceof CloudError && e.kind === 'network');
    expect(session.getUser()).toBeNull();
    await expect(session.load()).resolves.toBeUndefined();
    expect(f.ClerkClass).toHaveBeenCalledTimes(1); // one instance: no second set of pollers
    expect(f.instances[0].load).toHaveBeenCalledTimes(2);
    expect(f.loadUi).toHaveBeenCalledTimes(1); // the UI registered on the first try
  });

  it('a UI bundle that failed is fetched again on the retry, once it worked it is not', async () => {
    const f = fakeDeps({ ui: [async () => Promise.reject(new Error('blocked')), async () => UI] });
    const loader = createClerkLoader(f.deps);
    await expect(loader(KEY)).rejects.toThrow('blocked');
    await loader(KEY);
    await loader(KEY);
    expect(f.loadUi).toHaveBeenCalledTimes(2);
    expect(f.ClerkClass).toHaveBeenCalledTimes(1);
    expect(f.instances[0].load).toHaveBeenCalledTimes(1); // already loaded: not loaded again
  });
});
