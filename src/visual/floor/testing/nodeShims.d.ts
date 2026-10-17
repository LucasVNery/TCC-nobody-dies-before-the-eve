// Minimal ambient declarations for the few Node built-ins the floor test helpers use.
// The repo has no @types/node on purpose (no new dependencies); these files are only
// imported by tests, which run under vitest's node environment.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
}

declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
