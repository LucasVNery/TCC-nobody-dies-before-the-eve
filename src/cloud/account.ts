import { CloudError, type CloudApi, type CloudUser } from './cloudApi';
import { TERMS_VERSION } from './consentText';

export interface AccountState {
  readonly mode: 'local' | 'cloud';
  readonly user: CloudUser | null;
  readonly isAdmin: boolean;
  readonly termsAccepted: boolean;
}

/** Phaser game registry key holding the game's Account (set in main.ts). */
export const ACCOUNT_REGISTRY_KEY = 'account';

export function accountFromRegistry(registry: { get(key: string): unknown }): Account | undefined {
  const value = registry.get(ACCOUNT_REGISTRY_KEY);
  return value instanceof Account ? value : undefined;
}

/** Each account has its own local database, so two accounts in one browser never share events or sync progress. */
export function accountDbName(userId: string): string {
  return `tcc-telemetry-${userId}`;
}

/** Longest wait for the last background pushes before signing out or deleting the account's data. */
const SETTLE_TIMEOUT_MS = 4000;

export interface AccountOptions {
  /** The consent version an account must have accepted; default TERMS_VERSION. */
  termsVersion?: string;
  /** IndexedDB holding the per-account databases; default the global one, read only when needed. */
  idb?: () => IDBFactory;
  /**
   * Runs work outside an auth-change callback: supabase-js deadlocks when such a callback
   * awaits another client call. Default: a zero-delay timeout.
   */
  defer?: (run: () => void) => void;
  settleTimeoutMs?: number;
}

const NO_CLOUD = (): CloudError => new CloudError('other', 'cloud mode is off');

function deleteDatabase(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = factory.deleteDatabase(name);
    // A blocked delete stays pending until the open connections close; it is not a failure.
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * The player's account, one per game (created in main.ts). Without a CloudApi it is in local mode:
 * no user, and every cloud action rejects. In cloud mode it follows the auth session through
 * onAuthChange, so a session lost mid-game only flips `user` to null (sync pauses, the game goes on)
 * and a renewed one brings it back.
 */
export class Account {
  private _state: AccountState;
  private readonly listeners = new Set<(state: AccountState) => void>();
  private readonly termsVersion: string;
  private readonly idb: () => IDBFactory;
  private readonly defer: (run: () => void) => void;
  private readonly settleTimeoutMs: number;
  private initing: Promise<void> | null = null;
  private unsubscribeAuth: (() => void) | null = null;
  /** Bumped on every user change: details loaded for a previous user drop their result. */
  private userToken = 0;
  private details: { token: number; promise: Promise<void> } | null = null;
  /** Background work (a closing store's last push) that sign-out and data deletion wait for. */
  private readonly background = new Set<Promise<unknown>>();
  /** The user whose data is being deleted: no push for them starts meanwhile. */
  private deleting: string | null = null;

  constructor(private readonly api: CloudApi | null, opts: AccountOptions = {}) {
    this._state = { mode: api ? 'cloud' : 'local', user: null, isAdmin: false, termsAccepted: false };
    this.termsVersion = opts.termsVersion ?? TERMS_VERSION;
    this.idb = opts.idb ?? (() => indexedDB);
    this.defer = opts.defer ?? ((run) => void setTimeout(run, 0));
    this.settleTimeoutMs = opts.settleTimeoutMs ?? SETTLE_TIMEOUT_MS;
  }

  get mode(): 'local' | 'cloud' {
    return this._state.mode;
  }

  get state(): AccountState {
    return this._state;
  }

  /** The cloud client, null in local mode (for the sync wiring). */
  get cloud(): CloudApi | null {
    return this.api;
  }

  /** Restores a stored session; never rejects. Idempotent. */
  init(): Promise<void> {
    if (!this.initing) this.initing = this.restore();
    return this.initing;
  }

  private async restore(): Promise<void> {
    const api = this.api;
    if (!api) return;
    this.unsubscribeAuth = api.onAuthChange((user) => this.onAuth(user));
    let user: CloudUser | null = null;
    try {
      user = await api.getUser();
    } catch (err) {
      console.warn('[account] could not restore the session', err);
    }
    if (user) {
      this.setUser(user);
      await this.loadDetails(this.userToken);
    }
  }

  /** Synchronous on purpose (see AccountOptions.defer): only the state changes here. */
  private onAuth(user: CloudUser | null): void {
    if (!this.setUser(user) || !user) return;
    const token = this.userToken;
    this.defer(() => void this.loadDetails(token));
  }

  /** True when the user changed (not just a token refresh of the same one). */
  private setUser(user: CloudUser | null): boolean {
    const cur = this._state.user;
    if (cur?.id === user?.id) {
      if (cur && user && cur.email !== user.email) this.update({ user });
      return false;
    }
    this.userToken++;
    this.details = null;
    this.update({ user, isAdmin: false, termsAccepted: false });
    return true;
  }

  /** One load per user; never rejects (a failed load leaves isAdmin/termsAccepted false). */
  private loadDetails(token: number): Promise<void> {
    if (this.details?.token === token) return this.details.promise;
    const api = this.api;
    if (!api || token !== this.userToken || !this._state.user) return Promise.resolve();
    const promise = (async () => {
      const [admin, terms] = await Promise.allSettled([api.isAdmin(), api.acceptedTermsVersion()]);
      if (admin.status === 'rejected') console.warn('[account] could not check the admin role', admin.reason);
      if (terms.status === 'rejected') console.warn('[account] could not check the consent', terms.reason);
      if (token !== this.userToken) return;
      this.update({
        isAdmin: admin.status === 'fulfilled' && admin.value,
        termsAccepted: terms.status === 'fulfilled' && terms.value === this.termsVersion,
      });
    })();
    this.details = { token, promise };
    return promise;
  }

  /** Reloads isAdmin and termsAccepted for the current user (after a failed load). */
  refresh(): Promise<void> {
    this.details = null;
    return this.loadDetails(this.userToken);
  }

  async signIn(email: string, password: string): Promise<CloudUser> {
    const api = this.requireApi();
    const user = await api.signIn(email, password);
    this.setUser(user);
    await this.loadDetails(this.userToken);
    return user;
  }

  async signUp(email: string, password: string): Promise<{ needsEmailConfirmation: boolean }> {
    return this.requireApi().signUp(email, password);
  }

  async resetPassword(email: string): Promise<void> {
    return this.requireApi().resetPassword(email);
  }

  /** Lets the last pushes go out first (bounded), then ends the session. The account's local database is kept. */
  async signOut(): Promise<void> {
    const api = this.requireApi();
    await this.settle();
    await api.signOut();
    this.setUser(null);
  }

  async acceptTerms(): Promise<void> {
    const api = this.requireApi();
    if (!this._state.user) throw new CloudError('auth', 'not signed in');
    const token = this.userToken;
    await api.acceptTerms(this.termsVersion);
    if (token === this.userToken) this.update({ termsAccepted: true });
  }

  /**
   * Deletes the user's cloud data (batches and consents), then the account's local database
   * (events and sync progress), so nothing is pushed back. No push for this user starts meanwhile.
   * Call it with no game running (from the menu).
   */
  async deleteMyData(): Promise<void> {
    const api = this.requireApi();
    const user = this._state.user;
    if (!user) throw new CloudError('auth', 'not signed in');
    const token = this.userToken;
    this.deleting = user.id;
    this.update({}); // canSync changed: open stores pause
    try {
      await this.settle();
      // A last push still running past the wait could land after the server delete.
      const lingering = this.background.size > 0;
      await api.deleteMyData();
      // Resolves only once every connection closed, so every tracked last push has ended.
      await deleteDatabase(this.idb(), accountDbName(user.id));
      if (lingering) await api.deleteMyData(); // idempotent: removes whatever such a push brought back
      if (token === this.userToken) this.update({ termsAccepted: false });
    } finally {
      this.deleting = null;
      this.update({}); // canSync changed back: open stores resume
    }
  }

  /** Whether events of `userId` may be pushed now: that user is signed in and not deleting their data. */
  canSync(userId: string): boolean {
    return this._state.user?.id === userId && this.deleting !== userId;
  }

  /** Registers background work that sign-out and data deletion wait for. */
  track(work: Promise<unknown>): void {
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    this.background.add(settled);
    void settled.then(() => this.background.delete(settled));
  }

  /** Waits for the tracked background work, at most settleTimeoutMs. */
  private async settle(): Promise<void> {
    if (this.background.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.settleTimeoutMs);
    });
    try {
      await Promise.race([Promise.all([...this.background]), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Returns the unsubscribe function. */
  onChange(listener: (state: AccountState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = null;
    this.listeners.clear();
  }

  private requireApi(): CloudApi {
    if (!this.api) throw NO_CLOUD();
    return this.api;
  }

  private update(patch: Partial<AccountState>): void {
    this._state = { ...this._state, ...patch };
    const state = this._state;
    for (const l of [...this.listeners]) {
      try {
        l(state);
      } catch (err) {
        console.warn('[account] change listener failed', err);
      }
    }
  }
}
