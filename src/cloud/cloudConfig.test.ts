import { describe, it, expect } from 'vitest';
import { readCloudConfig } from './cloudConfig';

describe('readCloudConfig', () => {
  it('returns null when a variable is missing or empty', () => {
    expect(readCloudConfig({})).toBeNull();
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'https://x.test' })).toBeNull();
    expect(readCloudConfig({ VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
    expect(readCloudConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'https://x.test', VITE_SUPABASE_ANON_KEY: '  ' })).toBeNull();
  });

  it('returns the pair when both are set', () => {
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'https://x.test', VITE_SUPABASE_ANON_KEY: 'k' })).toEqual({
      url: 'https://x.test',
      anonKey: 'k',
    });
  });
});
