// src/scenes/ArenaScene.ts
import Phaser from 'phaser';
import { Encounter } from '../combat/encounter';
import { OpportunityOverlay } from '../debug/opportunityOverlay';
import { createFixedTimestepLoop } from '../core/fixedTimestepLoop';

const STEP_MS = 1000 / 60;

export class ArenaScene extends Phaser.Scene {
  private encounter!: Encounter;
  private loop!: ReturnType<typeof createFixedTimestepLoop>;
  private overlayText!: Phaser.GameObjects.Text;
  private playerRect!: Phaser.GameObjects.Rectangle;
  private assaltanteRect!: Phaser.GameObjects.Rectangle;
  private keys!: { light: Phaser.Input.Keyboard.Key; dodge: Phaser.Input.Keyboard.Key };

  constructor() {
    super('ArenaScene');
  }

  create(): void {
    this.encounter = new Encounter(
      { x: 100, y: 300, width: 20, height: 20 },
      { x: 250, y: 300, width: 20, height: 20 },
      150,
    );

    this.playerRect = this.add.rectangle(100, 300, 20, 20, 0x4caf50);
    this.assaltanteRect = this.add.rectangle(250, 300, 20, 20, 0xf44336);

    this.overlayText = this.add.text(10, 10, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    });
    new OpportunityOverlay(this.encounter.bus, (lines) => {
      this.overlayText.setText(lines.length > 0 ? lines : ['(no opportunities open)']);
    });

    this.loop = createFixedTimestepLoop(STEP_MS, (stepMs) => this.encounter.step(stepMs));

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input plugin not available');
    this.keys = {
      light: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
      dodge: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
    };
    this.keys.light.on('down', () => this.encounter.player.tryLightAttack());
    this.keys.dodge.on('down', () => this.encounter.player.tryDodge());
  }

  update(_time: number, delta: number): void {
    this.loop.advance(delta);

    const dx = this.assaltanteRect.x - this.playerRect.x;
    this.encounter.setDistanceToPlayer(Math.abs(dx));

    this.playerRect.setFillStyle(this.encounter.player.isInvulnerable ? 0x8bc34a : 0x4caf50);
    this.assaltanteRect.setFillStyle(
      this.encounter.assaltante.state === 'attacking' ? 0xff9800 : 0xf44336,
    );
  }
}
