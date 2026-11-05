import { describe, expect, it } from 'vitest';
import type { AccountState } from '../../cloud/account';
import { CloudError } from '../../cloud/cloudApi';
import { MENU_ITEMS, firstEnabled, moveSelection, type MenuItem } from './menuModel';
import {
  EMAIL_LABEL_MAX,
  accountStatusLine,
  buildMenuItems,
  cloudErrorMessage,
  keepSelection,
  playAction,
  shortEmail,
} from './menuState';

// Built at runtime: no e-mail literals in the repo.
const mail = (name: string): string => [name, 'test.invalid'].join('@');
const user = { id: 'user_ana1', email: mail('ana') };

const LOCAL: AccountState = { mode: 'local', user: null, isAdmin: false, termsAccepted: false };
const SIGNED_OUT: AccountState = { mode: 'cloud', user: null, isAdmin: false, termsAccepted: false };
const NO_TERMS: AccountState = { mode: 'cloud', user, isAdmin: false, termsAccepted: false };
const READY: AccountState = { mode: 'cloud', user, isAdmin: false, termsAccepted: true };

const ids = (items: MenuItem[]) => items.map((i) => i.id);
const enabledIds = (items: MenuItem[]) => items.filter((i) => i.enabled).map((i) => i.id);

/** Walks the whole list both ways from the first enabled item; never stops on a disabled one. */
function expectNeverOnDisabled(items: MenuItem[]): void {
  let i = firstEnabled(items);
  expect(items[i].enabled).toBe(true);
  for (let n = 0; n < 3 * items.length; n++) {
    i = moveSelection(items, i, n % 3 === 2 ? -1 : 1);
    expect(items[i].enabled).toBe(true);
  }
}

describe('buildMenuItems', () => {
  it('local mode is the current menu (Login inert)', () => {
    expect(buildMenuItems(LOCAL)).toEqual(MENU_ITEMS);
    expect(playAction(LOCAL)).toBe('start');
  });

  it('cloud mode without a session: only Entrar/Criar conta and Como jogar; Jogar and Análise disabled', () => {
    const items = buildMenuItems(SIGNED_OUT);
    expect(ids(items)).toEqual(['login', 'play', 'howto', 'analysis']);
    expect(enabledIds(items)).toEqual(['login', 'howto']);
    expect(items[0].label).toBe('Entrar / Criar conta');
    expect(items[1].label).toBe('Jogar (entre primeiro)');
    expect(items[3].label).toBe('Análise (entre primeiro)');
    expect(items[firstEnabled(items)].id).toBe('login');
    expect(playAction(SIGNED_OUT)).toBe('blocked');
  });

  it('cloud mode while Clerk loads: a disabled "carregando conta…" instead of Entrar', () => {
    const items = buildMenuItems(SIGNED_OUT, { loading: true });
    expect(ids(items)).toEqual(['login', 'play', 'howto', 'analysis']);
    expect(items[0]).toEqual({ id: 'login', label: 'carregando conta…', enabled: false });
    expect(enabledIds(items)).toEqual(['howto']);
    expect(items[firstEnabled(items)].id).toBe('howto');
    // loading wins over a previous failure (a retry is running)
    expect(buildMenuItems(SIGNED_OUT, { loading: true, failed: true })[0].label).toBe('carregando conta…');
  });

  it('cloud mode after a failure: a retry entry instead of Entrar; Jogar and Análise still disabled', () => {
    const items = buildMenuItems(SIGNED_OUT, { failed: true });
    expect(ids(items)).toEqual(['retry', 'play', 'howto', 'analysis']);
    expect(items[0]).toEqual({ id: 'retry', label: 'sem conexão — tentar de novo', enabled: true });
    expect(enabledIds(items)).toEqual(['retry', 'howto']);
    expect(items[firstEnabled(items)].id).toBe('retry');
  });

  it('the service flags do not matter once signed in, nor in local mode', () => {
    for (const flags of [{ loading: true }, { failed: true }]) {
      expect(buildMenuItems(READY, flags)).toEqual(buildMenuItems(READY));
      expect(buildMenuItems(NO_TERMS, flags)).toEqual(buildMenuItems(NO_TERMS));
      expect(buildMenuItems(LOCAL, flags)).toEqual(MENU_ITEMS);
    }
  });

  it('an account without e-mail signs out with a plain "Sair"', () => {
    const noMail: AccountState = { ...READY, user: { id: 'user_x1', email: '' } };
    expect(buildMenuItems(noMail).find((i) => i.id === 'logout')!.label).toBe('Sair');
    expect(accountStatusLine(noMail, false)).toBe('nuvem · conta conectada');
  });

  it('signed in without consent: Jogar leads to the term; Sair and Apagar meus dados shown', () => {
    const items = buildMenuItems(NO_TERMS);
    expect(ids(items)).toEqual(['play', 'howto', 'analysis', 'logout', 'deleteData']);
    expect(enabledIds(items)).toEqual(ids(items));
    expect(items.find((i) => i.id === 'logout')!.label).toBe(`Sair (${mail('ana')})`);
    expect(items.find((i) => i.id === 'deleteData')!.label).toBe('Apagar meus dados');
    expect(playAction(NO_TERMS)).toBe('terms');
  });

  it('signed in with consent: Jogar starts the run', () => {
    const items = buildMenuItems(READY);
    expect(ids(items)).toEqual(['play', 'howto', 'analysis', 'logout', 'deleteData']);
    expect(items[firstEnabled(items)].id).toBe('play');
    expect(playAction(READY)).toBe('start');
  });

  it('moveSelection never stops on a disabled item in any state', () => {
    for (const s of [LOCAL, SIGNED_OUT, NO_TERMS, READY]) expectNeverOnDisabled(buildMenuItems(s));
    for (const flags of [{ loading: true }, { failed: true }]) expectNeverOnDisabled(buildMenuItems(SIGNED_OUT, flags));
    const loading = buildMenuItems(SIGNED_OUT, { loading: true });
    expect(moveSelection(loading, 2, 1)).toBe(2); // Como jogar is the only enabled item
    expect(moveSelection(loading, 2, -1)).toBe(2);
    const signedOut = buildMenuItems(SIGNED_OUT);
    expect(moveSelection(signedOut, 0, 1)).toBe(2); // skips the disabled Jogar
    expect(moveSelection(signedOut, 2, 1)).toBe(0); // skips the disabled Análise, wraps
    expect(moveSelection(signedOut, 2, -1)).toBe(0);
    expect(moveSelection(signedOut, 0, -1)).toBe(2);
  });

  it('returns fresh items (the scene may keep them while the account changes)', () => {
    const a = buildMenuItems(LOCAL);
    a[0].label = 'x';
    expect(MENU_ITEMS[0].label).toBe('Login (em breve)');
  });
});

describe('menu helpers', () => {
  it('keepSelection keeps an enabled item across rebuilds, else the first enabled', () => {
    const out = buildMenuItems(SIGNED_OUT);
    const ready = buildMenuItems(READY);
    expect(keepSelection(ready, 'analysis')).toBe(2);
    expect(keepSelection(ready, 'login')).toBe(0);
    expect(keepSelection(out, 'play')).toBe(0); // Jogar is disabled there
    expect(keepSelection(out, 'analysis')).toBe(0); // so is Análise
    expect(keepSelection(out, undefined)).toBe(0);
  });

  it('shortEmail cuts long addresses', () => {
    const long = mail('a'.repeat(40));
    expect(shortEmail(mail('ana'))).toBe(mail('ana'));
    expect(shortEmail(long)).toHaveLength(EMAIL_LABEL_MAX);
    expect(shortEmail(long).endsWith('…')).toBe(true);
  });

  it('status line names the mode, the simulated cloud and a pending consent', () => {
    expect(accountStatusLine(LOCAL, false)).toBe('modo local (sem conta)');
    expect(accountStatusLine(SIGNED_OUT, true)).toBe('nuvem simulada · entre para jogar');
    expect(accountStatusLine(NO_TERMS, false)).toBe(`nuvem · ${mail('ana')} · termo pendente`);
    expect(accountStatusLine(READY, true)).toBe(`nuvem simulada · ${mail('ana')}`);
    expect(accountStatusLine(SIGNED_OUT, false, { loading: true })).toBe('nuvem · carregando conta…');
    expect(accountStatusLine(SIGNED_OUT, true, { failed: true })).toBe('nuvem simulada · sem conexão com o serviço de contas');
    expect(accountStatusLine(READY, false, { failed: true })).toBe(`nuvem · ${mail('ana')}`);
    expect(accountStatusLine(LOCAL, false, { loading: true })).toBe('modo local (sem conta)');
  });

  it('the last user restored offline (Clerk unreachable) plays with the usual items, the line says offline', () => {
    const status = { failed: true, offline: true };
    expect(accountStatusLine(READY, false, status)).toBe(`nuvem · ${mail('ana')} · offline (sem envio)`);
    expect(accountStatusLine(NO_TERMS, false, status)).toBe(`nuvem · ${mail('ana')} · termo pendente · offline (sem envio)`);
    expect(ids(buildMenuItems(READY, status))).toEqual(['play', 'howto', 'analysis', 'logout', 'deleteData']);
    expect(playAction(READY)).toBe('start');
  });

  it('error messages in Portuguese from CloudError.kind', () => {
    expect(cloudErrorMessage(new CloudError('network', 'x'))).toMatch(/sem conexão/i);
    expect(cloudErrorMessage(new CloudError('auth', 'x'))).toMatch(/sessão expirada/i);
    expect(cloudErrorMessage(new CloudError('auth', 'x'))).not.toMatch(/senha/i); // passwords are Clerk's business now
    expect(cloudErrorMessage(new CloudError('other', 'x'))).toMatch(/tente novamente/i);
    expect(cloudErrorMessage(new Error('boom'))).toBe(cloudErrorMessage(new CloudError('other', 'x')));
  });
});
