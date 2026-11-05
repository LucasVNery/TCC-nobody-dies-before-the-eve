// src/scenes/MenuScene.ts
import Phaser from 'phaser';
import { MENU_ITEMS, firstEnabled, moveSelection, type MenuId } from './menu/menuModel';
import { HOW_TO_PLAY_LINES } from './menu/howToPlay';
import { loadStoredAnalysis } from './menu/storedAnalysis';
import { createBrowserPlatform } from './session/browserPlatform';
import { accountFromRegistry } from '../cloud/account';
import { claimStore } from './session/storeHandoff';
import type { EventStore } from '../telemetry/eventStore';
import { GAME_VERSION } from '../telemetry/schema';
import { buildAnalysisView } from '../debug/analysis/analysisViewModel';
import { AnalysisPanel } from '../debug/analysis/analysisPanel';

type Screen = 'main' | 'howto' | 'analysis';

const FONT = 'monospace';
const BUTTON_W = 360;
const BUTTON_H = 48;
const BUTTON_GAP = 16;
const BUTTONS_TOP = 260;
const COLOR = {
  idle: 0x263238,
  selected: 0x37474f,
  disabled: 0x1c1c1c,
  border: 0x607d8b,
  borderSelected: 0xffeb3b,
};

/**
 * Main menu, placeholder style (text and rectangles, like the HUD). Mouse (hover/click) and
 * Up/Down + Enter. Login is shown but inert. Como jogar and Análise are sub-screens closed with Esc.
 * Análise is read-only: it reads the stored history (after the previous store holder released it),
 * closes the store right away and never logs an event.
 */
export class MenuScene extends Phaser.Scene {
  private screen: Screen = 'main';
  private selected = 0;
  private buttons: { rect: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];
  private mainObjects: (Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle)[] = [];
  private howToText!: Phaser.GameObjects.Text;
  private analysisText!: Phaser.GameObjects.Text;
  private backHint!: Phaser.GameObjects.Text;
  private panel: AnalysisPanel | null = null;
  /** Bumped whenever the Análise screen is left: a stale load drops its result. */
  private analysisToken = 0;
  /** Set once Jogar queued the scene switch, so a click + Enter in the same frame cannot queue two starts. */
  private starting = false;

  constructor() {
    super('MenuScene');
  }

  create(): void {
    this.screen = 'main';
    this.selected = firstEnabled(MENU_ITEMS);
    this.buttons = [];
    this.panel = null;
    this.starting = false; // the scene object is reused when the Arena comes back here

    const title = this.add.text(640, 120, 'TCC · arena adaptativa', { fontFamily: FONT, fontSize: '40px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    const version = this.add.text(640, 172, `protótipo ${GAME_VERSION}`, { fontFamily: FONT, fontSize: '16px', color: '#aaaaaa' }).setOrigin(0.5);
    const hint = this.add.text(640, 660, '↑/↓ + Enter ou mouse', { fontFamily: FONT, fontSize: '14px', color: '#888888' }).setOrigin(0.5);
    this.mainObjects = [title, version, hint];

    MENU_ITEMS.forEach((item, i) => {
      const y = BUTTONS_TOP + i * (BUTTON_H + BUTTON_GAP);
      const rect = this.add.rectangle(640, y, BUTTON_W, BUTTON_H, item.enabled ? COLOR.idle : COLOR.disabled).setStrokeStyle(2, COLOR.border);
      const label = this.add.text(640, y, item.label, { fontFamily: FONT, fontSize: '22px', color: item.enabled ? '#ffffff' : '#666666' }).setOrigin(0.5);
      if (item.enabled) {
        rect.setInteractive({ useHandCursor: true });
        rect.on('pointerover', () => this.select(i));
        rect.on('pointerdown', () => this.activate(item.id));
      }
      this.buttons.push({ rect, label });
      this.mainObjects.push(rect, label);
    });

    this.howToText = this.add.text(60, 40, HOW_TO_PLAY_LINES as string[], { fontFamily: FONT, fontSize: '16px', color: '#ffffff', lineSpacing: 4 });
    this.analysisText = this.add.text(640, 360, '', { fontFamily: FONT, fontSize: '20px', color: '#ffffff', align: 'center' }).setOrigin(0.5);
    this.backHint = this.add.text(640, 690, 'Esc: voltar', { fontFamily: FONT, fontSize: '16px', color: '#ffeb3b' }).setOrigin(0.5);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input plugin not available');
    const KC = Phaser.Input.Keyboard.KeyCodes;
    keyboard.addCapture([KC.UP, KC.DOWN, KC.ENTER, KC.ESC]);
    keyboard.on('keydown-UP', () => this.move(-1));
    keyboard.on('keydown-DOWN', () => this.move(1));
    keyboard.on('keydown-ENTER', () => {
      if (this.screen === 'main') this.activate(MENU_ITEMS[this.selected].id);
    });
    keyboard.on('keydown-ESC', () => {
      if (this.screen !== 'main') this.showMain();
    });

    // Phaser drops the plugin's listeners on shutdown, but captures are global and the panel is DOM.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.leaveAnalysis();
      keyboard.clearCaptures();
    });

    this.showMain();
  }

  private move(delta: 1 | -1): void {
    if (this.screen === 'main') this.select(moveSelection(MENU_ITEMS, this.selected, delta));
  }

  private select(i: number): void {
    if (!MENU_ITEMS[i]?.enabled) return;
    this.selected = i;
    this.buttons.forEach(({ rect }, j) => {
      if (!MENU_ITEMS[j].enabled) return;
      const on = j === i;
      rect.setFillStyle(on ? COLOR.selected : COLOR.idle).setStrokeStyle(2, on ? COLOR.borderSelected : COLOR.border);
    });
  }

  private activate(id: MenuId): void {
    if (this.screen !== 'main' || this.starting) return;
    switch (id) {
      case 'play':
        this.starting = true;
        this.scene.start('ArenaScene');
        return;
      case 'howto':
        this.showScreen('howto');
        return;
      case 'analysis':
        this.showScreen('analysis');
        void this.openAnalysis();
        return;
      case 'login':
        return; // reserved for the Supabase project
    }
  }

  private showMain(): void {
    this.leaveAnalysis();
    this.showScreen('main');
    this.select(this.selected);
  }

  private showScreen(screen: Screen): void {
    this.screen = screen;
    for (const o of this.mainObjects) o.setVisible(screen === 'main');
    this.howToText.setVisible(screen === 'howto');
    this.analysisText.setVisible(screen === 'analysis').setText(screen === 'analysis' ? 'Carregando histórico...' : '');
    this.backHint.setVisible(screen !== 'main');
  }

  /** Reads the stored history once and shows it; the store is closed as soon as it was read. */
  private async openAnalysis(): Promise<void> {
    const token = ++this.analysisToken;
    // Waits for a previous ArenaScene to finish its final flush and close its store.
    const claim = claimStore(this.registry);
    let store: EventStore | null = null;
    try {
      await claim.ready;
      if (token !== this.analysisToken) return;
      const platform = createBrowserPlatform(accountFromRegistry(this.registry));
      store = (await platform.openStore()).store;
      if (token !== this.analysisToken) return;
      const input = await loadStoredAnalysis(store, platform.newUuid);
      if (token !== this.analysisToken) return;
      const panel = new AnalysisPanel(document.body);
      panel.render(buildAnalysisView(input));
      panel.setVisible(true);
      this.panel = panel;
      this.analysisText.setVisible(false);
    } catch (err) {
      console.warn('[menu] could not read the stored history', err);
      if (token === this.analysisToken) this.analysisText.setText('Não foi possível abrir o histórico.\n(Esc para voltar)');
    } finally {
      store?.close();
      claim.release();
    }
  }

  /** Destroys the Análise panel and invalidates a load still in flight. */
  private leaveAnalysis(): void {
    this.analysisToken += 1;
    this.panel?.destroy();
    this.panel = null;
  }
}
