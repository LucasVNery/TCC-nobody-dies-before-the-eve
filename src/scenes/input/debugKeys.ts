/**
 * Whether the playtest shortcuts (F4 jump to the boss room, F6 force a barrage) are live in local mode:
 * only with `?boss=demo` in the URL or in a dev build. `search` is `window.location.search`, `dev` is
 * `import.meta.env.DEV`.
 */
export function debugKeysEnabled(search: string, dev: boolean): boolean {
  return dev || new URLSearchParams(search).get('boss') === 'demo';
}

/** The part of AccountState the development tools depend on. */
export interface DevToolsAccess {
  readonly mode: 'local' | 'cloud';
  readonly isAdmin: boolean;
}

/** Access when the game has no Account at all: local mode, as before the cloud existed. */
export const LOCAL_ACCESS: DevToolsAccess = { mode: 'local', isAdmin: false };

/**
 * Whether the playtest tools (F4, F6 and the `?boss=demo` preset) are live. Cloud mode: only for an
 * administrator, whatever the build or the URL. Local mode: the debugKeysEnabled rule, unchanged.
 */
export function devToolsEnabled(state: DevToolsAccess, search: string, dev: boolean): boolean {
  return state.mode === 'cloud' ? state.isAdmin : debugKeysEnabled(search, dev);
}

/**
 * Whether the other development keys (F2 reset, F3 hitboxes, F8/F9 export/import, Tab live panel) are
 * live. Cloud mode: only for an administrator. Local mode: always, as before the cloud existed.
 */
export function toolKeysEnabled(state: DevToolsAccess): boolean {
  return state.mode === 'local' || state.isAdmin;
}

/** Which groups of development keys are live (see bindHotkeys). */
export interface HotkeyGates {
  /** F2, F3, F8, F9, Tab. */
  readonly toolKeys: boolean;
  /** F4, F6. */
  readonly debugKeys: boolean;
}

export function hotkeyGates(state: DevToolsAccess, search: string, dev: boolean): HotkeyGates {
  return { toolKeys: toolKeysEnabled(state), debugKeys: devToolsEnabled(state, search, dev) };
}

/** The demonstration boss preset (BOSS_CONFIG_DEMO): asked for with `?boss=demo`, honoured only when devToolsEnabled. */
export function demoBossEnabled(state: DevToolsAccess, search: string, dev: boolean): boolean {
  return new URLSearchParams(search).get('boss') === 'demo' && devToolsEnabled(state, search, dev);
}
