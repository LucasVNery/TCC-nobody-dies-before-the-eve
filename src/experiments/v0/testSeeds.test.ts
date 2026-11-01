/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';

// Built from parts so this file never contains the literals it scans for.
const FORBIDDEN = [['2026', '1105'].join(''), ['2026', '1019'].join('')];
// cliArgs.test.ts holds the defaults as constants; this file only builds the strings from parts.
const ALLOWED_FILES = ['/cliArgs.test.ts', '/testSeeds.test.ts'];

describe('test seeds', () => {
  it('no test uses the official or the pilot seed (only cliArgs.test.ts holds the defaults)', () => {
    const files = import.meta.glob('/src/**/*.test.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const paths = Object.keys(files);
    expect(paths.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const path of paths) {
      if (ALLOWED_FILES.some((a) => path.endsWith(a))) continue;
      for (const seed of FORBIDDEN) if (files[path].includes(seed)) offenders.push(`${path}: ${seed}`);
    }
    expect(offenders).toEqual([]);
  });
});
