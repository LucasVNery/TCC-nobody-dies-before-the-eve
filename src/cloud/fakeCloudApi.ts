import type { LoggedEvent } from '../telemetry/schema';
import { CloudError, type CloudApi, type CloudUser, type EventBatch, type PullCursor, type PullPage } from './cloudApi';
import { compareRowKey, flattenBatches, PULL_PAGE_SIZE } from './batching';

interface Account {
  user: CloudUser;
  terms: string | null;
  /** Keyed by `${sessionId}:${firstSeq}`, mirroring the server's unique key. */
  batches: Map<string, EventBatch>;
}

/** The account openSignIn() signs in (built at runtime: no e-mail literals in the repo). */
export const FAKE_DEFAULT_EMAIL = ['jogador', 'simulado.invalid'].join('@');

/**
 * In-memory CloudApi for tests and offline development: no Clerk. Signing in is immediate
 * (openSignIn, or signInAs for a chosen account); ids look like Clerk's ('user_' + alphanumerics).
 */
export class FakeCloudApi implements CloudApi {
  private accounts = new Map<string, Account>(); // by email
  private current: Account | null = null;
  private admins = new Set<string>();
  private listeners = new Set<(user: CloudUser | null) => void>();
  private failures = 0;
  private nextId = 1;

  constructor(private readonly opts: { pullPageSize?: number } = {}) {}

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

  /** As Clerk's sign-in window, at once: signs the default account in. */
  openSignIn(): void {
    this.signInAs(FAKE_DEFAULT_EMAIL);
  }

  /** Signs in the account of `email` (created on first use), as completing Clerk's sign-in would. */
  signInAs(email: string): CloudUser {
    let acc = this.accounts.get(email);
    if (!acc) {
      acc = { user: { id: `user_fake${this.nextId++}`, email }, terms: null, batches: new Map() };
      this.accounts.set(email, acc);
    }
    this.current = acc;
    this.emit();
    return acc.user;
  }

  async signOut(): Promise<void> {
    this.current = null;
    this.emit();
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

  async pushBatches(batches: readonly EventBatch[], userId: string): Promise<void> {
    this.maybeFail();
    const acc = this.requireAccount();
    // As RLS WITH CHECK on the server: rows of another user than the session's are refused.
    if (acc.user.id !== userId) throw new CloudError('auth', 'row user_id does not match the session');
    for (const b of batches) {
      const key = `${b.sessionId}:${b.firstSeq}`;
      const old = acc.batches.get(key);
      // Monotonic, as on the server: a shorter resend never shrinks a stored batch.
      if (!old || b.lastSeq >= old.lastSeq) acc.batches.set(key, structuredClone(b));
    }
  }

  /** Own events only, even for an admin (others' events are visible only through the SQL view). */
  async pullPage(after: PullCursor | null): Promise<PullPage> {
    this.maybeFail();
    const acc = this.requireAccount();
    const size = this.opts.pullPageSize ?? PULL_PAGE_SIZE;
    const rows = [...acc.batches.values()]
      .sort(compareRowKey)
      .filter((b) => !after || compareRowKey(b, after) > 0)
      .slice(0, size);
    const last = rows[rows.length - 1];
    return {
      events: structuredClone(flattenBatches(rows)),
      next: rows.length === size ? { sessionId: last.sessionId, firstSeq: last.firstSeq } : null,
    };
  }

  /** Test helper: every page of the signed-in user's events, concatenated. */
  async pullAll(): Promise<LoggedEvent[]> {
    const out: LoggedEvent[] = [];
    let after: PullCursor | null = null;
    for (;;) {
      const page: PullPage = await this.pullPage(after);
      out.push(...page.events);
      if (!page.next) return out;
      after = page.next;
    }
  }

  async deleteMyData(expectedUserId: string): Promise<void> {
    this.maybeFail();
    const acc = this.requireAccount();
    // As delete_my_data(expected) on the server: refused unless the session is that user.
    if (acc.user.id !== expectedUserId) throw new CloudError('auth', 'delete_my_data: not the expected user');
    acc.batches.clear();
    acc.terms = null;
  }

  onAuthChange(listener: (user: CloudUser | null) => void): () => void {
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

  private emit(): void {
    const user = this.current?.user ?? null;
    for (const l of [...this.listeners]) l(user);
  }
}
