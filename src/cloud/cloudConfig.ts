export interface CloudConfig {
  supabaseUrl: string;
  /** The Supabase publishable (anon) key: public by design, access is decided by RLS. */
  anonKey: string;
  /** Clerk's publishable key (never the secret key). */
  clerkPublishableKey: string;
}

export interface CloudEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_CLERK_PUBLISHABLE_KEY?: string;
}

/** null when any of the three values is missing or blank: the game then runs local-only. */
export function readCloudConfig(env: CloudEnv): CloudConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  const clerkPublishableKey = env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !anonKey || !clerkPublishableKey) return null;
  return { supabaseUrl, anonKey, clerkPublishableKey };
}
