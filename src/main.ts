// src/main.ts
/// <reference types="vite/client" />
import Phaser from 'phaser';
import { MenuScene } from './scenes/MenuScene';
import { ArenaScene } from './scenes/ArenaScene';
import { Account, ACCOUNT_REGISTRY_KEY } from './cloud/account';
import type { CloudApi } from './cloud/cloudApi';
import { readCloudConfig } from './cloud/cloudConfig';
import { createSupabaseCloudApi } from './cloud/supabaseCloudApi';
import { FakeCloudApi } from './cloud/fakeCloudApi';

/**
 * Development only: `?cloud=fake` runs the cloud mode on the in-memory FakeCloudApi (no Supabase;
 * everything is lost on reload). `import.meta.env.DEV` is the constant false in a production build,
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
  // For manual checks in the console, e.g. opening a recovery link: __tccFakeCloud.simulateRecovery(email).
  (window as unknown as { __tccFakeCloud?: FakeCloudApi }).__tccFakeCloud = api;
  return api;
}

// Without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY the account is in local mode and the game runs as before.
const cloudConfig = readCloudConfig({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
});
const fake = devFakeCloud();
const account = fake
  ? new Account(fake, { simulated: true })
  : new Account(cloudConfig ? createSupabaseCloudApi(cloudConfig) : null);
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
