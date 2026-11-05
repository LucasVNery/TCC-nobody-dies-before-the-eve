import { describe, expect, it } from 'vitest';
import { ACTIVATION_DELAY_MS, activationAllowed, swallowsKey } from './accountOverlay';

// The panels are DOM (no jsdom in this project): the guards they rely on are tested as pure functions.

describe('activationAllowed', () => {
  it('refuses a button press during the first ACTIVATION_DELAY_MS after opening', () => {
    expect(ACTIVATION_DELAY_MS).toBe(400);
    expect(activationAllowed(0)).toBe(false);
    expect(activationAllowed(ACTIVATION_DELAY_MS - 1)).toBe(false);
    expect(activationAllowed(ACTIVATION_DELAY_MS)).toBe(true);
    expect(activationAllowed(5000)).toBe(true);
    expect(activationAllowed(50, 10)).toBe(true);
  });
});

describe('swallowsKey', () => {
  const key = (k: string, repeat = false, inTextField = false) => ({ key: k, repeat, inTextField });

  it('swallows a held Enter (auto-repeat) at any time, so it never accepts the term', () => {
    expect(swallowsKey(key('Enter', true), 10)).toBe(true);
    expect(swallowsKey(key('Enter', true), 60_000)).toBe(true);
    expect(swallowsKey(key('Enter', true, true), 60_000)).toBe(true); // nor submits a form
    expect(swallowsKey(key(' ', true), 60_000)).toBe(true);
  });

  it('swallows Enter/Space right after opening (the key that came from the menu), Shift+Enter included', () => {
    expect(swallowsKey(key('Enter'), 0)).toBe(true);
    expect(swallowsKey(key(' '), ACTIVATION_DELAY_MS - 1)).toBe(true);
    expect(swallowsKey(key('Enter'), ACTIVATION_DELAY_MS)).toBe(false);
  });

  it('leaves deliberate keys alone: a later Enter, Tab, Esc, and held editing keys in a text field', () => {
    expect(swallowsKey(key('Tab'), 0)).toBe(false);
    expect(swallowsKey(key('Escape'), 0)).toBe(false);
    expect(swallowsKey(key('Enter'), 1000)).toBe(false);
    expect(swallowsKey(key('Backspace', true, true), 1000)).toBe(false);
    expect(swallowsKey(key('a', true, true), 1000)).toBe(false);
    expect(swallowsKey(key('Tab', true), 1000)).toBe(true); // a held key outside a field
  });
});
