import Phaser from 'phaser';

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
 * Esc back to the menu. The F-keys, Tab and Esc are captured so the browser ignores them.
 * F4/F6 are playtest shortcuts: bound (and captured) only when `opts.debugKeys` is true (see debugKeysEnabled);
 * otherwise those keys are left alone and do nothing in the game.
 * Returns an unbind that removes these listeners and captures (captures are global to the game, not per scene).
 */
export function bindHotkeys(
  keyboard: Phaser.Input.Keyboard.KeyboardPlugin,
  h: HotkeyHandlers,
  opts: { debugKeys: boolean },
): () => void {
  const KC = Phaser.Input.Keyboard.KeyCodes;
  const captured = [KC.F2, KC.F3, KC.F8, KC.F9, KC.TAB, KC.ESC, ...(opts.debugKeys ? [KC.F4, KC.F6] : [])];
  keyboard.addCapture(captured);
  const debugBindings: [string, () => void][] = opts.debugKeys
    ? [
        ['keydown-F4', () => h.jumpToBoss()],
        ['keydown-F6', () => h.forceBarrage()],
      ]
    : [];
  const bindings: [string, () => void][] = [
    ...debugBindings,
    ['keydown-F2', () => h.resetProfile()],
    ['keydown-F3', () => h.toggleDebug()],
    ['keydown-F8', () => h.exportHistory()],
    ['keydown-F9', () => h.importHistory()],
    ['keydown-TAB', () => h.togglePanel()],
    ['keydown-H', () => h.toggleHelp()],
    ['keydown-ESC', () => h.backToMenu()],
  ];
  for (const [event, fn] of bindings) keyboard.on(event, fn);
  return () => {
    for (const [event, fn] of bindings) keyboard.off(event, fn);
    keyboard.removeCapture(captured);
  };
}
