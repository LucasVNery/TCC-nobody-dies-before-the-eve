// Pure menu logic for accounts (no Phaser, no DOM): which items the menu shows for an account state,
// what Jogar does, and the Portuguese texts shown by the account panels.
import { CloudError } from '../../cloud/cloudApi';
import type { AccountState } from '../../cloud/account';
import { MENU_ITEMS, firstEnabled, type MenuId, type MenuItem } from './menuModel';

/** Longest e-mail shown in full on the Sair button; longer ones are cut with an ellipsis. */
export const EMAIL_LABEL_MAX = 24;

export function shortEmail(email: string, max = EMAIL_LABEL_MAX): string {
  return email.length <= max ? email : `${email.slice(0, max - 1)}…`;
}

/**
 * Where the account service is, beyond AccountState (cloud mode, nobody signed in): Clerk still loading,
 * or it failed (could not load, or its sign-in window never showed up) and a retry is offered.
 */
export interface CloudStatus {
  loading?: boolean;
  failed?: boolean;
  /** The user is this browser's last one, restored because Clerk could not load: plays, nothing syncs. */
  offline?: boolean;
}

/**
 * Local mode: the current menu. Cloud mode without a session: Entrar / Criar conta (opens Clerk's window)
 * and Como jogar; Jogar and Análise disabled (the game never plays into, nor shows, the pre-login database in
 * cloud mode). While Clerk loads, a disabled "carregando conta…" stands in for Entrar; after a failure, a
 * retry entry. With a session: Jogar (leads to the consent term until it is accepted), Sair (<e-mail>) and
 * Apagar meus dados (the status flags no longer matter then).
 */
export function buildMenuItems(state: AccountState, status: CloudStatus = {}): MenuItem[] {
  if (state.mode === 'local') return MENU_ITEMS.map((i) => ({ ...i }));
  if (!state.user) {
    const first: MenuItem = status.loading
      ? { id: 'login', label: 'carregando conta…', enabled: false }
      : status.failed
        ? { id: 'retry', label: 'sem conexão — tentar de novo', enabled: true }
        : { id: 'login', label: 'Entrar / Criar conta', enabled: true };
    // Análise needs an owner too: signed out it would show the pre-login history.
    return [
      first,
      { id: 'play', label: 'Jogar (entre primeiro)', enabled: false },
      { id: 'howto', label: 'Como jogar', enabled: true },
      { id: 'analysis', label: 'Análise (entre primeiro)', enabled: false },
    ];
  }
  return [
    { id: 'play', label: 'Jogar', enabled: true },
    { id: 'howto', label: 'Como jogar', enabled: true },
    { id: 'analysis', label: 'Análise', enabled: true },
    // A Clerk account may have no e-mail (it is '' then).
    { id: 'logout', label: state.user.email ? `Sair (${shortEmail(state.user.email)})` : 'Sair', enabled: true },
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

/** One line under the title saying where the history goes (and, signed out, how the account service is doing). */
export function accountStatusLine(state: AccountState, simulated: boolean, status: CloudStatus = {}): string {
  if (state.mode === 'local') return 'modo local (sem conta)';
  const where = simulated ? 'nuvem simulada' : 'nuvem';
  if (!state.user) {
    if (status.loading) return `${where} · carregando conta…`;
    if (status.failed) return `${where} · sem conexão com o serviço de contas`;
    return `${where} · entre para jogar`;
  }
  const who = state.user.email ? shortEmail(state.user.email, 40) : 'conta conectada';
  return `${where} · ${who}${state.termsAccepted ? '' : ' · termo pendente'}${status.offline ? ' · offline (sem envio)' : ''}`;
}

/** The message shown for a failed cloud call, from CloudError.kind (any other error counts as 'other'). */
export function cloudErrorMessage(err: unknown): string {
  const kind = err instanceof CloudError ? err.kind : 'other';
  if (kind === 'network') return 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
  return kind === 'auth' ? 'Sessão expirada. Entre na conta de novo.' : 'Algo deu errado. Tente novamente.';
}
