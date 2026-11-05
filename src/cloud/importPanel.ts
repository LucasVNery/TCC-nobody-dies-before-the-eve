// DOM offer to import the pre-login local history into the account. Nothing is copied until the
// player presses Importar; Descartar leaves the old database as it is and the question is not asked again.
import { AccountOverlay, button, el } from './accountOverlay';

export interface ImportPanelOptions {
  simulated: boolean;
  /** How many events and sessions the old history holds (shown to the player). */
  eventCount: number;
  sessionCount: number;
  /** Copies the history into the account and remembers the answer; a rejection keeps the panel open for a retry. */
  runImport: () => Promise<void>;
  /** Remembers that the player declined. */
  runDiscard: () => Promise<void>;
  errorMessage: (err: unknown) => string;
  onDone: (answer: 'imported' | 'discarded') => void;
  /** Esc or "Decidir depois": nothing is remembered, the offer comes back next time. */
  onCancel: () => void;
}

export class ImportPanel {
  private readonly overlay: AccountOverlay;
  private readonly buttons: HTMLButtonElement[];
  private readonly text: HTMLDivElement;
  private busy = false;

  constructor(parent: HTMLElement, private readonly opts: ImportPanelOptions) {
    this.overlay = new AccountOverlay(parent, { title: 'Histórico deste navegador', simulated: opts.simulated, onEscape: () => this.cancel() });
    const text = el('div', 'ao-text');
    const lines = [
      `Este navegador tem um histórico de jogo anterior ao login (${opts.eventCount} eventos em ${opts.sessionCount} sessões).`,
      'Importar copia esse histórico para a sua conta: ele passa a ser enviado ao servidor e entra na análise do jogo, nos termos que você aceitou.',
      'Descartar não copia nada e não será perguntado de novo. Em ambos os casos o histórico antigo continua neste navegador, sem alteração.',
    ];
    for (const line of lines) text.appendChild(el('p', undefined, line));
    const importBtn = button('Importar', () => void this.answer('imported'));
    const discardBtn = button('Descartar', () => void this.answer('discarded'));
    const laterBtn = button('Decidir depois', () => this.cancel());
    this.buttons = [importBtn, discardBtn, laterBtn];
    const actions = el('div', 'ao-actions');
    actions.append(...this.buttons);
    this.overlay.mount(text, this.overlay.messageLine(), actions);
    // Never opens with a choice focused: a stray Enter must not answer for the player.
    this.text = text;
    this.overlay.focusContent(text);
  }

  destroy(): void {
    this.overlay.destroy();
  }

  private cancel(): void {
    if (!this.busy) this.opts.onCancel();
  }

  private async answer(kind: 'imported' | 'discarded'): Promise<void> {
    if (this.busy || !this.overlay.acceptsActivation()) return;
    this.busy = true;
    for (const b of this.buttons) b.disabled = true;
    this.overlay.focusRoot();
    this.overlay.say(kind === 'imported' ? 'Importando...' : 'Registrando...');
    try {
      await (kind === 'imported' ? this.opts.runImport() : this.opts.runDiscard());
      if (this.overlay.alive) this.opts.onDone(kind);
    } catch (err) {
      if (this.overlay.alive) this.overlay.say(this.opts.errorMessage(err), 'error');
    } finally {
      this.busy = false;
      if (this.overlay.alive) {
        for (const b of this.buttons) b.disabled = false;
        this.text.focus();
      }
    }
  }
}
