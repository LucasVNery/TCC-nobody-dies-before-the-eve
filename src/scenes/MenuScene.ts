// src/scenes/MenuScene.ts
import Phaser from 'phaser';
import { MENU_ITEMS, firstEnabled, moveSelection, type MenuId, type MenuItem } from './menu/menuModel';
import { accountStatusLine, buildMenuItems, cloudErrorMessage, keepSelection, playAction, type CloudStatus } from './menu/menuState';
import { howToPlayLines } from './menu/howToPlay';
import { LOCAL_ACCESS, toolKeysEnabled } from './input/debugKeys';
import { loadStoredAnalysis } from './menu/storedAnalysis';
import { createBrowserPlatform, openBrowserAccountStore } from './session/browserPlatform';
import { accountFromRegistry, accountDbName, LocalDataBlockedError, type Account } from '../cloud/account';
import { ConsentPanel } from '../cloud/consentPanel';
import { ImportPanel } from '../cloud/importPanel';
import { adoptHistory, readLocalGuestHistory, readLegacyMarker, writeLegacyMarker, LEGACY_IMPORT_KEY, type LegacyImportAnswer } from '../cloud/adoptLocal';
import { ConfirmPanel } from '../cloud/accountOverlay';
import {
  SignInWindowWatch,
  browserSignInWindowDeps,
  holdKeyboard,
  holdsKeyboard,
  shouldShieldKeyTarget,
  type SignInWindowPhase,
} from '../cloud/clerkWindow';
import { claimStore } from './session/storeHandoff';
import { IndexedDbEventStore, type EventStore } from '../telemetry/eventStore';
import { GAME_VERSION, type LoggedEvent } from '../telemetry/schema';
import { buildAnalysisView } from '../debug/analysis/analysisViewModel';
import { AnalysisPanel } from '../debug/analysis/analysisPanel';

type Screen = 'main' | 'howto' | 'analysis' | 'panel';
type PanelKind = 'consent' | 'deleteData' | 'import';

const FONT = 'monospace';
const OPENING_NOTICE = 'abrindo a janela de login…';
const SHIELDED_KEY_EVENTS = ['keydown', 'keyup', 'keypress'] as const;
const MENU_KEYS = [
  Phaser.Input.Keyboard.KeyCodes.UP,
  Phaser.Input.Keyboard.KeyCodes.DOWN,
  Phaser.Input.Keyboard.KeyCodes.ENTER,
  Phaser.Input.Keyboard.KeyCodes.ESC,
];
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
 * mode, Entrar / Criar conta opens Clerk's own sign-in window; the consent, the import offer and the
 * delete confirmation are our DOM panels, created on open and destroyed on close; while one is open
 * the menu ignores its own keys. While Clerk's window is open (seen in the DOM, see SignInWindowWatch)
 * the game's keyboard is switched off and the menu's key captures are released, so Clerk's form gets
 * every key (Enter included) and nothing reaches Phaser.
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
  /** The user whose pre-login history was already looked at in this visit to the menu (asked at most once per visit). */
  private importCheckedFor: string | null = null;
  /** False after shutdown: late async results must not touch destroyed objects. */
  private alive = false;
  /** The sign-in attempt in progress (Clerk's window asked for, on screen, or late), if any. */
  private signInWatch: SignInWindowWatch | null = null;
  /** Clerk's window did not show up in time: the menu offers to try again. */
  private signInStalled = false;
  /** The keyboard is left to Clerk's window: menu keys ignored, captures released, Phaser's keyboard off. */
  private clerkHolding = false;
  /** Gives the keyboard back (set while clerkHolding). */
  private releaseKeyboard: ((recapture?: boolean) => void) | null = null;
  /** The notice line shows OPENING_NOTICE (cleared once the window shows up, or the attempt ends). */
  private openingNotice = false;

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
    this.importCheckedFor = null;
    this.signInWatch = null;
    this.signInStalled = false;
    this.clerkHolding = false;
    this.releaseKeyboard = null;
    this.openingNotice = false;
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
    keyboard.addCapture(MENU_KEYS);
    // Belt and braces: Phaser's keyboard is off while Clerk's window is open, so these do not fire then.
    keyboard.on('keydown-UP', () => this.move(-1));
    keyboard.on('keydown-DOWN', () => this.move(1));
    keyboard.on('keydown-ENTER', () => {
      if (this.screen === 'main' && !this.clerkHolding) this.activate(this.items[this.selected].id);
    });
    keyboard.on('keydown-ESC', () => {
      // Account panels handle their own Esc (their key events never reach Phaser).
      if (this.clerkHolding) return;
      if (this.screen === 'howto' || this.screen === 'analysis') this.showMain();
    });

    const offAccount = this.account?.onChange(() => this.onAccountChange());
    // Playing as the last user restored offline (Clerk could not load): each return to the menu tries Clerk again.
    if (this.account?.offline && this.account.loadError) void this.account.retry();

    // Keys typed into any DOM UI (Clerk's window, whatever its markup; any focused control) never reach the
    // game: stopped on the document, after the target's own handlers ran and before Phaser's window listener.
    // No preventDefault, so Clerk's form still gets Enter. Independent of the DOM watch below.
    const canvas = this.game.canvas;
    const shield = (e: Event): void => {
      if (shouldShieldKeyTarget(e.target, canvas)) e.stopPropagation();
    };
    for (const type of SHIELDED_KEY_EVENTS) document.addEventListener(type, shield);

    // Phaser drops the plugin's listeners on shutdown, but captures are global and the panels are DOM.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.alive = false;
      offAccount?.();
      for (const type of SHIELDED_KEY_EVENTS) document.removeEventListener(type, shield);
      this.signInWatch?.stop();
      this.signInWatch = null;
      this.setClerkHolding(false); // Phaser's keyboard is the game's, not the scene's: give it back
      this.closeAccountPanel();
      this.leaveAnalysis();
      keyboard.clearCaptures();
    });

    this.buildButtons();
    this.showMain();
    this.onAccountChange();
  }

  private currentItems(): MenuItem[] {
    return this.account ? buildMenuItems(this.account.state, this.cloudStatus(this.account)) : MENU_ITEMS.map((i) => ({ ...i }));
  }

  /** Clerk loading, or a failure to retry (it could not load, or its window never showed up). */
  private cloudStatus(account: Account): CloudStatus {
    return { loading: account.loading, failed: account.loadError !== null || this.signInStalled, offline: account.offline };
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

  /** The account changed (sign-in/out, consent, deletion, Clerk loading): rebuild the items, follow with the panels. */
  private onAccountChange(): void {
    if (!this.alive) return;
    if (this.account?.state.user) this.signInStalled = false;
    // A sign-in ends the attempt once Clerk's window is gone (it may report back here, harmlessly).
    this.signInWatch?.sessionChanged(this.account?.state.user != null);
    const prevId = this.items[this.selected]?.id;
    this.items = this.currentItems();
    this.selected = keepSelection(this.items, prevId);
    this.buildButtons();
    const account = this.account;
    this.statusText.setText(account ? accountStatusLine(account.state, account.simulated, this.cloudStatus(account)) : '');
    if (!account || account.mode !== 'cloud') return;
    const signedIn = account.state.user !== null;
    const kind = this.accountPanel?.kind;
    // The session ended while a signed-in panel was open.
    if ((kind === 'consent' || kind === 'deleteData' || kind === 'import') && !signedIn) this.closeAccountPanel();
    // The consent is on the server already (our own acceptance, or the details finished loading after
    // Jogar opened the term): the player asked to play, so the run starts (startGame runs once).
    if (kind === 'consent' && playAction(account.state) === 'start') {
      this.closeAccountPanel();
      this.startGame();
      return;
    }
    if (signedIn && account.state.termsAccepted) void this.maybeOfferImport(account);
  }

  private move(delta: 1 | -1): void {
    if (this.screen === 'main' && !this.clerkHolding) this.select(moveSelection(this.items, this.selected, delta));
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
    if (this.screen !== 'main' || this.starting || this.accountBusy || this.clerkHolding) return;
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
        // Clerk's own window signs in or creates the account; the result arrives as an account change.
        if (account?.mode === 'cloud') this.openSignIn(account); // local mode: no accounts (the item is inert)
        return;
      case 'retry':
        if (account?.mode !== 'cloud') return;
        if (account.loadError) void account.retry(); // Clerk could not load: load it again (the menu shows "carregando")
        else this.openSignIn(account); // Clerk loaded but its window never showed up: ask again
        return;
      case 'logout':
        if (account) void this.signOut(account);
        return;
      case 'deleteData':
        if (account) this.openDeleteData(account);
        return;
    }
  }

  // --- Clerk's sign-in window ---------------------------------------------------

  /** Opens Clerk's window, following it in the DOM; the keyboard is Clerk's until it closes (or fails to show up). */
  private openSignIn(account: Account): void {
    this.signInWatch?.stop();
    this.signInStalled = false;
    this.setClerkHolding(true);
    this.setNotice(OPENING_NOTICE);
    this.openingNotice = true;
    // Created before openSignIn: the simulated cloud signs in synchronously, inside that call.
    this.signInWatch = new SignInWindowWatch(browserSignInWindowDeps(), (phase) => this.onSignInPhase(phase));
    try {
      account.openSignIn();
    } catch (err) {
      console.warn('[menu] could not open the sign-in window', err); // the timeout offers a retry
    }
  }

  private onSignInPhase(phase: SignInWindowPhase): void {
    if (!this.alive) return;
    if (phase === 'ended') this.signInWatch = null;
    // A window closed without signing in leaves the menu as it was, with no message.
    if (phase === 'stalled') this.signInStalled = true;
    if (phase === 'open') this.signInStalled = false; // a late window: no retry entry left once it closes
    if (phase !== 'waiting' && this.openingNotice) {
      this.openingNotice = false;
      this.setNotice('');
    }
    this.setClerkHolding(holdsKeyboard(phase));
    this.onAccountChange(); // the items (retry entry) and the import offer, which waits for the window to close
  }

  /**
   * Leaves the keyboard to Clerk's window (true) or takes it back (false), see holdKeyboard: Phaser's keyboard
   * manager ignores events while disabled, before its preventDefault, so Clerk's form gets Enter; the captures
   * are released too, and come back on release (not after shutdown).
   */
  private setClerkHolding(hold: boolean): void {
    if (hold === this.clerkHolding) return;
    this.clerkHolding = hold;
    if (hold) {
      this.releaseKeyboard = holdKeyboard(this.input.keyboard, this.input.manager.keyboard, MENU_KEYS);
    } else {
      this.releaseKeyboard?.(this.alive);
      this.releaseKeyboard = null;
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

  /** Whether the menu is idle: nothing running, no panel open, signed-in state unchanged. */
  private canOfferImport(account: Account, userId: string): boolean {
    return (
      this.alive &&
      !this.starting &&
      !this.accountBusy &&
      !this.clerkHolding &&
      this.screen === 'main' &&
      this.accountPanel === null &&
      account.state.user?.id === userId &&
      account.state.termsAccepted
    );
  }

  /**
   * Offers to import the browser's pre-login history into the account. Only once the account accepted the
   * current terms, from the menu with no game running, and at most once per visit; a failure to look is
   * silent (the offer comes back next time) and never blocks the menu. The old database is only read.
   */
  private async maybeOfferImport(account: Account): Promise<void> {
    const user = account.state.user;
    if (!user || account.mode !== 'cloud' || this.importCheckedFor === user.id || !this.canOfferImport(account, user.id)) return;
    this.importCheckedFor = user.id;
    let history: LoggedEvent[] = [];
    try {
      // One account per browser takes (or declines) the old history: the marker lives outside every database.
      if (readLegacyMarker() !== null) return;
      history = await readLocalGuestHistory();
      if (history.length > 0) {
        // Only the account's local meta is read (no sync store): menu visits cause no cloud traffic.
        const local = await IndexedDbEventStore.open(indexedDB, accountDbName(user.id));
        try {
          if ((await local.getMeta<LegacyImportAnswer>(LEGACY_IMPORT_KEY)) !== undefined) return; // this account answered before
        } finally {
          local.close();
        }
      }
    } catch (err) {
      console.warn('[menu] could not look at the pre-login history', err);
      return;
    }
    if (history.length === 0 || !this.canOfferImport(account, user.id)) return;
    this.openImport(account, user.id, history);
  }

  private openImport(account: Account, userId: string, history: readonly LoggedEvent[]): void {
    /** Opens the account's own store, runs `work` on it and closes it, with no game holding the store. */
    const withAccountStore = async (work: (store: EventStore) => Promise<void>): Promise<void> => {
      const claim = claimStore(this.registry);
      try {
        await claim.ready;
        const opened = await openBrowserAccountStore(account);
        if (!opened) throw new Error('no signed-in account');
        try {
          // Never write into another account's (or the pre-login) database.
          if (account.state.user?.id !== userId || (await opened.store.getMeta<string>('player_id')) !== userId) {
            throw new Error('the signed-in account changed');
          }
          await work(opened.store);
        } finally {
          opened.store.close();
        }
      } finally {
        claim.release();
      }
    };
    this.openPanel('import', () =>
      new ImportPanel(document.body, {
        simulated: account.simulated,
        eventCount: history.length,
        sessionCount: new Set(history.map((e) => e.session_id)).size,
        runImport: () =>
          withAccountStore(async (store) => {
            await adoptHistory(await readLocalGuestHistory(), userId, store);
            await store.setMeta(LEGACY_IMPORT_KEY, 'imported' satisfies LegacyImportAnswer);
            writeLegacyMarker(userId, 'imported');
          }),
        runDiscard: () =>
          withAccountStore(async (store) => {
            await store.setMeta(LEGACY_IMPORT_KEY, 'discarded' satisfies LegacyImportAnswer);
            writeLegacyMarker(userId, 'discarded');
          }),
        errorMessage: () => 'Não foi possível concluir agora. Tente de novo, ou escolha "Decidir depois".',
        onDone: (answer) => {
          this.closeAccountPanel();
          this.setNotice(answer === 'imported' ? 'Histórico anterior importado para a sua conta.' : 'Histórico anterior descartado (continua só neste navegador).');
        },
        onCancel: () => this.closeAccountPanel(),
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
          'Isto apaga o histórico de jogo desta conta na nuvem e neste navegador, e o aceite do termo.',
          'O histórico anterior ao login deste navegador (de antes de entrar na conta) NÃO é apagado.',
          'A conta e o e-mail continuam existindo; para jogar de novo será pedido o aceite.',
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
        errorMessage: (err) => (err instanceof LocalDataBlockedError ? err.message : cloudErrorMessage(err)),
        onDone: () => {
          this.closeAccountPanel();
          this.setNotice('Os dados da conta foram apagados (nuvem e este navegador).\nO histórico anterior ao login deste navegador não foi apagado.');
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
