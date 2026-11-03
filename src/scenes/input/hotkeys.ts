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
}

/** F2 reset, F3 debug hitboxes, F4 jump to boss room, F6 force barrage, F8 export, F9 import, Tab panel, H help. The F-keys and Tab are captured so the browser ignores them. */
export function bindHotkeys(keyboard: Phaser.Input.Keyboard.KeyboardPlugin, h: HotkeyHandlers): void {
  const KC = Phaser.Input.Keyboard.KeyCodes;
  keyboard.addCapture([KC.F2, KC.F3, KC.F4, KC.F6, KC.F8, KC.F9, KC.TAB]);
  keyboard.on('keydown-F4', () => h.jumpToBoss());
  keyboard.on('keydown-F6', () => h.forceBarrage());
  keyboard.on('keydown-F2', () => h.resetProfile());
  keyboard.on('keydown-F3', () => h.toggleDebug());
  keyboard.on('keydown-F8', () => h.exportHistory());
  keyboard.on('keydown-F9', () => h.importHistory());
  keyboard.on('keydown-TAB', () => h.togglePanel());
  keyboard.on('keydown-H', () => h.toggleHelp());
}
