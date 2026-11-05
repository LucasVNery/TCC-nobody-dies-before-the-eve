import type { LoggedEvent } from '../telemetry/schema';
import { CloudError, type AuthChangeEvent, type CloudApi, type CloudUser, type EventBatch } from './cloudApi';

interface Account {
  user: CloudUser;
  password: string;
  terms: string | null;
  /** Keyed by `${sessionId}:${firstSeq}`, mirroring the server's unique key. */
  batches: Map<string, EventBatch>;
}

/** In-memory CloudApi for tests and offline development. */
export class FakeCloudApi implements CloudApi {
  private accounts = new Map<string, Account>(); // by email
  private current: Account | null = null;
  private admins = new Set<string>();
  private listeners = new Set<(user: CloudUser | null, event?: AuthChangeEvent) => void>();
  private failures = 0;
  private nextId = 1;

  constructor(private readonly opts: { needsEmailConfirmation?: boolean } = {}) {}

  /** The next n network-bound calls throw a 'network' CloudError. */
  failNext(n: number): void {
    this.failures = n;
  }

  setAdmin(userId: string): void {
    this.admins.add(userId);
  }

  batchesOf(userId: string): EventBatch[] {
    for (const a of this.accounts.values()) if (a.user.id === userId) return [...a.batches.values()].map((b) => structuredClone(b));
    return [];
  }

  async getUser(): Promise<CloudUser | null> {
    return this.current?.user ?? null;
  }

  async signUp(email: string, password: string): Promise<{ needsEmailConfirmation: boolean }> {
    this.maybeFail();
    if (this.accounts.has(email)) throw new CloudError('other', 'already registered');
    const user = { id: `user-${this.nextId++}`, email };
    this.accounts.set(email, { user, password, terms: null, batches: new Map() });
    return { needsEmailConfirmation: this.opts.needsEmailConfirmation ?? false };
  }

  async signIn(email: string, password: string): Promise<CloudUser> {
    this.maybeFail();
    const acc = this.accounts.get(email);
    if (!acc || acc.password !== password) throw new CloudError('auth', 'invalid credentials');
    this.current = acc;
    this.emit();
    return acc.user;
  }

  async signOut(): Promise<void> {
    this.current = null;
    this.emit();
  }

  async resetPassword(_email: string): Promise<void> {
    this.maybeFail();
  }

  async updatePassword(newPassword: string): Promise<void> {
    this.maybeFail();
    this.requireAccount().password = newPassword;
  }

  /** Simulates opening the recovery link sent to `email`: signs that account in with a recovery event. */
  simulateRecovery(email: string): void {
    const acc = this.accounts.get(email);
    if (!acc) throw new CloudError('auth', 'no such account');
    this.current = acc;
    this.emit('recovery');
  }

  async isAdmin(): Promise<boolean> {
    return this.current !== null && this.admins.has(this.current.user.id);
  }

  async acceptedTermsVersion(): Promise<string | null> {
    return this.requireAccount().terms;
  }

  async acceptTerms(version: string): Promise<void> {
    this.maybeFail();
    this.requireAccount().terms = version;
  }

  async pushBatches(batches: readonly EventBatch[]): Promise<void> {
    this.maybeFail();
    const acc = this.requireAccount();
    for (const b of batches) {
      const key = `${b.sessionId}:${b.firstSeq}`;
      const old = acc.batches.get(key);
      // Monotonic, as on the server: a shorter resend never shrinks a stored batch.
      if (!old || b.lastSeq >= old.lastSeq) acc.batches.set(key, structuredClone(b));
    }
  }

  /** Own events only, even for an admin (others' events are visible only through the SQL view). */
  async pullEvents(): Promise<LoggedEvent[]> {
    this.maybeFail();
    const acc = this.requireAccount();
    return [...acc.batches.values()].flatMap((b) => structuredClone(b.events));
  }

  async deleteMyData(): Promise<void> {
    this.maybeFail();
    const acc = this.requireAccount();
    acc.batches.clear();
    acc.terms = null;
  }

  onAuthChange(listener: (user: CloudUser | null, event?: AuthChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private requireAccount(): Account {
    if (!this.current) throw new CloudError('auth', 'not signed in');
    return this.current;
  }

  private maybeFail(): void {
    if (this.failures > 0) {
      this.failures--;
      throw new CloudError('network', 'simulated network failure');
    }
  }

  private emit(event: AuthChangeEvent = 'other'): void {
    const user = this.current?.user ?? null;
    for (const l of this.listeners) l(user, event);
  }
}
