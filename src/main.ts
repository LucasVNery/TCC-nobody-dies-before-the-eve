// src/main.ts
import Phaser from 'phaser';
import { ArenaScene } from './scenes/ArenaScene';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'game-root',
  backgroundColor: '#1a1a1a',
  scene: [ArenaScene],
});
