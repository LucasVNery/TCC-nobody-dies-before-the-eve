import type { LoggedEvent } from '../telemetry/schema';

export interface CloudUser {
  id: string;
  email: string;
}

/** A contiguous slice of one session's events; the server keys it by (sessionId, firstSeq). */
export interface EventBatch {
  sessionId: string;
  firstSeq: number;
  lastSeq: number;
  events: LoggedEvent[];
}

/** Position in the pull order (session_id, first_seq): the next page starts after this row. */
export interface PullCursor {
  sessionId: string;
  firstSeq: number;
}

/** One page of the pull: the events of up to PULL_PAGE_SIZE rows, and where the next page starts (null: last page). */
export interface PullPage {
  events: LoggedEvent[];
  next: PullCursor | null;
}

export type CloudErrorKind = 'network' | 'auth' | 'other';

export class CloudError extends Error {
  readonly kind: CloudErrorKind;
  constructor(kind: CloudErrorKind, message: string) {
    super(message);
    this.name = 'CloudError';
    this.kind = kind;
  }
}

/** 'recovery': the session came from a password-recovery link (the player should set a new password). */
export type AuthChangeEvent = 'recovery' | 'other';

/** Everything the game needs from the cloud; the real client and the in-memory fake both implement it. */
export interface CloudApi {
  getUser(): Promise<CloudUser | null>;
  signUp(email: string, password: string): Promise<{ needsEmailConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<CloudUser>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  /** Sets the signed-in user's password (after a recovery link, or any time while signed in). */
  updatePassword(newPassword: string): Promise<void>;
  isAdmin(): Promise<boolean>;
  acceptedTermsVersion(): Promise<string | null>;
  acceptTerms(version: string): Promise<void>;
  /**
   * Upserts the batches as rows of `userId` (sent explicitly in every row): when the session belongs to
   * someone else the server refuses them (RLS), which surfaces as an 'auth' CloudError.
   */
  pushBatches(batches: readonly EventBatch[], userId: string): Promise<void>;
  /**
   * One page of the signed-in user's own rows (even for an admin), in (session_id, first_seq) order,
   * starting after `after` (null: from the start). Events are deduplicated within the page.
   */
  pullPage(after: PullCursor | null): Promise<PullPage>;
  /** Deletes the signed-in user's batches and consents; refused ('auth') unless that user is `expectedUserId`. */
  deleteMyData(expectedUserId: string): Promise<void>;
  /** Returns the unsubscribe function. The listener must stay synchronous (no client call awaited inside). */
  onAuthChange(listener: (user: CloudUser | null, event?: AuthChangeEvent) => void): () => void;
}
