export interface CloudConfig {
  url: string;
  anonKey: string;
}

/** null when either value is missing or blank: the game then runs local-only. */
export function readCloudConfig(env: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string }): CloudConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
