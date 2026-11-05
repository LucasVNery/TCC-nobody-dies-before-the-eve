import { describe, it, expect } from 'vitest';
import { readCloudConfig } from './cloudConfig';

const FULL = {
  VITE_SUPABASE_URL: 'https://x.test',
  VITE_SUPABASE_ANON_KEY: 'test-anon-key',
  VITE_CLERK_PUBLISHABLE_KEY: 'test-clerk-key',
};

describe('readCloudConfig', () => {
  it('returns null when any of the three variables is missing', () => {
    expect(readCloudConfig({})).toBeNull();
    for (const k of Object.keys(FULL) as (keyof typeof FULL)[]) {
      const env: Partial<typeof FULL> = { ...FULL };
      delete env[k];
      expect(readCloudConfig(env)).toBeNull();
    }
  });

  it('counts empty and blank values as missing', () => {
    for (const k of Object.keys(FULL) as (keyof typeof FULL)[]) {
      expect(readCloudConfig({ ...FULL, [k]: '' })).toBeNull();
      expect(readCloudConfig({ ...FULL, [k]: '   ' })).toBeNull();
    }
  });

  it('returns the trimmed values when all three are set', () => {
    expect(readCloudConfig({ ...FULL, VITE_CLERK_PUBLISHABLE_KEY: ' test-clerk-key ' })).toEqual({
      supabaseUrl: 'https://x.test',
      anonKey: 'test-anon-key',
      clerkPublishableKey: 'test-clerk-key',
    });
  });
});
