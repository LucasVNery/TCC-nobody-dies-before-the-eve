import { CloudError, type AuthChangeEvent, type CloudApi, type CloudUser } from './cloudApi';
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
/** Longest wait for a local-database deletion that another connection (an old tab) holds up. */
export const DELETE_BLOCKED_TIMEOUT_MS = 3000;

/** Per-user localStorage key holding only the accepted terms version (lets an offline reload play). */
export function termsCacheKey(userId: string): string {
  return `tcc-terms-${userId}`;
}

/** The slice of Web Storage the terms cache uses. */
export interface TermsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Messages between tabs of the game (BroadcastChannel in the browser). */
export interface AccountMessage {
  kind: 'data-deleted';
  userId: string;
}
export interface AccountChannel {
  post(message: AccountMessage): void;
  /** Returns the unsubscribe function. */
  subscribe(listener: (message: unknown) => void): () => void;
}

/** The browser's channel between tabs of the game, or undefined where BroadcastChannel is missing. */
export function browserAccountChannel(): AccountChannel | undefined {
  try {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const ch = new BroadcastChannel('tcc-account');
    return {
      post: (m) => ch.postMessage(m),
      subscribe: (listener) => {
        const onMessage = (e: MessageEvent): void => listener(e.data);
        ch.addEventListener('message', onMessage);
        return () => ch.removeEventListener('message', onMessage);
      },
    };
  } catch {
    return undefined;
  }
}

function isDeletedMessage(m: unknown): m is AccountMessage {
  return typeof m === 'object' && m !== null && (m as AccountMessage).kind === 'data-deleted' && typeof (m as AccountMessage).userId === 'string';
}

/** The local account database could not be deleted because another connection keeps it open. */
export class LocalDataBlockedError extends Error {
  constructor() {
    super('Os dados na nuvem foram apagados, mas os deste navegador não: feche as outras abas do jogo e tente de novo.');
    this.name = 'LocalDataBlockedError';
  }
}

function defaultTermsStorage(): TermsStorage | undefined {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

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
  /** The CloudApi is the in-memory fake (development `?cloud=fake`); the menu says so. */
  simulated?: boolean;
  /** Where the accepted terms version is cached per user; default the browser's localStorage (none outside a browser). */
  termsStorage?: TermsStorage;
  /** Channel to the game's other tabs (a data deletion is announced there); default none. */
  channel?: AccountChannel;
  deleteBlockedTimeoutMs?: number;
}

const NO_CLOUD = (): CloudError => new CloudError('other', 'cloud mode is off');

/**
 * Deletes a database. Our own connections close on `versionchange`, so a block means a connection that
 * does not (another tab running an older build): wait at most `blockedTimeoutMs` after the block, then
 * reject with LocalDataBlockedError (the request stays queued and completes once that tab closes).
 */
function deleteDatabase(factory: IDBFactory, name: string, blockedTimeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const req = factory.deleteDatabase(name);
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve();
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error);
    };
    req.onblocked = () => {
      if (timer === undefined) timer = setTimeout(() => reject(new LocalDataBlockedError()), blockedTimeoutMs);
    };
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
  /** The session came from a password-recovery link and no new password was set yet. */
  private recovering = false;
  private readonly termsStorage: TermsStorage | undefined;
  private readonly channel: AccountChannel | undefined;
  private unsubscribeChannel: (() => void) | null = null;
  private readonly deleteBlockedTimeoutMs: number;
  readonly simulated: boolean;

  constructor(private readonly api: CloudApi | null, opts: AccountOptions = {}) {
    this._state = { mode: api ? 'cloud' : 'local', user: null, isAdmin: false, termsAccepted: false };
    this.simulated = api !== null && (opts.simulated ?? false);
    this.termsVersion = opts.termsVersion ?? TERMS_VERSION;
    this.idb = opts.idb ?? (() => indexedDB);
    this.defer = opts.defer ?? ((run) => void setTimeout(run, 0));
    this.settleTimeoutMs = opts.settleTimeoutMs ?? SETTLE_TIMEOUT_MS;
    this.termsStorage = 'termsStorage' in opts ? opts.termsStorage : defaultTermsStorage();
    this.channel = api ? opts.channel : undefined;
    this.deleteBlockedTimeoutMs = opts.deleteBlockedTimeoutMs ?? DELETE_BLOCKED_TIMEOUT_MS;
    this.unsubscribeChannel = this.channel?.subscribe((m) => this.onChannel(m)) ?? null;
  }

  /**
   * Changes on every change of signed-in user (sign-in, sign-out, another account), not on a token
   * refresh of the same user: "this sign-in" for work done once per sign-in (the pull).
   */
  get signInToken(): number {
    return this.userToken;
  }

  /** Another tab deleted this user's data: the consent is gone here too (its open stores were closed by the deletion). */
  private onChannel(message: unknown): void {
    if (!isDeletedMessage(message) || this._state.user?.id !== message.userId) return;
    this.forgetTerms(message.userId);
    this.update({ termsAccepted: false });
  }

  private cachedTerms(userId: string): string | null {
    try {
      return this.termsStorage?.getItem(termsCacheKey(userId)) ?? null;
    } catch {
      return null;
    }
  }

  private rememberTerms(userId: string, version: string): void {
    try {
      this.termsStorage?.setItem(termsCacheKey(userId), version);
    } catch {
      // storage full or blocked: the cache is a convenience only
    }
  }

  private forgetTerms(userId: string): void {
    try {
      this.termsStorage?.removeItem(termsCacheKey(userId));
    } catch {
      // see rememberTerms
    }
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
    this.unsubscribeAuth = api.onAuthChange((user, event) => this.onAuth(user, event));
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
  private onAuth(user: CloudUser | null, event: AuthChangeEvent = 'other'): void {
    const wasRecovering = this.recovering;
    if (!user) this.recovering = false;
    else if (event === 'recovery') this.recovering = true;
    if (!this.setUser(user)) {
      if (this.recovering !== wasRecovering) this.update({});
      return;
    }
    if (!user) return;
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

  /**
   * One load per user; never rejects (a failed load leaves isAdmin false). termsAccepted comes from
   * the server; only when that check fails for lack of network does the version cached on this
   * browser count (an offline reload can still play). Any other failure leaves it false.
   */
  private loadDetails(token: number): Promise<void> {
    if (this.details?.token === token) return this.details.promise;
    const api = this.api;
    const user = this._state.user;
    if (!api || token !== this.userToken || !user) return Promise.resolve();
    const promise = (async () => {
      const [admin, terms] = await Promise.allSettled([api.isAdmin(), api.acceptedTermsVersion()]);
      if (admin.status === 'rejected') console.warn('[account] could not check the admin role', admin.reason);
      if (terms.status === 'rejected') console.warn('[account] could not check the consent', terms.reason);
      if (token !== this.userToken) return;
      let termsAccepted = false;
      if (terms.status === 'fulfilled') {
        termsAccepted = terms.value === this.termsVersion;
        if (termsAccepted) this.rememberTerms(user.id, this.termsVersion);
        else this.forgetTerms(user.id);
      } else if (terms.reason instanceof CloudError && terms.reason.kind === 'network') {
        termsAccepted = this.cachedTerms(user.id) === this.termsVersion;
      }
      this.update({ isAdmin: admin.status === 'fulfilled' && admin.value, termsAccepted });
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

  /** True while the session came from a password-recovery link and no new password was set (the menu asks for one). */
  get passwordRecovery(): boolean {
    return this.recovering;
  }

  /** Sets the signed-in user's new password; ends the recovery state. The password is not kept. */
  async updatePassword(newPassword: string): Promise<void> {
    const api = this.requireApi();
    if (!this._state.user) throw new CloudError('auth', 'not signed in');
    await api.updatePassword(newPassword);
    this.dismissPasswordRecovery();
  }

  /** The player chose not to set a new password now. */
  dismissPasswordRecovery(): void {
    if (!this.recovering) return;
    this.recovering = false;
    this.update({});
  }

  /** Lets the last pushes go out first (bounded), then ends the session. The account's local database is kept. */
  async signOut(): Promise<void> {
    const api = this.requireApi();
    await this.settle();
    await api.signOut();
    this.recovering = false;
    this.setUser(null);
  }

  async acceptTerms(): Promise<void> {
    const api = this.requireApi();
    const user = this._state.user;
    if (!user) throw new CloudError('auth', 'not signed in');
    const token = this.userToken;
    await api.acceptTerms(this.termsVersion);
    this.rememberTerms(user.id, this.termsVersion);
    if (token === this.userToken) this.update({ termsAccepted: true });
  }

  /**
   * Deletes the user's cloud data (batches and consents; the server refuses unless the session is
   * this user), then the account's local database (events and sync progress), so nothing is pushed
   * back. No push for this user starts meanwhile in this tab; other tabs have their connection closed
   * by the deletion (versionchange), and are told through the channel. The pre-login database is not
   * touched. Call it with no game running (from the menu). Rejects with LocalDataBlockedError when an
   * old tab keeps the local database open (the cloud part is done; calling again finishes it).
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
      await api.deleteMyData(user.id);
      this.forgetTerms(user.id);
      if (token === this.userToken) this.update({ termsAccepted: false });
      // Resolves once every connection closed. Connections close themselves on versionchange, so this
      // no longer means a last push of this tab has ended: it may still be on the wire.
      await deleteDatabase(this.idb(), accountDbName(user.id), this.deleteBlockedTimeoutMs);
      // Wait again (bounded) for this tab's last pushes, so the second delete runs after they landed.
      await this.settle();
      // Idempotent: removes whatever such a push (or another tab's) brought back.
      await api.deleteMyData(user.id);
      try {
        this.channel?.post({ kind: 'data-deleted', userId: user.id });
      } catch (err) {
        console.warn('[account] could not tell the other tabs', err);
      }
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
    this.unsubscribeChannel?.();
    this.unsubscribeChannel = null;
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
