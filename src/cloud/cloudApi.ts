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
  pushBatches(batches: readonly EventBatch[]): Promise<void>;
  /** The signed-in user's own events only, even for an admin. */
  pullEvents(): Promise<LoggedEvent[]>;
  deleteMyData(): Promise<void>;
  /** Returns the unsubscribe function. The listener must stay synchronous (no client call awaited inside). */
  onAuthChange(listener: (user: CloudUser | null, event?: AuthChangeEvent) => void): () => void;
}
