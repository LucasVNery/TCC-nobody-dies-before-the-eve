import { describe, it, expect } from 'vitest';
import { debugKeysEnabled, demoBossEnabled, devToolsEnabled, hotkeyGates, LOCAL_ACCESS, toolKeysEnabled } from './debugKeys';

describe('debugKeysEnabled', () => {
  it('is off for a plain production URL', () => {
    expect(debugKeysEnabled('', false)).toBe(false);
    expect(debugKeysEnabled('?foo=bar', false)).toBe(false);
    expect(debugKeysEnabled('?boss=other', false)).toBe(false);
  });
  it('is on with ?boss=demo', () => {
    expect(debugKeysEnabled('?boss=demo', false)).toBe(true);
    expect(debugKeysEnabled('?x=1&boss=demo', false)).toBe(true);
  });
  it('is on in a dev build regardless of the URL', () => {
    expect(debugKeysEnabled('', true)).toBe(true);
  });
});

const local = (isAdmin: boolean) => ({ mode: 'local' as const, isAdmin });
const cloud = (isAdmin: boolean) => ({ mode: 'cloud' as const, isAdmin });

describe('devToolsEnabled truth table', () => {
  // [state, dev build, ?boss=demo, expected]
  const rows: [ReturnType<typeof local> | ReturnType<typeof cloud>, boolean, boolean, boolean][] = [
    [local(false), false, false, false],
    [local(false), false, true, true],
    [local(false), true, false, true],
    [local(false), true, true, true],
    [local(true), false, false, false],
    [local(true), false, true, true],
    [local(true), true, false, true],
    [local(true), true, true, true],
    [cloud(false), false, false, false],
    [cloud(false), false, true, false],
    [cloud(false), true, false, false],
    [cloud(false), true, true, false],
    [cloud(true), false, false, true],
    [cloud(true), false, true, true],
    [cloud(true), true, false, true],
    [cloud(true), true, true, true],
  ];
  for (const [state, dev, demo, expected] of rows) {
    it(`${state.mode} ${state.isAdmin ? 'admin' : 'common'} ${dev ? 'dev' : 'prod'} ${demo ? '?boss=demo' : 'no param'} -> ${expected}`, () => {
      const search = demo ? '?boss=demo' : '';
      expect(devToolsEnabled(state, search, dev)).toBe(expected);
      expect(hotkeyGates(state, search, dev).debugKeys).toBe(expected);
      // The demo preset needs the param and the tools.
      expect(demoBossEnabled(state, search, dev)).toBe(demo && expected);
    });
  }
  it('in cloud mode ?boss=demo next to other params still does nothing for a common user', () => {
    expect(devToolsEnabled(cloud(false), '?cloud=fake&boss=demo', true)).toBe(false);
    expect(demoBossEnabled(cloud(false), '?cloud=fake&boss=demo', true)).toBe(false);
    expect(demoBossEnabled(cloud(true), '?cloud=fake&boss=demo', false)).toBe(true);
  });
});

describe('toolKeysEnabled', () => {
  it('local mode keeps F2/F3/F8/F9/Tab for everyone, as before the cloud', () => {
    expect(toolKeysEnabled(local(false))).toBe(true);
    expect(toolKeysEnabled(LOCAL_ACCESS)).toBe(true);
    expect(hotkeyGates(LOCAL_ACCESS, '', false)).toEqual({ toolKeys: true, debugKeys: false });
  });
  it('cloud mode only for an administrator', () => {
    expect(toolKeysEnabled(cloud(false))).toBe(false);
    expect(toolKeysEnabled(cloud(true))).toBe(true);
    expect(hotkeyGates(cloud(false), '?boss=demo', true)).toEqual({ toolKeys: false, debugKeys: false });
    expect(hotkeyGates(cloud(true), '', false)).toEqual({ toolKeys: true, debugKeys: true });
  });
});
