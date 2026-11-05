import { CloudError } from './cloudApi';

/** The signed-in Clerk user, as the game needs it. */
export interface ClerkSessionUser {
  id: string;
  email: string | null;
}

/**
 * The game's view of Clerk: who is signed in and the session token for Supabase. Never throws to
 * callers except load() (CloudError('network'), retryable), getToken() (CloudError('network') when offline)
 * and signOut() (the Clerk error).
 */
export interface ClerkSession {
  /** Loads Clerk once; a failed load rejects with CloudError('network') and the next call tries again. */
  load(): Promise<void>;
  /** null while Clerk is not loaded or nobody is signed in. */
  getUser(): ClerkSessionUser | null;
  /**
   * The current session token (Clerk caches and refreshes it); null when there is no session or Clerk
   * refuses one. Rejects only with CloudError('network'), when the token could not be fetched for lack of
   * network (clerk-js's ClerkOfflineError, or any failure while the browser reports itself offline).
   */
  getToken(): Promise<string | null>;
  /** Opens Clerk's sign-in window; does nothing while Clerk is not loaded. */
  openSignIn(): void;
  signOut(): Promise<void>;
  /** Called on every change of Clerk's session (sign-in, sign-out, token refresh). Returns the unsubscribe function. */
  onChange(listener: () => void): () => void;
}

/** The slice of `@clerk/clerk-js`'s Clerk the session uses (lets tests inject a fake). */
export interface ClerkLike {
  /** False when load() gave up quietly (offline, or a bot-like browser): Clerk is not usable then. */
  readonly loaded: boolean;
  readonly user: { id: string; primaryEmailAddress?: { emailAddress: string } | null } | null | undefined;
  readonly session: { getToken(): Promise<string | null> } | null | undefined;
  load(options: ClerkLoadOptions): Promise<void>;
  openSignIn(): void;
  /** With a callback, clerk-js calls it after signing out instead of navigating to its after-sign-out URL. */
  signOut(callback?: () => void | Promise<unknown>): Promise<void>;
  addListener(listener: () => void): () => void;
}

/** clerk-js's ClerkOfflineError code (`ClerkOfflineError.is` checks it too, across bundles). */
const CLERK_OFFLINE_CODE = 'clerk_offline';

/** A token failure caused by the connection: Clerk's offline error, or any failure while the browser is offline. */
function isOfflineError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === CLERK_OFFLINE_CODE) return true;
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

/** The options the game passes to Clerk's load(). */
export interface ClerkLoadOptions {
  ui: { ClerkUI: unknown };
  /** Privacy: Clerk's SDK telemetry stays off (nothing goes to Clerk's telemetry endpoint). */
  telemetry: false;
}

/** Creates (if needed) and loads a Clerk instance for the publishable key; rejects unless it ends up loaded. */
export type ClerkLoader = (publishableKey: string) => Promise<ClerkLike>;

/** What the loader needs from the browser (fakes in tests). */
export interface ClerkLoaderDeps {
  /** The Clerk class (clerk-js, imported on demand). */
  importClerk(): Promise<new (publishableKey: string) => ClerkLike>;
  /** The constructor of Clerk's prebuilt UI (`@clerk/ui`). */
  loadUi(publishableKey: string): Promise<unknown>;
}

/** Clerk's Frontend API host, encoded in the publishable key (`pk_<env>_<base64(host + '$')>`). */
export function clerkFrontendHost(publishableKey: string): string {
  const encoded = publishableKey.split('_')[2];
  if (!encoded) throw new Error('malformed Clerk publishable key');
  const decoded = atob(encoded);
  if (!decoded.endsWith('$')) throw new Error('malformed Clerk publishable key');
  return decoded.slice(0, -1);
}

/**
 * A loader that is cheap to retry: one Clerk instance for the page (its load() runs again while it is
 * not loaded, so no second set of pollers or channels), and the UI bundle fetched until it registers once.
 */
export function createClerkLoader(deps: ClerkLoaderDeps): ClerkLoader {
  let instance: ClerkLike | null = null;
  let ui: Promise<unknown> | null = null;
  return async (publishableKey) => {
    if (!ui) {
      ui = deps.loadUi(publishableKey);
      ui.catch(() => (ui = null)); // the next try fetches it again
    }
    const [Clerk, ClerkUI] = await Promise.all([deps.importClerk(), ui]);
    if (!instance) instance = new Clerk(publishableKey);
    const clerk = instance;
    if (!clerk.loaded) await clerk.load({ ui: { ClerkUI }, telemetry: false });
    // clerk-js gives up quietly (a console warning, load() resolves) when offline: not usable.
    if (!clerk.loaded) throw new Error('Clerk did not finish loading');
    return clerk;
  };
}

type UiWindow = Window & { __internal_ClerkUICtor?: unknown };

/** The Clerk JS quickstart: the prebuilt UI comes from the instance's Frontend API host, once per page. */
function loadBrowserUi(publishableKey: string): Promise<unknown> {
  const w = window as UiWindow;
  if (w.__internal_ClerkUICtor) return Promise.resolve(w.__internal_ClerkUICtor);
  const host = clerkFrontendHost(publishableKey);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://${host}/npm/@clerk/ui@1/dist/ui.browser.js`;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      if (w.__internal_ClerkUICtor) resolve(w.__internal_ClerkUICtor);
      else reject(new Error('the Clerk UI bundle did not register itself'));
    };
    script.onerror = () => {
      script.remove(); // a retry appends a fresh one
      reject(new Error('failed to load the Clerk UI bundle'));
    };
    document.head.appendChild(script);
  });
}

/** The browser loader: clerk-js is imported on demand, so local mode never downloads it. */
const browserClerkLoader: ClerkLoader = createClerkLoader({
  importClerk: async () => (await import('@clerk/clerk-js')).Clerk as unknown as new (key: string) => ClerkLike,
  loadUi: loadBrowserUi,
});

export function createClerkSession(publishableKey: string, loader: ClerkLoader = browserClerkLoader): ClerkSession {
  let clerk: ClerkLike | null = null;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const l of [...listeners]) {
      try {
        l();
      } catch (err) {
        console.warn('[clerk] session listener failed', err);
      }
    }
  }

  function load(): Promise<void> {
    if (clerk) return Promise.resolve();
    if (!loading) {
      loading = (async () => {
        try {
          const loaded = await loader(publishableKey);
          clerk = loaded;
          // Emits once at registration (the session found on load), then on every change.
          loaded.addListener(emit);
        } catch (err) {
          loading = null; // the next load() tries again
          const reason = err instanceof Error ? err.message : String(err);
          throw new CloudError('network', `could not load Clerk: ${reason}`);
        }
      })();
    }
    return loading;
  }

  return {
    load,

    getUser() {
      const user = clerk?.user;
      return user ? { id: user.id, email: user.primaryEmailAddress?.emailAddress ?? null } : null;
    },

    async getToken() {
      const session = clerk?.session;
      if (!session) return null;
      try {
        return (await session.getToken()) || null;
      } catch (err) {
        console.warn('[clerk] could not get the session token', err);
        // The connection, not the session: callers must see 'network' (an offline reload uses the saved terms).
        if (isOfflineError(err)) throw new CloudError('network', 'could not get the session token: offline');
        return null;
      }
    },

    openSignIn() {
      if (!clerk) return;
      try {
        clerk.openSignIn();
      } catch (err) {
        // e.g. Clerk refuses (in development, loudly) to open the sign-in window for a signed-in user.
        console.warn('[clerk] could not open the sign-in window', err);
      }
    },

    async signOut() {
      if (!clerk) return;
      // With a callback clerk-js runs it instead of navigating to its after-sign-out URL (a full reload
      // to '/'): the page stays, with the menu's "Você saiu da conta." notice and the path and query.
      await clerk.signOut(() => {});
    },

    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
