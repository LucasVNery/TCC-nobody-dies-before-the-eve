import { describe, expect, it } from 'vitest';
import { HELP_LINES } from '../hud/gameplayHud';
import { HOW_TO_PLAY_LINES } from './howToPlay';

describe('HOW_TO_PLAY_LINES', () => {
  it('contains the HELP_LINES controls', () => {
    for (const line of HELP_LINES) expect(HOW_TO_PLAY_LINES).toContain(line);
  });
  it('mentions BOSS ROOM', () => {
    expect(HOW_TO_PLAY_LINES.join('\n')).toContain('BOSS ROOM');
  });
});
