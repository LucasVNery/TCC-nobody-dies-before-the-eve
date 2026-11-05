// DOM e-mail/password forms of the menu: sign in, create an account, forgot the password, and the
// new password asked after a recovery link. Shown only in cloud mode. Passwords are read from the
// inputs at submit time and passed on; they are never stored, logged or put in a URL.
import { AccountOverlay, button, el, setControlsDisabled } from './accountOverlay';
import { cloudErrorMessage, emailProblem, newPasswordProblem, type ErrorContext } from '../scenes/menu/menuState';

export type AuthMode = 'signin' | 'signup' | 'reset';

export interface AuthActions {
  signIn(email: string, password: string): Promise<unknown>;
  signUp(email: string, password: string): Promise<{ needsEmailConfirmation: boolean }>;
  resetPassword(email: string): Promise<void>;
}

export interface AuthPanelOptions {
  simulated: boolean;
  actions: AuthActions;
  /** Signed in: the menu closes the panel. */
  onDone: () => void;
  onCancel: () => void;
}

const TITLES: Record<AuthMode, string> = { signin: 'Entrar', signup: 'Criar conta', reset: 'Esqueci a senha' };
const SUBMIT: Record<AuthMode, string> = { signin: 'Entrar', signup: 'Criar conta', reset: 'Enviar link' };
const BUSY: Record<AuthMode, string> = { signin: 'Entrando...', signup: 'Criando a conta...', reset: 'Enviando...' };

function field(label: string, type: string, autocomplete: string): { wrap: HTMLLabelElement; input: HTMLInputElement } {
  const wrap = el('label', undefined, label);
  const input = el('input');
  input.type = type;
  input.autocomplete = autocomplete as AutoFill;
  input.spellcheck = false;
  wrap.appendChild(input);
  return { wrap, input };
}

export class AuthPanel {
  private readonly overlay: AccountOverlay;
  private readonly form: HTMLFormElement;
  private readonly email: HTMLInputElement;
  private readonly password: HTMLInputElement;
  private readonly confirm: HTMLInputElement;
  private readonly passwordWrap: HTMLLabelElement;
  private readonly confirmWrap: HTMLLabelElement;
  private readonly submitBtn: HTMLButtonElement;
  private readonly links: HTMLDivElement;
  private mode: AuthMode = 'signin';
  private busy = false;

  constructor(parent: HTMLElement, private readonly opts: AuthPanelOptions) {
    this.overlay = new AccountOverlay(parent, { title: TITLES.signin, simulated: opts.simulated, onEscape: () => this.cancel() });
    this.form = el('form');
    this.form.noValidate = true;
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    const email = field('E-mail', 'email', 'email');
    const password = field('Senha', 'password', 'current-password');
    const confirm = field('Repita a senha', 'password', 'new-password');
    this.email = email.input;
    this.password = password.input;
    this.confirm = confirm.input;
    this.passwordWrap = password.wrap;
    this.confirmWrap = confirm.wrap;
    this.submitBtn = el('button', undefined, SUBMIT.signin);
    this.submitBtn.type = 'submit';
    const actions = el('div', 'ao-actions');
    actions.append(this.submitBtn, button('Cancelar', () => this.cancel()));
    this.links = el('div', 'ao-actions');
    this.form.append(email.wrap, password.wrap, confirm.wrap, this.overlay.messageLine(), actions, this.links);
    this.overlay.mount(this.form, el('div', 'ao-hint', 'Esc: voltar ao menu'));
    this.setMode('signin');
    this.overlay.focusFirst();
  }

  destroy(): void {
    this.overlay.destroy();
  }

  private cancel(): void {
    if (!this.busy) this.opts.onCancel();
  }

  private setMode(mode: AuthMode, message = ''): void {
    this.mode = mode;
    this.overlay.setTitle(TITLES[mode]);
    this.submitBtn.textContent = SUBMIT[mode];
    this.password.value = '';
    this.confirm.value = '';
    this.password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    this.passwordWrap.hidden = mode === 'reset';
    this.confirmWrap.hidden = mode !== 'signup';
    this.links.textContent = '';
    const go = (label: string, to: AuthMode) =>
      button(label, () => {
        if (this.busy) return;
        this.setMode(to);
        this.overlay.focusFirst();
      }, 'ao-link');
    if (mode !== 'signin') this.links.appendChild(go('Já tenho conta: entrar', 'signin'));
    if (mode !== 'signup') this.links.appendChild(go('Criar conta', 'signup'));
    if (mode !== 'reset') this.links.appendChild(go('Esqueci a senha', 'reset'));
    this.overlay.say(message);
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    setControlsDisabled(this.form, busy);
    if (busy) this.overlay.focusRoot();
  }

  /** The first problem with what was typed, or null. */
  private problem(email: string): string | null {
    const e = emailProblem(email);
    if (e) return e;
    if (this.mode === 'signin') return this.password.value ? null : 'Digite a senha.';
    if (this.mode === 'signup') return newPasswordProblem(this.password.value, this.confirm.value);
    return null;
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const mode = this.mode;
    const email = this.email.value.trim();
    const problem = this.problem(email);
    if (problem) {
      this.overlay.say(problem, 'error');
      return;
    }
    const password = mode === 'reset' ? '' : this.password.value;
    this.setBusy(true);
    this.overlay.say(BUSY[mode]);
    let context: ErrorContext = 'default';
    try {
      const { actions } = this.opts;
      if (mode === 'signin') {
        await actions.signIn(email, password);
        if (this.overlay.alive) this.opts.onDone();
      } else if (mode === 'signup') {
        context = 'signUp';
        const { needsEmailConfirmation } = await actions.signUp(email, password);
        if (!this.overlay.alive) return;
        if (needsEmailConfirmation) {
          this.setMode('signin', 'Conta criada. Confirme seu e-mail pelo link que enviamos e depois entre.');
          return;
        }
        context = 'default'; // the account exists; only the sign-in that follows can fail now
        await actions.signIn(email, password);
        if (this.overlay.alive) this.opts.onDone();
      } else {
        await actions.resetPassword(email);
        if (this.overlay.alive) this.setMode('signin', 'Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha.');
      }
    } catch (err) {
      if (this.overlay.alive) this.overlay.say(cloudErrorMessage(err, context), 'error');
    } finally {
      if (this.overlay.alive) {
        this.setBusy(false);
        this.overlay.focusFirst();
      }
    }
  }
}

export interface NewPasswordPanelOptions {
  simulated: boolean;
  email: string;
  updatePassword: (newPassword: string) => Promise<void>;
  onDone: () => void;
  /** "Agora não": the session stays, the recovery state is dropped. */
  onCancel: () => void;
}

/** Asked when the session came from a password-recovery link. */
export class NewPasswordPanel {
  private readonly overlay: AccountOverlay;
  private readonly form: HTMLFormElement;
  private readonly password: HTMLInputElement;
  private readonly confirm: HTMLInputElement;
  private busy = false;

  constructor(parent: HTMLElement, private readonly opts: NewPasswordPanelOptions) {
    this.overlay = new AccountOverlay(parent, { title: 'Nova senha', simulated: opts.simulated, onEscape: () => this.cancel() });
    this.form = el('form');
    this.form.noValidate = true;
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    const intro = el('div', 'ao-text');
    intro.appendChild(el('p', undefined, `Você entrou pelo link de recuperação (${opts.email}). Escolha uma nova senha.`));
    const password = field('Nova senha', 'password', 'new-password');
    const confirm = field('Repita a nova senha', 'password', 'new-password');
    this.password = password.input;
    this.confirm = confirm.input;
    const submitBtn = el('button', undefined, 'Salvar senha');
    submitBtn.type = 'submit';
    const actions = el('div', 'ao-actions');
    actions.append(submitBtn, button('Agora não', () => this.cancel()));
    this.form.append(intro, password.wrap, confirm.wrap, this.overlay.messageLine(), actions);
    this.overlay.mount(this.form);
    this.overlay.focusFirst();
  }

  destroy(): void {
    this.overlay.destroy();
  }

  private cancel(): void {
    if (!this.busy) this.opts.onCancel();
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const problem = newPasswordProblem(this.password.value, this.confirm.value);
    if (problem) {
      this.overlay.say(problem, 'error');
      return;
    }
    const password = this.password.value;
    this.busy = true;
    setControlsDisabled(this.form, true);
    this.overlay.focusRoot();
    this.overlay.say('Salvando...');
    try {
      await this.opts.updatePassword(password);
      if (this.overlay.alive) this.opts.onDone();
    } catch (err) {
      if (this.overlay.alive) this.overlay.say(cloudErrorMessage(err, 'newPassword'), 'error');
    } finally {
      this.busy = false;
      if (this.overlay.alive) {
        setControlsDisabled(this.form, false);
        this.overlay.focusFirst();
      }
    }
  }
}
