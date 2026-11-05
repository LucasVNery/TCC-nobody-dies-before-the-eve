import { describe, expect, it } from 'vitest';
import { HELP_LINES, TOOL_KEYS_HELP_LINES } from '../hud/gameplayHud';
import { howToPlayLines } from './howToPlay';

describe('howToPlayLines', () => {
  it('contains the HELP_LINES controls', () => {
    for (const toolKeys of [true, false]) for (const line of HELP_LINES) expect(howToPlayLines(toolKeys)).toContain(line);
  });
  it('mentions BOSS ROOM', () => {
    expect(howToPlayLines(false).join('\n')).toContain('BOSS ROOM');
  });
  it('lists the F2/F3/F8/F9 keys only when they are on', () => {
    for (const line of TOOL_KEYS_HELP_LINES) expect(howToPlayLines(true)).toContain(line);
    expect(howToPlayLines(false).some((l) => /F\d|Tab/.test(l))).toBe(false);
  });
});
