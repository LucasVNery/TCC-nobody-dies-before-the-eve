import { describe, expect, it } from 'vitest';
import { MENU_ITEMS, firstEnabled, moveSelection, type MenuItem } from './menuModel';

describe('menuModel', () => {
  it('lists items in order with only login disabled', () => {
    expect(MENU_ITEMS.map((i) => i.id)).toEqual(['login', 'play', 'howto', 'analysis']);
    expect(MENU_ITEMS.filter((i) => !i.enabled).map((i) => i.id)).toEqual(['login']);
    expect(MENU_ITEMS[0].label).toBe('Login (em breve)');
  });

  it('firstEnabled points to play', () => {
    expect(MENU_ITEMS[firstEnabled(MENU_ITEMS)].id).toBe('play');
  });

  it('moveSelection skips login and wraps', () => {
    const play = 1;
    const analysis = 3;
    expect(moveSelection(MENU_ITEMS, analysis, 1)).toBe(play);
    expect(moveSelection(MENU_ITEMS, play, -1)).toBe(analysis);
    let i = firstEnabled(MENU_ITEMS);
    for (let n = 0; n < 10; n++) {
      i = moveSelection(MENU_ITEMS, i, n % 2 === 0 ? 1 : -1);
      expect(MENU_ITEMS[i].id).not.toBe('login');
    }
  });

  it('returns the same index when all items are disabled', () => {
    const items: MenuItem[] = [
      { id: 'login', label: 'a', enabled: false },
      { id: 'play', label: 'b', enabled: false },
    ];
    expect(moveSelection(items, 1, 1)).toBe(1);
    expect(firstEnabled(items)).toBe(0);
  });
});
