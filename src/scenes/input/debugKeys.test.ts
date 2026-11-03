import { describe, it, expect } from 'vitest';
import { debugKeysEnabled } from './debugKeys';

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
