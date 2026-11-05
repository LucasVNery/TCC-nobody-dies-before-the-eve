// Follows Clerk's sign-in window from the outside. clerk-js 6.40.0 has no event for its modal opening
// or closing (openSignIn/closeSignIn only; addListener reports session changes), so the window is seen
// in the DOM: Clerk's prebuilt UI tags its elements with `cl-` classes (its appearance element keys).

/** Clerk's modal (backdrop and box) and the sign-in/sign-up component roots it holds. */
export const CLERK_MODAL_SELECTOR = [
  '.cl-modalBackdrop',
  '.cl-modalContent',
  '.cl-signIn-root',
  '.cl-signUp-root',
].join(', ');

/** How long the window may take to show up before the menu offers to try again (it never stays locked). */
export const SIGN_IN_OPEN_TIMEOUT_MS = 10_000;

/** The slice of a Document (or element) the check needs. */
export interface QueryRoot {
  querySelector(selectors: string): unknown;
}

/** Whether one of Clerk's modal elements is in `root`. */
export function isClerkModalOpen(root: QueryRoot): boolean {
  return root.querySelector(CLERK_MODAL_SELECTOR) !== null;
}

/**
 * - waiting: asked to open, not seen yet (the UI may still be mounting): game keys are held back.
 * - open: the window is on screen: game keys are held back.
 * - stalled: it did not show up in time: the menu works again and offers a retry; a late window still counts.
 * - ended: closed, signed in, or stopped; nothing is observed any more.
 */
export type SignInWindowPhase = 'waiting' | 'open' | 'stalled' | 'ended';

/** Whether the menu must leave the keyboard to Clerk in this phase. */
export function holdsKeyboard(phase: SignInWindowPhase): boolean {
  return phase === 'waiting' || phase === 'open';
}

export interface SignInWindowDeps {
  /** Whether Clerk's window is in the DOM now (isClerkModalOpen(document) in the browser). */
  isOpen(): boolean;
  /** Calls `onChange` on every DOM change; returns the function that stops observing. */
  observe(onChange: () => void): () => void;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  timeoutMs?: number;
}

/**
 * One sign-in attempt. Created right before openSignIn() (the simulated cloud signs in synchronously).
 * Ends when the window is removed from the DOM, or on a sign-in while no window is shown; reports every
 * phase change to `onPhase`. stop() ends it silently (the scene is going away).
 */
export class SignInWindowWatch {
  private _phase: SignInWindowPhase = 'waiting';
  private timer: unknown = null;
  private unobserve: (() => void) | null = null;

  constructor(
    private readonly deps: SignInWindowDeps,
    private readonly onPhase: (phase: SignInWindowPhase) => void,
  ) {
    this.unobserve = deps.observe(() => this.check());
    this.timer = deps.setTimer(() => this.onTimeout(), deps.timeoutMs ?? SIGN_IN_OPEN_TIMEOUT_MS);
    if (deps.isOpen()) this.set('open'); // already up (a window left from an earlier try)
  }

  get phase(): SignInWindowPhase {
    return this._phase;
  }

  /** The account changed: a sign-in with no window on screen ends the attempt (the window closed itself or never opened). */
  sessionChanged(signedIn: boolean): void {
    if (this._phase === 'ended' || !signedIn) return;
    if (!this.deps.isOpen()) this.end();
  }

  /** Ends without reporting (scene shutdown, or a new attempt replaces this one). */
  stop(): void {
    this.release();
    this._phase = 'ended';
  }

  private check(): void {
    if (this._phase === 'ended') return;
    const open = this.deps.isOpen();
    if (open && this._phase !== 'open') this.set('open');
    else if (!open && this._phase === 'open') this.end(); // closed (signed in or not)
  }

  private onTimeout(): void {
    this.timer = null;
    if (this._phase === 'waiting') this.set('stalled');
  }

  private set(phase: SignInWindowPhase): void {
    if (phase === 'open' && this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    this._phase = phase;
    this.onPhase(phase);
  }

  private end(): void {
    this.release();
    this.set('ended');
  }

  private release(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.unobserve?.();
    this.unobserve = null;
  }
}

/** The document nodes a key typed "into the game" targets (no DOM control has the focus). */
export interface ShieldDocument {
  readonly body: unknown;
  readonly documentElement: unknown;
}

/**
 * Whether a key event aimed at `target` belongs to some DOM UI (Clerk's window, or any other control with
 * the focus) and must not reach the game: anything but the page itself or the game canvas. Independent of
 * Clerk's class names. A document listener in the bubble phase stops such events after the target's own
 * handlers ran, before Phaser's window listener (no preventDefault: the control keeps its default action).
 */
export function shouldShieldKeyTarget(target: unknown, canvas: unknown, doc: ShieldDocument = document): boolean {
  if (target === null || target === undefined) return false;
  return target !== doc.body && target !== doc.documentElement && target !== doc && target !== canvas;
}

/** The slice of Phaser's KeyboardPlugin the hold uses. */
export interface KeyCapturer {
  addCapture(keys: number[]): unknown;
  removeCapture(keys: number[]): unknown;
  resetKeys(): unknown;
}

/** The slice of Phaser's KeyboardManager the hold uses. */
export interface KeyboardSwitch {
  enabled: boolean;
}

/**
 * Leaves the keyboard to Clerk's window: releases `keys` from capture and switches the game's keyboard off
 * (Phaser's manager then ignores events before its preventDefault). The returned release puts `enabled` back
 * as it was, clears stale key states and, when `recapture`, captures `keys` again. Release runs once.
 */
export function holdKeyboard(plugin: KeyCapturer | null, manager: KeyboardSwitch | null, keys: number[]): (recapture?: boolean) => void {
  plugin?.removeCapture(keys);
  const wasEnabled = manager?.enabled ?? true;
  if (manager) manager.enabled = false;
  let released = false;
  return (recapture = true) => {
    if (released) return;
    released = true;
    if (manager) manager.enabled = wasEnabled;
    plugin?.resetKeys();
    if (recapture) plugin?.addCapture(keys);
  };
}

/** The browser wiring: a MutationObserver on document.body and window timers. */
export function browserSignInWindowDeps(doc: Document = document): SignInWindowDeps {
  return {
    isOpen: () => isClerkModalOpen(doc),
    observe: (onChange) => {
      const mo = new MutationObserver(() => onChange());
      mo.observe(doc.body, { childList: true, subtree: true });
      return () => mo.disconnect();
    },
    setTimer: (run, ms) => window.setTimeout(run, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  };
}
