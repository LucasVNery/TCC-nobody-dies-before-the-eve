// src/scenes/ArenaScene.ts
import Phaser from 'phaser';
import { Encounter } from '../combat/encounter';
import { OpportunityOverlay } from '../debug/opportunityOverlay';
import { createFixedTimestepLoop } from '../core/fixedTimestepLoop';
import { ARENA_BOUNDS } from '../combat/movementDefs';

const STEP_MS = 1000 / 60;

export class ArenaScene extends Phaser.Scene {
  private encounter!: Encounter;
  private loop!: ReturnType<typeof createFixedTimestepLoop>;
  private overlayText!: Phaser.GameObjects.Text;
  private playerRect!: Phaser.GameObjects.Rectangle;
  private assaltanteRect!: Phaser.GameObjects.Rectangle;
  private keys!: {
    light: Phaser.Input.Keyboard.Key;
    dodge: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super('ArenaScene');
  }

  create(): void {
    this.encounter = new Encounter(
      { x: 100, y: 300, width: 20, height: 20 },
      { x: 400, y: 300, width: 20, height: 20 },
    );

    this.playerRect = this.add.rectangle(100, 300, 20, 20, 0x4caf50).setOrigin(0, 0);
    this.assaltanteRect = this.add.rectangle(400, 300, 20, 20, 0xf44336).setOrigin(0, 0);

    this.overlayText = this.add.text(10, 10, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    });
    this.overlayText.setScrollFactor(0);
    new OpportunityOverlay(this.encounter.bus, (lines) => {
      this.overlayText.setText(lines.length > 0 ? lines : ['(no opportunities open)']);
    });

    this.loop = createFixedTimestepLoop(STEP_MS, (stepMs) => this.encounter.step(stepMs));

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input plugin not available');
    this.keys = {
      light: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
      dodge: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.keys.light.on('down', () => this.encounter.player.tryLightAttack());
    this.keys.dodge.on('down', () => this.encounter.player.tryDodge());

    this.cameras.main.setBounds(ARENA_BOUNDS.x, ARENA_BOUNDS.y, ARENA_BOUNDS.width, ARENA_BOUNDS.height);
    this.cameras.main.startFollow(this.playerRect);
  }

  update(_time: number, delta: number): void {
    const dx = (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0);
    const dy = (this.keys.down.isDown ? 1 : 0) - (this.keys.up.isDown ? 1 : 0);
    this.encounter.setPlayerMoveInput(dx, dy);

    this.loop.advance(delta);

    const playerPos = this.encounter.player.position;
    const assaltantePos = this.encounter.assaltante.position;
    this.playerRect.setPosition(playerPos.x, playerPos.y);
    this.assaltanteRect.setPosition(assaltantePos.x, assaltantePos.y);

    this.playerRect.setFillStyle(this.encounter.player.isInvulnerable ? 0x8bc34a : 0x4caf50);
    this.assaltanteRect.setFillStyle(
      this.encounter.assaltante.state === 'attacking' ? 0xff9800 : 0xf44336,
    );
  }
}
