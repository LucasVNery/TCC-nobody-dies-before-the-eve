/**
 * Whether the playtest shortcuts (F4 jump to the boss room, F6 force a barrage) are live: only with
 * `?boss=demo` in the URL or in a dev build. `search` is `window.location.search`, `dev` is
 * `import.meta.env.DEV`.
 */
export function debugKeysEnabled(search: string, dev: boolean): boolean {
  return dev || new URLSearchParams(search).get('boss') === 'demo';
}
