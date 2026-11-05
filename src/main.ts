// src/main.ts
/// <reference types="vite/client" />
import Phaser from 'phaser';
import { MenuScene } from './scenes/MenuScene';
import { ArenaScene } from './scenes/ArenaScene';
import { Account, ACCOUNT_REGISTRY_KEY, browserAccountChannel } from './cloud/account';
import type { CloudApi } from './cloud/cloudApi';
import { readCloudConfig } from './cloud/cloudConfig';
import { createSupabaseCloudApi } from './cloud/supabaseCloudApi';
import { createClerkSession } from './cloud/clerkSession';
import { FakeCloudApi } from './cloud/fakeCloudApi';

/**
 * Development only: `?cloud=fake` runs the cloud mode on the in-memory FakeCloudApi (no Clerk, no
 * Supabase: Entrar signs a fake player in at once; everything is lost on reload). `import.meta.env.DEV` is the constant false in a production build,
 * so this branch and FakeCloudApi are dropped from the published bundle.
 */
function devFakeCloud(): CloudApi | null {
  if (!import.meta.env.DEV) return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('cloud') !== 'fake') return null;
  const api = new FakeCloudApi();
  // `&admin=1`: every account that signs in on this page is an administrator (to check the development tools).
  // Registered before account.init(), so the role is set before the Account asks for it.
  if (params.get('admin') === '1') {
    api.onAuthChange((user) => {
      if (user) api.setAdmin(user.id);
    });
  }
  // For manual checks in the console, e.g. another account: __tccFakeCloud.signInAs(email).
  (window as unknown as { __tccFakeCloud?: FakeCloudApi }).__tccFakeCloud = api;
  return api;
}

// Cloud mode needs all three of VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (the Supabase publishable key)
// and VITE_CLERK_PUBLISHABLE_KEY; without them the account is in local mode and the game runs as before.
const cloudConfig = readCloudConfig({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined,
});
const fake = devFakeCloud();

function realCloud(): CloudApi | null {
  if (!cloudConfig) return null;
  // Clerk loads in the background (account.init): the menu opens at once and says "carregando conta…".
  return createSupabaseCloudApi(cloudConfig, createClerkSession(cloudConfig.clerkPublishableKey));
}

// The channel tells the game's other tabs when this account's data was deleted.
const account = fake
  ? new Account(fake, { simulated: true, channel: browserAccountChannel() })
  : new Account(realCloud(), { channel: browserAccountChannel() });
// Never rejects: a failed Clerk load leaves the game signed out with account.loadError (retryable).
void account.init();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: '#1a1a1a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  scene: [MenuScene, ArenaScene],
  // Scenes read the account from the registry; preBoot runs before any scene exists.
  callbacks: { preBoot: (game) => void game.registry.set(ACCOUNT_REGISTRY_KEY, account) },
});
