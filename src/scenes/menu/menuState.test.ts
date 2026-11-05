import { describe, expect, it } from 'vitest';
import type { AccountState } from '../../cloud/account';
import { CloudError } from '../../cloud/cloudApi';
import { MENU_ITEMS, firstEnabled, moveSelection, type MenuItem } from './menuModel';
import {
  EMAIL_LABEL_MAX,
  accountStatusLine,
  buildMenuItems,
  cloudErrorMessage,
  emailProblem,
  keepSelection,
  newPasswordProblem,
  playAction,
  shortEmail,
} from './menuState';

// Built at runtime: no e-mail literals in the repo.
const mail = (name: string): string => [name, 'test.invalid'].join('@');
const user = { id: 'user-1', email: mail('ana') };

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
  });

  it('error messages in Portuguese from CloudError.kind', () => {
    expect(cloudErrorMessage(new CloudError('network', 'x'))).toMatch(/sem conexão/i);
    expect(cloudErrorMessage(new CloudError('auth', 'x'))).toMatch(/e-mail ou senha inválidos.*sessão expirada/i);
    expect(cloudErrorMessage(new CloudError('other', 'x'))).toMatch(/tente novamente/i);
    expect(cloudErrorMessage(new Error('boom'))).toBe(cloudErrorMessage(new CloudError('other', 'x')));
  });

  it('sign-up and new-password failures have their own messages (never "sessão expirada")', () => {
    for (const kind of ['auth', 'other'] as const) {
      const signUp = cloudErrorMessage(new CloudError(kind, 'x'), 'signUp');
      const newPw = cloudErrorMessage(new CloudError(kind, 'x'), 'newPassword');
      expect(signUp).toMatch(/não foi possível criar a conta/i);
      expect(newPw).toMatch(/não foi possível trocar a senha/i);
      expect(signUp + newPw).not.toMatch(/sessão expirada/i);
    }
    expect(cloudErrorMessage(new CloudError('network', 'x'), 'signUp')).toMatch(/sem conexão/i);
    expect(cloudErrorMessage(new CloudError('network', 'x'), 'newPassword')).toMatch(/sem conexão/i);
  });

  it('validates the e-mail and new passwords', () => {
    expect(emailProblem('')).not.toBeNull();
    expect(emailProblem('no-at-sign')).not.toBeNull();
    expect(emailProblem(` ${mail('ana')} `)).toBeNull();
    expect(newPasswordProblem('12345')).toMatch(/6/);
    expect(newPasswordProblem('123456')).toBeNull();
    expect(newPasswordProblem('123456', '123457')).toMatch(/não conferem/);
    expect(newPasswordProblem('123456', '123456')).toBeNull();
  });
});
