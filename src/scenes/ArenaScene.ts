// src/scenes/ArenaScene.ts
import Phaser from 'phaser';
import { Encounter } from '../combat/encounter';
import { OpportunityOverlay } from '../debug/opportunityOverlay';
import { HudState, type HudCounters } from '../debug/hudState';
import { createFixedTimestepLoop } from '../core/fixedTimestepLoop';
import { ARENA_BOUNDS } from '../combat/movementDefs';
import { ASSET_KEYS } from '../visual/assetRegistry';
import { generatePlaceholderTextures, GROUND_TILE_SIZE, ENTITY_SIZE } from '../visual/placeholderTextures';
import { createGroundTilemap } from '../visual/groundTilemap';
import { DirectionalSprite } from '../visual/directionalSprite';
import { ATTACK_RANGE } from '../ai/rules/assaltanteRules';

const STEP_MS = 1000 / 60;
const HURTBOX_COLOR = 0xffffff;
const ATTACK_HITBOX_COLOR = 0xffeb3b;
const ATTACK_RANGE_COLOR = 0xff9800;

export class ArenaScene extends Phaser.Scene {
  private encounter!: Encounter;
  private loop!: ReturnType<typeof createFixedTimestepLoop>;
  private overlayText!: Phaser.GameObjects.Text;
  private hudText!: Phaser.GameObjects.Text;
  private hudCounters: HudCounters = {
    dashAttempts: 0,
    effectiveDashes: 0,
    wastedDashes: 0,
    bossHitsLanded: 0,
  };
  private lastMoveInput = { dx: 0, dy: 0 };
  private playerSprite!: DirectionalSprite;
  private assaltanteSprite!: DirectionalSprite;
  private debugGraphics!: Phaser.GameObjects.Graphics;
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

  preload(): void {
    generatePlaceholderTextures(this);
  }

  create(): void {
    this.encounter = new Encounter(
      { x: 100, y: 300, width: ENTITY_SIZE, height: ENTITY_SIZE },
      { x: 400, y: 300, width: ENTITY_SIZE, height: ENTITY_SIZE },
    );

    createGroundTilemap(this, ARENA_BOUNDS, GROUND_TILE_SIZE);

    this.playerSprite = new DirectionalSprite(this, ASSET_KEYS.player, ENTITY_SIZE, ENTITY_SIZE, { x: 100, y: 300 });
    this.assaltanteSprite = new DirectionalSprite(this, ASSET_KEYS.assaltante, ENTITY_SIZE, ENTITY_SIZE, { x: 400, y: 300 });

    this.add
      .rectangle(ARENA_BOUNDS.x, ARENA_BOUNDS.y, ARENA_BOUNDS.width, ARENA_BOUNDS.height)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x444444);

    this.overlayText = this.add.text(10, 10, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    });
    this.overlayText.setScrollFactor(0);
    new OpportunityOverlay(this.encounter.bus, (lines) => {
      this.overlayText.setText(lines.length > 0 ? lines : ['(no opportunities open)']);
    });

    this.hudText = this.add.text(10, 400, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    });
    this.hudText.setScrollFactor(0);
    new HudState(this.encounter.bus, (counters) => {
      this.hudCounters = counters;
    });

    const controlsText = this.add.text(
      590,
      10,
      [
        'Controls:',
        '  WASD  - move',
        '  J     - light attack',
        '          (use during boss "recovering" to punish)',
        '  K     - dodge',
        '          (use during boss "attacking" telegraph for i-frames)',
      ],
      { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff' },
    );
    controlsText.setScrollFactor(0);

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
    this.cameras.main.startFollow(this.playerSprite.gameObject);

    this.debugGraphics = this.add.graphics();
    this.debugGraphics.setDepth(100000);
  }

  update(_time: number, delta: number): void {
    const dx = (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0);
    const dy = (this.keys.down.isDown ? 1 : 0) - (this.keys.up.isDown ? 1 : 0);
    this.encounter.setPlayerMoveInput(dx, dy);
    this.lastMoveInput = { dx, dy };

    this.loop.advance(delta);

    const playerPos = this.encounter.player.position;
    const assaltantePos = this.encounter.assaltante.position;

    this.playerSprite.syncPosition(playerPos);
    this.playerSprite.syncDirection(this.encounter.player.facing);
    this.playerSprite.setTint(this.encounter.player.isInvulnerable ? 0x8bc34a : 0xffffff);

    this.assaltanteSprite.syncPosition(assaltantePos);
    this.assaltanteSprite.syncDirection(this.encounter.assaltante.attackDirection);
    this.assaltanteSprite.setTint(
      this.encounter.assaltante.state === 'attacking' ? 0xff9800 : 0xffffff,
    );

    this.hudText.setText([
      `move: (${this.lastMoveInput.dx}, ${this.lastMoveInput.dy})`,
      `dash: ${this.encounter.player.isInvulnerable ? 'active (i-frames)' : 'idle'}`,
      `dashes: ${this.hudCounters.effectiveDashes} effective / ${this.hudCounters.wastedDashes} wasted`,
      `boss: ${this.encounter.assaltante.state} (${this.encounter.assaltante.activeRuleId ?? '-'})`,
      `boss hits landed: ${this.hudCounters.bossHitsLanded}`,
    ]);

    this.drawDebugHitboxes();
  }

  private drawDebugHitboxes(): void {
    this.debugGraphics.clear();

    const playerHurtbox = this.encounter.player.hurtbox();
    const assaltanteHurtbox = this.encounter.assaltante.hurtbox();
    this.debugGraphics.lineStyle(1, HURTBOX_COLOR, 0.6);
    this.debugGraphics.strokeRect(playerHurtbox.x, playerHurtbox.y, playerHurtbox.width, playerHurtbox.height);
    this.debugGraphics.strokeRect(
      assaltanteHurtbox.x,
      assaltanteHurtbox.y,
      assaltanteHurtbox.width,
      assaltanteHurtbox.height,
    );

    const assaltanteCenterX = this.encounter.assaltante.position.x + ENTITY_SIZE / 2;
    const assaltanteCenterY = this.encounter.assaltante.position.y + ENTITY_SIZE / 2;
    this.debugGraphics.lineStyle(1, ATTACK_RANGE_COLOR, 0.6);
    this.debugGraphics.strokeCircle(assaltanteCenterX, assaltanteCenterY, ATTACK_RANGE);

    this.debugGraphics.fillStyle(ATTACK_HITBOX_COLOR, 0.4);
    const playerAttack = this.encounter.player.attackHitbox();
    if (playerAttack) this.debugGraphics.fillRect(playerAttack.x, playerAttack.y, playerAttack.width, playerAttack.height);
    const assaltanteAttack = this.encounter.assaltante.attackHitbox();
    if (assaltanteAttack) {
      this.debugGraphics.fillRect(
        assaltanteAttack.x,
        assaltanteAttack.y,
        assaltanteAttack.width,
        assaltanteAttack.height,
      );
    }
  }
}
