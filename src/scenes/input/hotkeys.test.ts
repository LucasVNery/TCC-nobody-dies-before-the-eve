import { describe, it, expect, vi } from 'vitest';
import type Phaser from 'phaser';

import { bindHotkeys, bindGatedHotkeys, type HotkeyHandlers } from './hotkeys';

const KEY_CODES = vi.hoisted(() => ({ F2: 113, F3: 114, F4: 115, F6: 117, F8: 119, F9: 120, TAB: 9, ESC: 27 }));
// Only KeyCodes is used; the real Phaser needs a browser to load.
vi.mock('phaser', () => ({ default: { Input: { Keyboard: { KeyCodes: KEY_CODES } } } }));
type Handlers = HotkeyHandlers;

/** Just enough of the keyboard plugin: listeners by event and the set of captured key codes. */
class FakeKeyboard {
  readonly listeners = new Map<string, Set<() => void>>();
  readonly captured = new Set<number>();
  addCapture(codes: number[]): void {
    for (const c of codes) this.captured.add(c);
  }
  removeCapture(codes: number[]): void {
    for (const c of codes) this.captured.delete(c);
  }
  on(event: string, fn: () => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(fn);
  }
  off(event: string, fn: () => void): void {
    this.listeners.get(event)?.delete(fn);
  }
  press(key: string): void {
    for (const fn of [...(this.listeners.get(`keydown-${key}`) ?? [])]) fn();
  }
  bound(): string[] {
    return [...this.listeners].filter(([, s]) => s.size > 0).map(([e]) => e.replace('keydown-', '')).sort();
  }
  get plugin(): Phaser.Input.Keyboard.KeyboardPlugin {
    return this as unknown as Phaser.Input.Keyboard.KeyboardPlugin;
  }
}

function handlers(): Handlers & { calls: string[] } {
  const calls: string[] = [];
  const h = (name: string) => () => void calls.push(name);
  return {
    calls,
    resetProfile: h('reset'),
    exportHistory: h('export'),
    importHistory: h('import'),
    togglePanel: h('panel'),
    toggleHelp: h('help'),
    toggleDebug: h('hitboxes'),
    jumpToBoss: h('boss'),
    forceBarrage: h('barrage'),
    backToMenu: h('menu'),
  };
}

const ALL_KEYS = ['F2', 'F3', 'F4', 'F6', 'F8', 'F9', 'TAB', 'H', 'ESC'];
const DEV_CODES = [KEY_CODES.F2, KEY_CODES.F3, KEY_CODES.F4, KEY_CODES.F6, KEY_CODES.F8, KEY_CODES.F9, KEY_CODES.TAB];

describe('bindHotkeys', () => {
  it('with the development keys off binds only H and Esc and captures only Esc', () => {
    const kb = new FakeKeyboard();
    const h = handlers();
    bindHotkeys(kb.plugin, h, { toolKeys: false, debugKeys: false });
    expect(kb.bound()).toEqual(['ESC', 'H']);
    expect([...kb.captured]).toEqual([KEY_CODES.ESC]);
    for (const c of DEV_CODES) expect(kb.captured.has(c)).toBe(false);
    for (const k of ALL_KEYS) kb.press(k);
    expect(h.calls).toEqual(['help', 'menu']);
  });

  it('with everything on binds and captures every development key', () => {
    const kb = new FakeKeyboard();
    const h = handlers();
    bindHotkeys(kb.plugin, h, { toolKeys: true, debugKeys: true });
    expect(kb.bound()).toEqual([...ALL_KEYS].sort());
    for (const c of [...DEV_CODES, KEY_CODES.ESC]) expect(kb.captured.has(c)).toBe(true);
    for (const k of ALL_KEYS) kb.press(k);
    expect(h.calls).toEqual(['reset', 'hitboxes', 'boss', 'barrage', 'export', 'import', 'panel', 'help', 'menu']);
  });

  it('local mode without the playtest keys: F2/F3/F8/F9/Tab on, F4/F6 left to the browser', () => {
    const kb = new FakeKeyboard();
    bindHotkeys(kb.plugin, handlers(), { toolKeys: true, debugKeys: false });
    expect(kb.bound()).toEqual(['ESC', 'F2', 'F3', 'F8', 'F9', 'H', 'TAB']);
    expect(kb.captured.has(KEY_CODES.F4)).toBe(false);
    expect(kb.captured.has(KEY_CODES.F6)).toBe(false);
  });

  it('the unbind removes every listener and capture', () => {
    const kb = new FakeKeyboard();
    const unbind = bindHotkeys(kb.plugin, handlers(), { toolKeys: true, debugKeys: true });
    unbind();
    expect(kb.bound()).toEqual([]);
    expect(kb.captured.size).toBe(0);
  });
});

describe('bindGatedHotkeys', () => {
  const ADMIN = { toolKeys: true, debugKeys: true };
  const COMMON = { toolKeys: false, debugKeys: false };

  it('a key bound for an administrator does nothing once the account changed, even before refresh', () => {
    const kb = new FakeKeyboard();
    const h = handlers();
    let gates = ADMIN;
    bindGatedHotkeys(kb.plugin, h, () => gates);
    gates = COMMON;
    for (const k of ALL_KEYS) kb.press(k);
    expect(h.calls).toEqual(['help', 'menu']);
  });

  it('refresh releases the keys no longer allowed, and binds them again for an administrator', () => {
    const kb = new FakeKeyboard();
    const h = handlers();
    let gates = ADMIN;
    const hk = bindGatedHotkeys(kb.plugin, h, () => gates);
    expect(hk.refresh()).toBe(false);
    gates = COMMON;
    expect(hk.refresh()).toBe(true);
    expect(hk.gates).toEqual(COMMON);
    expect(kb.bound()).toEqual(['ESC', 'H']);
    expect([...kb.captured]).toEqual([KEY_CODES.ESC]);
    gates = ADMIN;
    expect(hk.refresh()).toBe(true);
    kb.press('F4');
    kb.press('TAB');
    expect(h.calls).toEqual(['boss', 'panel']);
    // One listener per key after rebinding (no duplicates).
    for (const s of kb.listeners.values()) expect(s.size).toBeLessThanOrEqual(1);
  });

  it('unbind removes everything and later refreshes do not rebind', () => {
    const kb = new FakeKeyboard();
    let gates = COMMON;
    const hk = bindGatedHotkeys(kb.plugin, handlers(), () => gates);
    hk.unbind();
    gates = ADMIN;
    expect(hk.refresh()).toBe(false);
    expect(kb.bound()).toEqual([]);
    expect(kb.captured.size).toBe(0);
  });
});
