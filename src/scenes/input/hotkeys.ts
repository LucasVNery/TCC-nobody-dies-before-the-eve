import Phaser from 'phaser';

export interface HotkeyHandlers {
  resetProfile(): void;
  exportHistory(): void;
  importHistory(): void;
  togglePanel(): void;
  toggleHelp(): void;
}

/** F2 reset, F8 export, F9 import, Tab panel, H help. F2/F8/F9/Tab are captured so the browser ignores them. */
export function bindHotkeys(keyboard: Phaser.Input.Keyboard.KeyboardPlugin, h: HotkeyHandlers): void {
  const KC = Phaser.Input.Keyboard.KeyCodes;
  keyboard.addCapture([KC.F2, KC.F8, KC.F9, KC.TAB]);
  keyboard.on('keydown-F2', () => h.resetProfile());
  keyboard.on('keydown-F8', () => h.exportHistory());
  keyboard.on('keydown-F9', () => h.importHistory());
  keyboard.on('keydown-TAB', () => h.togglePanel());
  keyboard.on('keydown-H', () => h.toggleHelp());
}
