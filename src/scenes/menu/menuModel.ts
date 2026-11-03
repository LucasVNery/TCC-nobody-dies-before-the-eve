export type MenuId = 'login' | 'play' | 'howto' | 'analysis';

export interface MenuItem {
  id: MenuId;
  label: string;
  enabled: boolean;
}

export const MENU_ITEMS: readonly MenuItem[] = [
  { id: 'login', label: 'Login (em breve)', enabled: false },
  { id: 'play', label: 'Jogar', enabled: true },
  { id: 'howto', label: 'Como jogar', enabled: true },
  { id: 'analysis', label: 'Análise', enabled: true },
];

/** Index of the first enabled item (0 if none is enabled). */
export function firstEnabled(items: readonly MenuItem[]): number {
  const i = items.findIndex((it) => it.enabled);
  return i < 0 ? 0 : i;
}

/** Moves to the next enabled item in direction `delta`, wrapping; stays put if none is enabled. */
export function moveSelection(items: readonly MenuItem[], index: number, delta: 1 | -1): number {
  const n = items.length;
  for (let step = 1; step <= n; step++) {
    const j = (((index + delta * step) % n) + n) % n;
    if (items[j].enabled) return j;
  }
  return index;
}
