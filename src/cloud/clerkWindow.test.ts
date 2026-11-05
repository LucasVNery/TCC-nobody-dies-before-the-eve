import { describe, expect, it } from 'vitest';
import {
  CLERK_MODAL_SELECTOR,
  SIGN_IN_OPEN_TIMEOUT_MS,
  SignInWindowWatch,
  holdKeyboard,
  holdsKeyboard,
  isClerkModalOpen,
  shouldShieldKeyTarget,
  type SignInWindowDeps,
  type SignInWindowPhase,
} from './clerkWindow';

// No jsdom here: a document is faked by the set of classes "in the DOM"; the real Clerk window is not testable.

/** A document-like root that matches a selector list against the classes present. */
function fakeRoot(classes: Set<string>) {
  return {
    querySelector(selectors: string): unknown {
      const hit = selectors.split(',').map((s) => s.trim().replace(/^\./, '')).find((c) => classes.has(c));
      return hit ? { className: hit } : null;
    },
  };
}

function harness(opts: { openAtStart?: boolean } = {}) {
  const dom = new Set<string>(opts.openAtStart ? ['cl-modalBackdrop'] : []);
  const root = fakeRoot(dom);
  let onMutation: (() => void) | null = null;
  let observing = 0;
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 1;
  const deps: SignInWindowDeps = {
    isOpen: () => isClerkModalOpen(root),
    observe: (cb) => {
      onMutation = cb;
      observing++;
      return () => {
        onMutation = null;
        observing--;
      };
    },
    setTimer: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { run, ms });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
  };
  const phases: SignInWindowPhase[] = [];
  const watch = new SignInWindowWatch(deps, (p) => phases.push(p));
  return {
    watch,
    phases,
    timers,
    observing: () => observing,
    show() {
      dom.add('cl-modalBackdrop');
      dom.add('cl-signIn-root');
      onMutation?.();
    },
    hide() {
      dom.clear();
      onMutation?.();
    },
    fireTimers() {
      for (const [id, t] of [...timers]) {
        timers.delete(id);
        t.run();
      }
    },
  };
}

describe('isClerkModalOpen', () => {
  it('sees any of Clerk’s modal elements, and nothing else', () => {
    expect(isClerkModalOpen(fakeRoot(new Set()))).toBe(false);
    expect(isClerkModalOpen(fakeRoot(new Set(['account-overlay', 'cl-userButton-root'])))).toBe(false);
    for (const c of ['cl-modalBackdrop', 'cl-modalContent', 'cl-signIn-root', 'cl-signUp-root']) {
      expect(isClerkModalOpen(fakeRoot(new Set([c])))).toBe(true);
    }
    expect(CLERK_MODAL_SELECTOR).toContain('.cl-modalBackdrop');
  });
});

describe('SignInWindowWatch', () => {
  it('holds the keyboard while waiting and while open, not after', () => {
    expect(holdsKeyboard('waiting')).toBe(true);
    expect(holdsKeyboard('open')).toBe(true);
    expect(holdsKeyboard('stalled')).toBe(false);
    expect(holdsKeyboard('ended')).toBe(false);
  });

  it('closing the window without signing in ends the attempt and stops observing', () => {
    const h = harness();
    expect(h.watch.phase).toBe('waiting');
    expect(h.timers.size).toBe(1);
    expect([...h.timers.values()][0].ms).toBe(SIGN_IN_OPEN_TIMEOUT_MS);
    h.show();
    expect(h.phases).toEqual(['open']);
    expect(h.timers.size).toBe(0); // no time limit once it is on screen
    h.watch.sessionChanged(false);
    expect(h.watch.phase).toBe('open');
    h.hide();
    expect(h.phases).toEqual(['open', 'ended']);
    expect(h.observing()).toBe(0);
  });

  it('a sign-in while the window is still shown waits for the window to go', () => {
    const h = harness();
    h.show();
    h.watch.sessionChanged(true);
    expect(h.watch.phase).toBe('open');
    h.hide();
    expect(h.watch.phase).toBe('ended');
    expect(h.observing()).toBe(0);
  });

  it('a sign-in with no window (the simulated cloud) ends at once', () => {
    const h = harness();
    h.watch.sessionChanged(true);
    expect(h.phases).toEqual(['ended']);
    expect(h.timers.size).toBe(0);
    expect(h.observing()).toBe(0);
    h.fireTimers();
    h.show();
    expect(h.phases).toEqual(['ended']);
  });

  it('a window that never shows up stalls after the timeout; a late one is still followed', () => {
    const h = harness();
    h.fireTimers();
    expect(h.phases).toEqual(['stalled']);
    expect(h.observing()).toBe(1);
    h.show();
    h.hide();
    expect(h.phases).toEqual(['stalled', 'open', 'ended']);
    expect(h.observing()).toBe(0);
  });

  it('a window already in the DOM counts as open', () => {
    const h = harness({ openAtStart: true });
    expect(h.phases).toEqual(['open']);
    expect(h.timers.size).toBe(0);
  });

  it('stop() ends silently and releases the observer and the timer', () => {
    const h = harness();
    h.watch.stop();
    expect(h.watch.phase).toBe('ended');
    expect(h.phases).toEqual([]);
    expect(h.observing()).toBe(0);
    expect(h.timers.size).toBe(0);
    h.watch.sessionChanged(true);
    expect(h.phases).toEqual([]);
  });
});

describe('shouldShieldKeyTarget', () => {
  const body = { name: 'body' };
  const html = { name: 'html' };
  const doc = { body, documentElement: html };
  const canvas = { name: 'canvas' };

  it('lets keys aimed at the page or the game canvas through', () => {
    expect(shouldShieldKeyTarget(body, canvas, doc)).toBe(false);
    expect(shouldShieldKeyTarget(html, canvas, doc)).toBe(false);
    expect(shouldShieldKeyTarget(doc, canvas, doc)).toBe(false);
    expect(shouldShieldKeyTarget(canvas, canvas, doc)).toBe(false);
    expect(shouldShieldKeyTarget(null, canvas, doc)).toBe(false);
  });

  it('shields keys typed into any other element, whatever its class (Clerk’s input, a button)', () => {
    expect(shouldShieldKeyTarget({ name: 'input', className: 'whatever' }, canvas, doc)).toBe(true);
    expect(shouldShieldKeyTarget({ name: 'button' }, canvas, doc)).toBe(true);
    expect(shouldShieldKeyTarget({ name: 'canvas-2' }, null, doc)).toBe(true);
  });
});

describe('holdKeyboard', () => {
  const KEYS = [38, 40, 13, 27];

  function fakeKeyboard() {
    const captures = new Set<number>(KEYS);
    let resets = 0;
    const plugin = {
      addCapture: (keys: number[]) => keys.forEach((k) => captures.add(k)),
      removeCapture: (keys: number[]) => keys.forEach((k) => captures.delete(k)),
      resetKeys: () => void resets++,
    };
    return { plugin, captures, manager: { enabled: true }, resets: () => resets };
  }

  it('hold then release restores the switch and the captures as they were', () => {
    const k = fakeKeyboard();
    const release = holdKeyboard(k.plugin, k.manager, KEYS);
    expect(k.manager.enabled).toBe(false);
    expect(k.captures.size).toBe(0);
    release();
    expect(k.manager.enabled).toBe(true);
    expect([...k.captures].sort()).toEqual([...KEYS].sort());
    expect(k.resets()).toBe(1);
    release(); // runs once
    expect(k.resets()).toBe(1);
  });

  it('keeps a keyboard that was already off, off; release without recapture (shutdown)', () => {
    const k = fakeKeyboard();
    k.manager.enabled = false;
    const release = holdKeyboard(k.plugin, k.manager, KEYS);
    release(false);
    expect(k.manager.enabled).toBe(false);
    expect(k.captures.size).toBe(0);
  });

  it('works without a keyboard manager or plugin', () => {
    expect(() => holdKeyboard(null, null, KEYS)()).not.toThrow();
  });
});
