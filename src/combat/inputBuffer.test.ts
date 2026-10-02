// src/combat/inputBuffer.test.ts
import { describe, it, expect } from 'vitest';
import { InputBuffer } from './inputBuffer';

const ALWAYS = () => true;
const NEVER = () => false;

describe('InputBuffer', () => {
  it('returns null when empty', () => {
    expect(new InputBuffer(120).take(ALWAYS, 0)).toBeNull();
  });

  it('returns and clears the pending input when it is executable', () => {
    const buf = new InputBuffer(120);
    buf.push({ kind: 'dash' }, 100);
    expect(buf.take(ALWAYS, 150)).toEqual({ kind: 'dash' });
    expect(buf.take(ALWAYS, 150)).toBeNull();
  });

  it('keeps the pending input while it is not executable', () => {
    const buf = new InputBuffer(120);
    buf.push({ kind: 'dash' }, 100);
    expect(buf.take(NEVER, 150)).toBeNull();
    expect(buf.take(ALWAYS, 200)).toEqual({ kind: 'dash' });
  });

  it('a new input replaces the previous one', () => {
    const buf = new InputBuffer(120);
    buf.push({ kind: 'dash' }, 100);
    buf.push({ kind: 'attack', actionId: 'sword_shield.light' }, 110);
    expect(buf.take(ALWAYS, 120)).toEqual({ kind: 'attack', actionId: 'sword_shield.light' });
  });

  it('expires after the window: exactly the window is still valid, one ms more is dropped', () => {
    const a = new InputBuffer(120);
    a.push({ kind: 'dash' }, 100);
    expect(a.take(ALWAYS, 220)).toEqual({ kind: 'dash' });
    const b = new InputBuffer(120);
    b.push({ kind: 'dash' }, 100);
    expect(b.take(ALWAYS, 221)).toBeNull();
    expect(b.take(ALWAYS, 221)).toBeNull(); // dropped, not just skipped
  });

  it('clear() discards the pending input', () => {
    const buf = new InputBuffer(120);
    buf.push({ kind: 'dash' }, 0);
    buf.clear();
    expect(buf.take(ALWAYS, 10)).toBeNull();
  });
});
