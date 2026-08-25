// src/scenes/ArenaScene.ts
import Phaser from 'phaser';
import { Encounter } from '../combat/encounter';
import { OpportunityOverlay } from '../debug/opportunityOverlay';
import { HudState, type HudCounters } from '../debug/hudState';
import { createFixedTimestepLoop } from '../core/fixedTimestepLoop';
import { ARENA_BOUNDS } from '../combat/movementDefs';
import { ASSET_KEYS } from '../visual/assetRegistry';
import {
  generatePlaceholderTextures,
  ENTITY_SIZE,
  ENTITY_VISUAL_WIDTH,
  ENTITY_VISUAL_HEIGHT,
  ISO_CONFIG,
} from '../visual/placeholderTextures';
import { createGroundTilemap } from '../visual/groundTilemap';
import { DirectionalSprite } from '../visual/directionalSprite';
import { ATTACK_RANGE } from '../ai/rules/assaltanteRules';
import { toScreen } from '../visual/isometricProjection';
import type { Vec2, AABB } from '../combat/types';

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
    this.load.image(ASSET_KEYS.groundGrass, '/assets/tiles/grass.png');
    this.load.image(ASSET_KEYS.groundWater, '/assets/tiles/water.png');
    generatePlaceholderTextures(this);
  }

  create(): void {
    this.encounter = new Encounter(
      { x: 100, y: 300, width: ENTITY_SIZE, height: ENTITY_SIZE },
      { x: 400, y: 300, width: ENTITY_SIZE, height: ENTITY_SIZE },
    );

    createGroundTilemap(this, ARENA_BOUNDS, ISO_CONFIG);

    this.playerSprite = new DirectionalSprite(
      this,
      ASSET_KEYS.player,
      ENTITY_VISUAL_WIDTH,
      ENTITY_VISUAL_HEIGHT,
      { x: 100, y: 300 },
      ISO_CONFIG,
    );
    this.assaltanteSprite = new DirectionalSprite(
      this,
      ASSET_KEYS.assaltante,
      ENTITY_VISUAL_WIDTH,
      ENTITY_VISUAL_HEIGHT,
      { x: 400, y: 300 },
      ISO_CONFIG,
    );

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

    const arenaCorners: Vec2[] = [
      { x: ARENA_BOUNDS.x, y: ARENA_BOUNDS.y },
      { x: ARENA_BOUNDS.x + ARENA_BOUNDS.width, y: ARENA_BOUNDS.y },
      { x: ARENA_BOUNDS.x, y: ARENA_BOUNDS.y + ARENA_BOUNDS.height },
      { x: ARENA_BOUNDS.x + ARENA_BOUNDS.width, y: ARENA_BOUNDS.y + ARENA_BOUNDS.height },
    ];
    const projectedCorners = arenaCorners.map((corner) => toScreen(corner, ISO_CONFIG));
    const margin = ISO_CONFIG.halfWidth * 2;
    const minX = Math.min(...projectedCorners.map((p) => p.x)) - margin;
    const maxX = Math.max(...projectedCorners.map((p) => p.x)) + margin;
    const minY = Math.min(...projectedCorners.map((p) => p.y)) - margin;
    const maxY = Math.max(...projectedCorners.map((p) => p.y)) + margin;

    this.cameras.main.setBounds(minX, minY, maxX - minX, maxY - minY);
    this.cameras.main.startFollow(this.playerSprite.gameObject);

    this.debugGraphics = this.add.graphics();
    this.debugGraphics.setDepth(100000);
  }

  update(_time: number, delta: number): void {
    const inputX = (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0);
    const inputY = (this.keys.down.isDown ? 1 : 0) - (this.keys.up.isDown ? 1 : 0);
    // Rotate WASD 45° so each key drives the player toward a screen-space
    // point of the isometric diamond (up/down/left/right on screen),
    // instead of along the underlying cartesian world axes. Combat/movement
    // still only ever sees a cartesian (dx, dy) — this is an input-mapping
    // concern local to the scene, not a physics change.
    const dx = inputX + inputY;
    const dy = inputY - inputX;
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
    this.debugGraphics.strokePoints(this.cornersAsPoints(playerHurtbox), true);
    this.debugGraphics.strokePoints(this.cornersAsPoints(assaltanteHurtbox), true);

    const assaltanteCenter: Vec2 = {
      x: this.encounter.assaltante.position.x + ENTITY_SIZE / 2,
      y: this.encounter.assaltante.position.y + ENTITY_SIZE / 2,
    };
    const rangeScreenCenter = toScreen(assaltanteCenter, ISO_CONFIG);
    this.debugGraphics.lineStyle(1, ATTACK_RANGE_COLOR, 0.6);
    this.debugGraphics.strokeEllipse(
      rangeScreenCenter.x,
      rangeScreenCenter.y,
      ATTACK_RANGE * 2,
      ATTACK_RANGE * (ISO_CONFIG.halfHeight / ISO_CONFIG.halfWidth) * 2,
    );

    this.debugGraphics.fillStyle(ATTACK_HITBOX_COLOR, 0.4);
    const playerAttack = this.encounter.player.attackHitbox();
    if (playerAttack) this.debugGraphics.fillPoints(this.cornersAsPoints(playerAttack), true);
    const assaltanteAttack = this.encounter.assaltante.attackHitbox();
    if (assaltanteAttack) this.debugGraphics.fillPoints(this.cornersAsPoints(assaltanteAttack), true);
  }

  private cornersAsPoints(box: AABB): Phaser.Geom.Point[] {
    const corners: Vec2[] = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ];
    return corners.map((corner) => {
      const screen = toScreen(corner, ISO_CONFIG);
      return new Phaser.Geom.Point(screen.x, screen.y);
    });
  }
}
