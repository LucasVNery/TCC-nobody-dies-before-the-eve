// src/main.ts
/// <reference types="vite/client" />
import Phaser from 'phaser';
import { MenuScene } from './scenes/MenuScene';
import { ArenaScene } from './scenes/ArenaScene';
import { Account, ACCOUNT_REGISTRY_KEY } from './cloud/account';
import { readCloudConfig } from './cloud/cloudConfig';
import { createSupabaseCloudApi } from './cloud/supabaseCloudApi';

// Without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY the account is in local mode and the game runs as before.
const cloudConfig = readCloudConfig({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
});
const account = new Account(cloudConfig ? createSupabaseCloudApi(cloudConfig) : null);
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
