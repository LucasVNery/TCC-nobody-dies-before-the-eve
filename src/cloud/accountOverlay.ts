// DOM base of the account panels (consent, import offer, confirmations), in the AnalysisPanel style.
// Each panel is created when opened and destroyed when closed: no element, style or listener outlives it.

const CSS = `
.account-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:1001;
background:rgba(8,12,16,0.82);font:14px/1.4 ui-monospace,Consolas,Menlo,monospace;color:#d8e6d8}
.account-overlay .ao-box{width:min(560px,92vw);max-height:92vh;overflow:auto;box-sizing:border-box;padding:20px 24px;
background:#11181d;border:2px solid #607d8b}
.account-overlay h2{margin:0 0 4px;font-size:18px;color:#8fd3ff}
.account-overlay .ao-tag{margin:0 0 12px;font-size:12px;color:#ffb74d}
.account-overlay label{display:block;margin:10px 0 2px;color:#8a9a8a}
.account-overlay input{width:100%;box-sizing:border-box;padding:6px 8px;font:inherit;color:#fff;background:#263238;
border:1px solid #607d8b;outline:none}
.account-overlay input:focus{border-color:#ffeb3b}
.account-overlay .ao-text:focus{outline:none}
.account-overlay .ao-text p{margin:0 0 6px;white-space:pre-wrap}
.account-overlay .ao-msg{min-height:1.4em;margin:12px 0 0}
.account-overlay .ao-msg.error{color:#ff8a80}
.account-overlay .ao-msg.info{color:#a5d6a7}
.account-overlay .ao-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.account-overlay button{padding:8px 14px;font:inherit;color:#fff;background:#263238;border:2px solid #607d8b;cursor:pointer}
.account-overlay button:hover:not(:disabled),.account-overlay button:focus-visible{background:#37474f;border-color:#ffeb3b;outline:none}
.account-overlay button.ao-link{padding:4px 0;background:none;border:none;color:#8fd3ff;text-decoration:underline}
.account-overlay button:disabled{color:#666;cursor:default}
.account-overlay .ao-hint{margin-top:12px;font-size:12px;color:#888}
.account-overlay [hidden]{display:none}
`;

/** Events stopped at the overlay: the game (Phaser listens on window) never sees typing or clicks here. */
const STOPPED_EVENTS = ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel'] as const;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, onClick: () => void, className?: string): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** Disables (or enables) every input and button under `root`. */
export function setControlsDisabled(root: ParentNode, disabled: boolean): void {
  root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach((c) => {
    c.disabled = disabled;
  });
}

export interface OverlayOptions {
  title: string;
  /** Shows "nuvem simulada" under the title (development `?cloud=fake`). */
  simulated: boolean;
  /** Esc pressed inside the panel. */
  onEscape: () => void;
  /** Clock in ms (default performance.now). */
  now?: () => number;
}

/** How long after a panel opens its buttons ignore activation (a held or repeated key, a double click). */
export const ACTIVATION_DELAY_MS = 400;

/** Whether a button press is accepted `sinceOpenMs` after the panel opened. */
export function activationAllowed(sinceOpenMs: number, delayMs = ACTIVATION_DELAY_MS): boolean {
  return sinceOpenMs >= delayMs;
}

/**
 * Whether a keydown inside a panel is swallowed (default action prevented): an auto-repeat (a held key;
 * in a text field only a held Enter, so held Backspace or letters still work), and Enter/Space right
 * after opening (the key that opened it from the menu).
 */
export function swallowsKey(
  e: { key: string; repeat: boolean; inTextField: boolean },
  sinceOpenMs: number,
  delayMs = ACTIVATION_DELAY_MS,
): boolean {
  const activating = e.key === 'Enter' || e.key === ' ';
  if (e.repeat) return !e.inTextField || e.key === 'Enter';
  return activating && !activationAllowed(sinceOpenMs, delayMs);
}

/**
 * Full-screen backdrop with a centred box. Keyboard and pointer events are stopped here so game
 * hotkeys never fire while typing (Phaser listens on window, in the bubbling phase); Esc calls onEscape.
 */
export class AccountOverlay {
  readonly box: HTMLDivElement;
  private readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly heading: HTMLHeadingElement;
  private readonly msg: HTMLParagraphElement;
  private destroyed = false;

  private readonly onKey = (e: Event): void => {
    e.stopPropagation();
    if (e.type !== 'keydown') return;
    const k = e as KeyboardEvent;
    const inTextField = k.target instanceof HTMLInputElement;
    if (swallowsKey({ key: k.key, repeat: k.repeat, inTextField }, this.now() - this.openedAt)) {
      e.preventDefault(); // a held key (or the Enter that opened the panel) never activates a control here
      return;
    }
    if (k.key === 'Escape') {
      e.preventDefault();
      this.onEscape();
    }
  };

  private readonly onBackdrop = (e: Event): void => {
    // A click on the backdrop keeps the focus where it is (inside the box).
    if (e.target === this.root) e.preventDefault();
  };

  private readonly onEscape: () => void;
  private readonly now: () => number;
  private readonly openedAt: number;

  constructor(parent: HTMLElement, opts: OverlayOptions) {
    this.onEscape = opts.onEscape;
    this.now = opts.now ?? (() => performance.now());
    this.openedAt = this.now();
    this.style = el('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = el('div', 'account-overlay');
    this.root.tabIndex = -1;
    this.box = el('div', 'ao-box');
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-modal', 'true');
    this.heading = el('h2', undefined, opts.title);
    this.box.appendChild(this.heading);
    if (opts.simulated) this.box.appendChild(el('p', 'ao-tag', 'nuvem simulada (desenvolvimento)'));
    this.msg = el('p', 'ao-msg');
    this.msg.setAttribute('role', 'status');
    for (const type of STOPPED_EVENTS) this.root.addEventListener(type, this.onKey);
    this.root.addEventListener('mousedown', this.onBackdrop);
    this.root.appendChild(this.box);
    parent.appendChild(this.root);
  }

  /** False once destroyed: async results arriving later must not touch the DOM. */
  get alive(): boolean {
    return !this.destroyed;
  }

  setTitle(title: string): void {
    this.heading.textContent = title;
  }

  /** Appends nodes to the box, in order (include messageLine() where the status text goes). */
  mount(...nodes: HTMLElement[]): void {
    for (const n of nodes) this.box.appendChild(n);
  }

  messageLine(): HTMLParagraphElement {
    return this.msg;
  }

  say(text: string, kind: 'error' | 'info' = 'info'): void {
    this.msg.textContent = text;
    this.msg.className = `ao-msg ${text ? kind : ''}`;
  }

  /** False during the first ACTIVATION_DELAY_MS after opening: button handlers ignore the press. */
  acceptsActivation(): boolean {
    return activationAllowed(this.now() - this.openedAt);
  }

  /** Makes `node` focusable (not tabbable) and focuses it: the panel opens with no button focused. */
  focusContent(node: HTMLElement): void {
    node.tabIndex = -1;
    node.focus();
  }

  /** Keeps the keyboard inside the overlay while its controls are disabled (a disabled input loses focus). */
  focusRoot(): void {
    this.root.focus();
  }

  /** Focuses the first enabled input (or button) of the box. */
  focusFirst(): void {
    const first = this.box.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])');
    (first ?? this.root).focus();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // No panel has inputs now (sign-in is Clerk's window); any typed text would be cleared before leaving the DOM.
    this.box.querySelectorAll('input').forEach((input) => {
      input.value = '';
    });
    for (const type of STOPPED_EVENTS) this.root.removeEventListener(type, this.onKey);
    this.root.removeEventListener('mousedown', this.onBackdrop);
    this.root.remove();
    this.style.remove();
  }
}

export interface ConfirmPanelOptions {
  title: string;
  lines: readonly string[];
  confirmLabel: string;
  busyLabel: string;
  simulated: boolean;
  /** The confirmed action; a rejection shows `errorMessage(err)` and keeps the panel open. */
  run: () => Promise<void>;
  errorMessage: (err: unknown) => string;
  onDone: () => void;
  onCancel: () => void;
}

/** A yes/no confirmation that runs an async action (e.g. Apagar meus dados). */
export class ConfirmPanel {
  private readonly overlay: AccountOverlay;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private busy = false;

  constructor(parent: HTMLElement, private readonly opts: ConfirmPanelOptions) {
    this.overlay = new AccountOverlay(parent, { title: opts.title, simulated: opts.simulated, onEscape: () => this.cancel() });
    const text = el('div', 'ao-text');
    for (const line of opts.lines) text.appendChild(el('p', undefined, line));
    this.confirmBtn = button(opts.confirmLabel, () => void this.confirm());
    this.cancelBtn = button('Cancelar', () => this.cancel());
    const actions = el('div', 'ao-actions');
    actions.append(this.cancelBtn, this.confirmBtn);
    this.overlay.mount(text, this.overlay.messageLine(), actions);
    this.cancelBtn.focus();
  }

  destroy(): void {
    this.overlay.destroy();
  }

  private cancel(): void {
    if (!this.busy) this.opts.onCancel();
  }

  private async confirm(): Promise<void> {
    if (this.busy || !this.overlay.acceptsActivation()) return;
    this.busy = true;
    this.confirmBtn.disabled = this.cancelBtn.disabled = true;
    this.overlay.focusRoot();
    this.overlay.say(this.opts.busyLabel);
    try {
      await this.opts.run();
      if (this.overlay.alive) this.opts.onDone();
    } catch (err) {
      if (!this.overlay.alive) return;
      this.overlay.say(this.opts.errorMessage(err), 'error');
    } finally {
      this.busy = false;
      if (this.overlay.alive) {
        this.confirmBtn.disabled = this.cancelBtn.disabled = false;
        this.cancelBtn.focus();
      }
    }
  }
}
