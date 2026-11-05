// src/scenes/MenuScene.ts
import Phaser from 'phaser';
import { MENU_ITEMS, firstEnabled, moveSelection, type MenuId, type MenuItem } from './menu/menuModel';
import { accountStatusLine, buildMenuItems, cloudErrorMessage, keepSelection, playAction } from './menu/menuState';
import { howToPlayLines } from './menu/howToPlay';
import { LOCAL_ACCESS, toolKeysEnabled } from './input/debugKeys';
import { loadStoredAnalysis } from './menu/storedAnalysis';
import { createBrowserPlatform } from './session/browserPlatform';
import { accountFromRegistry, type Account } from '../cloud/account';
import { AuthPanel, NewPasswordPanel } from '../cloud/authPanel';
import { ConsentPanel } from '../cloud/consentPanel';
import { ConfirmPanel } from '../cloud/accountOverlay';
import { claimStore } from './session/storeHandoff';
import type { EventStore } from '../telemetry/eventStore';
import { GAME_VERSION } from '../telemetry/schema';
import { buildAnalysisView } from '../debug/analysis/analysisViewModel';
import { AnalysisPanel } from '../debug/analysis/analysisPanel';

type Screen = 'main' | 'howto' | 'analysis' | 'panel';
type PanelKind = 'auth' | 'consent' | 'deleteData' | 'newPassword';

const FONT = 'monospace';
const BUTTON_W = 480;
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
 * Up/Down + Enter. Como jogar and Análise are sub-screens closed with Esc.
 * Análise is read-only: it reads the stored history (after the previous store holder released it),
 * closes the store right away and never logs an event.
 * The items follow the Account (see buildMenuItems) and are rebuilt whenever it changes. In cloud
 * mode the account screens (login, consent, new password, delete confirmation) are DOM panels created
 * on open and destroyed on close; while one is open the menu ignores its own keys.
 */
export class MenuScene extends Phaser.Scene {
  private screen: Screen = 'main';
  private selected = 0;
  private account: Account | undefined;
  private items: MenuItem[] = [];
  private buttons: { rect: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];
  private mainObjects: Phaser.GameObjects.Text[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private noticeText!: Phaser.GameObjects.Text;
  private howToText!: Phaser.GameObjects.Text;
  private analysisText!: Phaser.GameObjects.Text;
  private backHint!: Phaser.GameObjects.Text;
  private panel: AnalysisPanel | null = null;
  private accountPanel: { kind: PanelKind; destroy(): void } | null = null;
  /** Bumped whenever the Análise screen is left: a stale load drops its result. */
  private analysisToken = 0;
  /** Set once Jogar queued the scene switch, so a click + Enter in the same frame cannot queue two starts. */
  private starting = false;
  /** A sign-out is running: no other action starts meanwhile. */
  private accountBusy = false;
  /** False after shutdown: late async results must not touch destroyed objects. */
  private alive = false;

  constructor() {
    super('MenuScene');
  }

  create(): void {
    this.screen = 'main';
    this.account = accountFromRegistry(this.registry);
    this.items = this.currentItems();
    this.selected = firstEnabled(this.items);
    this.buttons = [];
    this.panel = null;
    this.accountPanel = null;
    this.starting = false; // the scene object is reused when the Arena comes back here
    this.accountBusy = false;
    this.alive = true;

    const title = this.add.text(640, 120, 'TCC · arena adaptativa', { fontFamily: FONT, fontSize: '40px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    const version = this.add.text(640, 172, `protótipo ${GAME_VERSION}`, { fontFamily: FONT, fontSize: '16px', color: '#aaaaaa' }).setOrigin(0.5);
    this.statusText = this.add.text(640, 210, '', { fontFamily: FONT, fontSize: '16px', color: '#8fd3ff' }).setOrigin(0.5);
    this.noticeText = this.add.text(640, 610, '', { fontFamily: FONT, fontSize: '16px', color: '#a5d6a7', align: 'center' }).setOrigin(0.5);
    const hint = this.add.text(640, 660, '↑/↓ + Enter ou mouse', { fontFamily: FONT, fontSize: '14px', color: '#888888' }).setOrigin(0.5);
    this.mainObjects = [title, version, this.statusText, this.noticeText, hint];

    this.howToText = this.add.text(60, 40, '', { fontFamily: FONT, fontSize: '16px', color: '#ffffff', lineSpacing: 4 });
    this.analysisText = this.add.text(640, 360, '', { fontFamily: FONT, fontSize: '20px', color: '#ffffff', align: 'center' }).setOrigin(0.5);
    this.backHint = this.add.text(640, 690, 'Esc: voltar', { fontFamily: FONT, fontSize: '16px', color: '#ffeb3b' }).setOrigin(0.5);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input plugin not available');
    const KC = Phaser.Input.Keyboard.KeyCodes;
    keyboard.addCapture([KC.UP, KC.DOWN, KC.ENTER, KC.ESC]);
    keyboard.on('keydown-UP', () => this.move(-1));
    keyboard.on('keydown-DOWN', () => this.move(1));
    keyboard.on('keydown-ENTER', () => {
      if (this.screen === 'main') this.activate(this.items[this.selected].id);
    });
    keyboard.on('keydown-ESC', () => {
      // Account panels handle their own Esc (their key events never reach Phaser).
      if (this.screen === 'howto' || this.screen === 'analysis') this.showMain();
    });

    const offAccount = this.account?.onChange(() => this.onAccountChange());

    // Phaser drops the plugin's listeners on shutdown, but captures are global and the panels are DOM.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.alive = false;
      offAccount?.();
      this.closeAccountPanel();
      this.leaveAnalysis();
      keyboard.clearCaptures();
    });

    this.buildButtons();
    this.showMain();
    this.onAccountChange();
  }

  private currentItems(): MenuItem[] {
    return this.account ? buildMenuItems(this.account.state) : MENU_ITEMS.map((i) => ({ ...i }));
  }

  /** (Re)creates the buttons for this.items. */
  private buildButtons(): void {
    for (const { rect, label } of this.buttons) {
      rect.destroy();
      label.destroy();
    }
    this.buttons = [];
    const visible = this.screen === 'main';
    this.items.forEach((item, i) => {
      const y = BUTTONS_TOP + i * (BUTTON_H + BUTTON_GAP);
      const rect = this.add.rectangle(640, y, BUTTON_W, BUTTON_H, item.enabled ? COLOR.idle : COLOR.disabled).setStrokeStyle(2, COLOR.border);
      const label = this.add.text(640, y, item.label, { fontFamily: FONT, fontSize: '22px', color: item.enabled ? '#ffffff' : '#666666' }).setOrigin(0.5);
      if (item.enabled) {
        rect.setInteractive({ useHandCursor: true });
        rect.on('pointerover', () => this.select(i));
        rect.on('pointerdown', () => this.activate(item.id));
      }
      rect.setVisible(visible);
      label.setVisible(visible);
      this.buttons.push({ rect, label });
    });
    this.select(this.selected);
  }

  /** The account changed (sign-in/out, consent, deletion, recovery link): rebuild the items, follow with the panels. */
  private onAccountChange(): void {
    if (!this.alive) return;
    const prevId = this.items[this.selected]?.id;
    this.items = this.currentItems();
    this.selected = keepSelection(this.items, prevId);
    this.buildButtons();
    const account = this.account;
    this.statusText.setText(account ? accountStatusLine(account.state, account.simulated) : '');
    if (!account || account.mode !== 'cloud') return;
    const signedIn = account.state.user !== null;
    const kind = this.accountPanel?.kind;
    // Signed in by another path (session restored, another tab): the login form has nothing left to do.
    if (kind === 'auth' && signedIn) this.closeAccountPanel();
    // The session ended while a signed-in panel was open.
    if ((kind === 'consent' || kind === 'deleteData' || kind === 'newPassword') && !signedIn) this.closeAccountPanel();
    // The consent is on the server already (our own acceptance, or the details finished loading after
    // Jogar opened the term): the player asked to play, so the run starts (startGame runs once).
    if (kind === 'consent' && playAction(account.state) === 'start') {
      this.closeAccountPanel();
      this.startGame();
      return;
    }
    if (account.passwordRecovery && signedIn && this.accountPanel?.kind !== 'newPassword') this.openNewPassword(account);
  }

  private move(delta: 1 | -1): void {
    if (this.screen === 'main') this.select(moveSelection(this.items, this.selected, delta));
  }

  private select(i: number): void {
    if (!this.items[i]?.enabled) return;
    this.selected = i;
    this.buttons.forEach(({ rect }, j) => {
      if (!this.items[j]?.enabled) return;
      const on = j === i;
      rect.setFillStyle(on ? COLOR.selected : COLOR.idle).setStrokeStyle(2, on ? COLOR.borderSelected : COLOR.border);
    });
  }

  private activate(id: MenuId): void {
    if (this.screen !== 'main' || this.starting || this.accountBusy) return;
    const item = this.items.find((i) => i.id === id);
    if (!item?.enabled) return;
    this.setNotice('');
    const account = this.account;
    switch (id) {
      case 'play': {
        const action = account ? playAction(account.state) : 'start';
        if (action === 'start') this.startGame();
        else if (action === 'terms' && account) this.openConsent(account);
        return; // 'blocked': cloud mode, nobody signed in (the item is disabled anyway)
      }
      case 'howto':
        this.showScreen('howto');
        return;
      case 'analysis':
        this.showScreen('analysis');
        void this.openAnalysis();
        return;
      case 'login':
        if (account?.mode === 'cloud') this.openAuth(account);
        return; // local mode: no accounts
      case 'logout':
        if (account) void this.signOut(account);
        return;
      case 'deleteData':
        if (account) this.openDeleteData(account);
        return;
    }
  }

  private startGame(): void {
    if (this.starting || !this.alive) return;
    this.starting = true;
    this.scene.start('ArenaScene');
  }

  private setNotice(text: string, error = false): void {
    if (!this.alive) return;
    this.noticeText.setText(text).setColor(error ? '#ff8a80' : '#a5d6a7');
  }

  // --- account panels ------------------------------------------------------

  private openPanel(kind: PanelKind, make: () => { destroy(): void }): void {
    this.closeAccountPanel();
    this.leaveAnalysis();
    this.showScreen('panel');
    const panel = make();
    this.accountPanel = { kind, destroy: () => panel.destroy() };
  }

  /** Destroys the open account panel (if any) and shows the menu again. */
  private closeAccountPanel(): void {
    const open = this.accountPanel;
    if (!open) return;
    this.accountPanel = null;
    open.destroy();
    if (this.alive && this.screen === 'panel') this.showMain();
  }

  private openAuth(account: Account): void {
    this.openPanel('auth', () =>
      new AuthPanel(document.body, {
        simulated: account.simulated,
        actions: {
          signIn: (email, password) => account.signIn(email, password),
          signUp: (email, password) => account.signUp(email, password),
          resetPassword: (email) => account.resetPassword(email),
        },
        onDone: () => this.closeAccountPanel(),
        onCancel: () => this.closeAccountPanel(),
      }),
    );
  }

  private openConsent(account: Account): void {
    this.openPanel('consent', () =>
      new ConsentPanel(document.body, {
        simulated: account.simulated,
        accept: () => account.acceptTerms(),
        onAccepted: () => {
          this.closeAccountPanel();
          // Only once the acceptance is on the server (acceptTerms resolved) does the run start. Usually
          // onAccountChange already started it when termsAccepted flipped; startGame runs once.
          if (this.alive && playAction(account.state) === 'start') this.startGame();
        },
        onCancel: () => this.closeAccountPanel(),
      }),
    );
  }

  private openNewPassword(account: Account): void {
    this.openPanel('newPassword', () =>
      new NewPasswordPanel(document.body, {
        simulated: account.simulated,
        email: account.state.user?.email ?? '',
        updatePassword: (password) => account.updatePassword(password),
        onDone: () => {
          this.closeAccountPanel();
          this.setNotice('Senha alterada.');
        },
        onCancel: () => {
          this.closeAccountPanel(); // first: the account change below must not reopen it
          account.dismissPasswordRecovery();
        },
      }),
    );
  }

  /**
   * Deletes the account's cloud data and its local database, from the menu with no game running
   * (it first waits for a previous Arena to release its store). The pre-login database is not touched.
   */
  private openDeleteData(account: Account): void {
    this.openPanel('deleteData', () =>
      new ConfirmPanel(document.body, {
        title: 'Apagar meus dados',
        lines: [
          'Isto apaga todo o seu histórico de jogo na nuvem e neste navegador, e o aceite do termo.',
          'A conta continua existindo; para jogar de novo será pedido o aceite.',
          'Não é possível desfazer.',
        ],
        confirmLabel: 'Apagar tudo',
        busyLabel: 'Apagando...',
        simulated: account.simulated,
        run: async () => {
          const claim = claimStore(this.registry);
          try {
            await claim.ready;
            await account.deleteMyData();
          } finally {
            claim.release();
          }
        },
        errorMessage: cloudErrorMessage,
        onDone: () => {
          this.closeAccountPanel();
          this.setNotice('Seus dados foram apagados (nuvem e este navegador).');
        },
        onCancel: () => this.closeAccountPanel(),
      }),
    );
  }

  /** Ends the session after a previous Arena released its store (its last push is waited for by the Account). */
  private async signOut(account: Account): Promise<void> {
    this.accountBusy = true;
    this.setNotice('Saindo...');
    const claim = claimStore(this.registry);
    try {
      await claim.ready;
      await account.signOut();
      this.setNotice('Você saiu da conta.');
    } catch (err) {
      this.setNotice(cloudErrorMessage(err), true);
    } finally {
      claim.release();
      this.accountBusy = false;
    }
  }

  // --- screens ---------------------------------------------------------------

  private showMain(): void {
    this.leaveAnalysis();
    this.showScreen('main');
    this.select(this.selected);
  }

  private showScreen(screen: Screen): void {
    this.screen = screen;
    for (const o of this.mainObjects) o.setVisible(screen === 'main');
    for (const { rect, label } of this.buttons) {
      rect.setVisible(screen === 'main');
      label.setVisible(screen === 'main');
    }
    // Re-read on every show: the account (and with it the development keys) may have changed.
    if (screen === 'howto') this.howToText.setText([...howToPlayLines(toolKeysEnabled(this.account?.state ?? LOCAL_ACCESS))]);
    this.howToText.setVisible(screen === 'howto');
    this.analysisText.setVisible(screen === 'analysis').setText(screen === 'analysis' ? 'Carregando histórico...' : '');
    this.backHint.setVisible(screen === 'howto' || screen === 'analysis');
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
      const platform = createBrowserPlatform(this.account);
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
