// DOM consent term shown before the first run of an account. The game goes on only after the
// acceptance was written to the server (Account.acceptTerms resolved).
import { AccountOverlay, button, el } from './accountOverlay';
import { CONSENT_TEXT, TERMS_VERSION } from './consentText';
import { cloudErrorMessage } from '../scenes/menu/menuState';

export interface ConsentPanelOptions {
  simulated: boolean;
  /** Writes the acceptance to the server. */
  accept: () => Promise<void>;
  onAccepted: () => void;
  onCancel: () => void;
}

export class ConsentPanel {
  private readonly overlay: AccountOverlay;
  private readonly acceptBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly text: HTMLDivElement;
  private busy = false;

  constructor(parent: HTMLElement, private readonly opts: ConsentPanelOptions) {
    this.overlay = new AccountOverlay(parent, { title: 'Termo de consentimento', simulated: opts.simulated, onEscape: () => this.cancel() });
    const text = el('div', 'ao-text');
    // The source lines are wrapped by hand; blank lines separate the paragraphs.
    const paragraphs = CONSENT_TEXT.join('\n').split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim());
    for (const p of paragraphs) if (p) text.appendChild(el('p', undefined, p));
    this.acceptBtn = button('Aceito e quero jogar', () => void this.accept());
    this.cancelBtn = button('Não aceito (voltar)', () => this.cancel());
    const actions = el('div', 'ao-actions');
    actions.append(this.acceptBtn, this.cancelBtn);
    this.overlay.mount(text, el('div', 'ao-hint', `versão do termo: ${TERMS_VERSION}`), this.overlay.messageLine(), actions);
    // Informed consent: never open with the accept button focused (a held or Shift+Enter from the menu
    // would accept unread). The text gets the focus; accepting takes a deliberate Tab/click.
    this.text = text;
    this.overlay.focusContent(text);
  }

  destroy(): void {
    this.overlay.destroy();
  }

  private cancel(): void {
    if (!this.busy) this.opts.onCancel();
  }

  private async accept(): Promise<void> {
    if (this.busy || !this.overlay.acceptsActivation()) return;
    this.busy = true;
    this.acceptBtn.disabled = this.cancelBtn.disabled = true;
    this.overlay.focusRoot();
    this.overlay.say('Registrando o aceite...');
    try {
      await this.opts.accept();
      if (this.overlay.alive) this.opts.onAccepted();
    } catch (err) {
      if (this.overlay.alive) this.overlay.say(cloudErrorMessage(err), 'error');
    } finally {
      this.busy = false;
      if (this.overlay.alive) {
        this.acceptBtn.disabled = this.cancelBtn.disabled = false;
        this.text.focus();
      }
    }
  }
}
