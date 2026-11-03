// Hands the IndexedDB event store from one scene to the next (no Phaser import: tested in isolation).

/** The slice of Phaser's game registry this module needs. */
export interface RegistryLike {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
}

export const STORE_RELEASE_KEY = 'storeRelease';

export interface StoreClaim {
  /** Settles (never rejects) once the previous holder released the store. */
  ready: Promise<void>;
  /** Marks this holder's store as released once `closed` settles; later calls are ignored. */
  release(closed?: Promise<unknown>): void;
}

/**
 * Claims the store: the returned `ready` waits for the previous claim's
 * release, and the registry immediately points at this claim, so whoever
 * claims next waits for this holder (even if it never got to open the store).
 * Each claim chains on the one before, so releases happen in claim order.
 */
export function claimStore(registry: RegistryLike): StoreClaim {
  const prev = registry.get(STORE_RELEASE_KEY);
  const ready = (prev instanceof Promise ? prev : Promise.resolve()).then(
    () => undefined,
    () => undefined,
  );
  let resolveRelease!: () => void;
  const released = new Promise<void>((r) => {
    resolveRelease = r;
  });
  let done = false;
  registry.set(
    STORE_RELEASE_KEY,
    // Never released before the previous holder is.
    Promise.all([ready, released]).then(() => undefined),
  );
  return {
    ready,
    release(closed = Promise.resolve()) {
      if (done) return;
      done = true;
      closed.then(resolveRelease, resolveRelease);
    },
  };
}
