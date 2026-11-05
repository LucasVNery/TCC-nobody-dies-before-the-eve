// Pure menu logic for accounts (no Phaser, no DOM): which items the menu shows for an account state,
// what Jogar does, and the Portuguese texts shown by the account panels.
import { CloudError } from '../../cloud/cloudApi';
import type { AccountState } from '../../cloud/account';
import { MENU_ITEMS, firstEnabled, type MenuId, type MenuItem } from './menuModel';

/** Longest e-mail shown in full on the Sair button; longer ones are cut with an ellipsis. */
export const EMAIL_LABEL_MAX = 24;
/** Supabase's default minimum password length. */
export const MIN_PASSWORD_LENGTH = 6;

export function shortEmail(email: string, max = EMAIL_LABEL_MAX): string {
  return email.length <= max ? email : `${email.slice(0, max - 1)}…`;
}

/**
 * Local mode: the current menu. Cloud mode without a session: Entrar/Criar conta and Como jogar; Jogar and
 * Análise disabled (the game never plays into, nor shows, the pre-login database in cloud mode). With a session: Jogar (leads to the
 * consent term until it is accepted), Sair (<e-mail>) and Apagar meus dados.
 */
export function buildMenuItems(state: AccountState): MenuItem[] {
  if (state.mode === 'local') return MENU_ITEMS.map((i) => ({ ...i }));
  if (!state.user) {
    // Análise needs an owner too: signed out it would show the pre-login history.
    return [
      { id: 'login', label: 'Entrar / Criar conta', enabled: true },
      { id: 'play', label: 'Jogar (entre primeiro)', enabled: false },
      { id: 'howto', label: 'Como jogar', enabled: true },
      { id: 'analysis', label: 'Análise (entre primeiro)', enabled: false },
    ];
  }
  return [
    { id: 'play', label: 'Jogar', enabled: true },
    { id: 'howto', label: 'Como jogar', enabled: true },
    { id: 'analysis', label: 'Análise', enabled: true },
    { id: 'logout', label: `Sair (${shortEmail(state.user.email)})`, enabled: true },
    { id: 'deleteData', label: 'Apagar meus dados', enabled: true },
  ];
}

export type PlayAction = 'start' | 'terms' | 'blocked';

/** What Jogar does: start the run, ask for the consent first, or nothing (cloud mode, signed out). */
export function playAction(state: AccountState): PlayAction {
  if (state.mode === 'local') return 'start';
  if (!state.user) return 'blocked';
  return state.termsAccepted ? 'start' : 'terms';
}

/** Index of the item `id` when it is still there and enabled, else the first enabled one. */
export function keepSelection(items: readonly MenuItem[], id: MenuId | undefined): number {
  const i = items.findIndex((it) => it.id === id && it.enabled);
  return i < 0 ? firstEnabled(items) : i;
}

/** One line under the title saying where the history goes. */
export function accountStatusLine(state: AccountState, simulated: boolean): string {
  if (state.mode === 'local') return 'modo local (sem conta)';
  const where = simulated ? 'nuvem simulada' : 'nuvem';
  if (!state.user) return `${where} · entre para jogar`;
  return `${where} · ${shortEmail(state.user.email, 40)}${state.termsAccepted ? '' : ' · termo pendente'}`;
}

/** Which action failed: sign-up and new password have their own texts (a session cannot be "expired" there). */
export type ErrorContext = 'default' | 'signUp' | 'newPassword';

/** The message shown for a failed cloud call, from CloudError.kind (any other error counts as 'other'). */
export function cloudErrorMessage(err: unknown, context: ErrorContext = 'default'): string {
  const kind = err instanceof CloudError ? err.kind : 'other';
  if (kind === 'network') return 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
  if (context === 'signUp') {
    return 'Não foi possível criar a conta. Confira o e-mail e use uma senha de pelo menos 6 caracteres, ou entre se já tem conta.';
  }
  if (context === 'newPassword') return 'Não foi possível trocar a senha. Use uma senha nova de pelo menos 6 caracteres.';
  return kind === 'auth' ? 'E-mail ou senha inválidos, ou sessão expirada.' : 'Algo deu errado. Tente novamente.';
}

/** A problem with the typed e-mail, or null. */
export function emailProblem(email: string): string | null {
  const e = email.trim();
  if (!e) return 'Digite o e-mail.';
  if (!/^[^\s@]+@[^\s@]+$/.test(e)) return 'E-mail inválido.';
  return null;
}

/** A problem with a new password (sign-up, new password), or null. */
export function newPasswordProblem(password: string, confirm?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (confirm !== undefined && confirm !== password) return 'As senhas não conferem.';
  return null;
}
