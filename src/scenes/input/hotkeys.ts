import Phaser from 'phaser';
import type { HotkeyGates } from './debugKeys';

export interface HotkeyHandlers {
  resetProfile(): void;
  exportHistory(): void;
  importHistory(): void;
  togglePanel(): void;
  toggleHelp(): void;
  toggleDebug(): void;
  jumpToBoss(): void;
  forceBarrage(): void;
  backToMenu(): void;
}

/**
 * F2 reset, F3 debug hitboxes, F4 jump to boss room, F6 force barrage, F8 export, F9 import, Tab panel, H help,
 * Esc back to the menu. H and Esc are always bound (Esc captured). The development keys are bound and captured
 * only when their gate is on: F2/F3/F8/F9/Tab with `gates.toolKeys`, F4/F6 with `gates.debugKeys` (see
 * hotkeyGates); otherwise those keys are left alone, so the browser keeps its defaults, and do nothing in the game.
 * Returns an unbind that removes these listeners and captures (captures are global to the game, not per scene).
 */
export function bindHotkeys(
  keyboard: Phaser.Input.Keyboard.KeyboardPlugin,
  h: HotkeyHandlers,
  gates: HotkeyGates,
): () => void {
  const KC = Phaser.Input.Keyboard.KeyCodes;
  const captured = [
    KC.ESC,
    ...(gates.toolKeys ? [KC.F2, KC.F3, KC.F8, KC.F9, KC.TAB] : []),
    ...(gates.debugKeys ? [KC.F4, KC.F6] : []),
  ];
  keyboard.addCapture(captured);
  const toolBindings: [string, () => void][] = gates.toolKeys
    ? [
        ['keydown-F2', () => h.resetProfile()],
        ['keydown-F3', () => h.toggleDebug()],
        ['keydown-F8', () => h.exportHistory()],
        ['keydown-F9', () => h.importHistory()],
        ['keydown-TAB', () => h.togglePanel()],
      ]
    : [];
  const debugBindings: [string, () => void][] = gates.debugKeys
    ? [
        ['keydown-F4', () => h.jumpToBoss()],
        ['keydown-F6', () => h.forceBarrage()],
      ]
    : [];
  const bindings: [string, () => void][] = [
    ...debugBindings,
    ...toolBindings,
    ['keydown-H', () => h.toggleHelp()],
    ['keydown-ESC', () => h.backToMenu()],
  ];
  for (const [event, fn] of bindings) keyboard.on(event, fn);
  return () => {
    for (const [event, fn] of bindings) keyboard.off(event, fn);
    keyboard.removeCapture(captured);
  };
}

export interface GatedHotkeys {
  /** The gates the keys are bound with now. */
  readonly gates: HotkeyGates;
  /** Re-reads the gates and, if they changed, rebinds the keys with the new ones; true when they changed. */
  refresh(): boolean;
  unbind(): void;
}

/**
 * bindHotkeys driven by `current` (read from the account state): every development key re-checks its gate
 * when it fires, so a key bound for an administrator does nothing once the account changed; refresh() (on an
 * account change) also unbinds and releases the keys that are no longer allowed, and binds the newly allowed ones.
 */
export function bindGatedHotkeys(
  keyboard: Phaser.Input.Keyboard.KeyboardPlugin,
  h: HotkeyHandlers,
  current: () => HotkeyGates,
): GatedHotkeys {
  const tool = (fn: () => void) => () => {
    if (current().toolKeys) fn();
  };
  const debug = (fn: () => void) => () => {
    if (current().debugKeys) fn();
  };
  const guarded: HotkeyHandlers = {
    resetProfile: tool(() => h.resetProfile()),
    exportHistory: tool(() => h.exportHistory()),
    importHistory: tool(() => h.importHistory()),
    togglePanel: tool(() => h.togglePanel()),
    toggleDebug: tool(() => h.toggleDebug()),
    jumpToBoss: debug(() => h.jumpToBoss()),
    forceBarrage: debug(() => h.forceBarrage()),
    toggleHelp: () => h.toggleHelp(),
    backToMenu: () => h.backToMenu(),
  };
  let gates = current();
  let unbind: (() => void) | null = bindHotkeys(keyboard, guarded, gates);
  return {
    get gates() {
      return gates;
    },
    refresh() {
      if (!unbind) return false;
      const next = current();
      if (next.toolKeys === gates.toolKeys && next.debugKeys === gates.debugKeys) return false;
      unbind();
      gates = next;
      unbind = bindHotkeys(keyboard, guarded, gates);
      return true;
    },
    unbind() {
      unbind?.();
      unbind = null;
    },
  };
}
