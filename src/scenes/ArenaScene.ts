// src/scenes/ArenaScene.ts
import Phaser from 'phaser';
import { OpportunityOverlay } from '../debug/opportunityOverlay';
import { HudState, type HudCounters } from '../debug/hudState';
import { createFixedTimestepLoop } from '../core/fixedTimestepLoop';
import { ARENA_BOUNDS, PLAYER_MAX_HP, ASSALTANTE_MAX_HP, ROOM_ENCOUNTER_COUNT } from '../combat/movementDefs';
import { createTelemetryStack, type TelemetryStack } from '../telemetry/stack';
import { IndexedDbEventStore, MemoryEventStore, type EventStore } from '../telemetry/eventStore';
import { loadProfileState, type BootState } from '../telemetry/bootstrap';
import { toNdjson, importInto } from '../telemetry/ndjson';
import { SCHEMA_VERSION, GAME_VERSION } from '../telemetry/schema';
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
import { toScreen, fromScreen } from '../visual/isometricProjection';
import { findWeaponAction, type ActionType } from '../combat/actionRegistry';
import type { Vec2, AABB } from '../combat/types';
import type { AttackSector } from '../combat/sector';

const STEP_MS = 1000 / 60;
const PERSIST_INTERVAL_MS = 2000;

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
const HURTBOX_COLOR = 0xffffff;
const ATTACK_HITBOX_COLOR = 0xffeb3b;
const ATTACK_RANGE_COLOR = 0xff9800;
// Native per-frame size of the rendered character sprite sheets — see
// tools/blender/README.md (FRAME_SIZE in render_character.py). Both idle
// and walk sheets, for both entities, share this size.
const CHARACTER_FRAME_SIZE = 128;
const WALK_FRAME_COUNT = 6;
const WEAPON_LABELS: Record<string, string> = {
  sword_shield: 'Espada + Escudo',
  bow: 'Arco',
  heavy_weapon: 'Arma Pesada',
};

export class ArenaScene extends Phaser.Scene {
  private stack!: TelemetryStack;
  private store: EventStore = new MemoryEventStore();
  private ready = false;
  private persistWarned = false;
  private readonly onHide = (): void => {
    if (document.visibilityState === 'hidden') this.flushAndPersist();
  };
  private readonly onPageHide = (): void => this.flushAndPersist();

  private get encounter() {
    return this.stack.encounter;
  }
  private loop!: ReturnType<typeof createFixedTimestepLoop>;
  private overlayText!: Phaser.GameObjects.Text;
  private hudText!: Phaser.GameObjects.Text;
  private weaponText!: Phaser.GameObjects.Text;
  private hudCounters: HudCounters = {
    dashAttempts: 0,
    effectiveDashes: 0,
    wastedDashes: 0,
    bossHitsLanded: 0,
    hitsUnmitigated: 0,
  };
  private lastMoveInput = { dx: 0, dy: 0 };
  private playerSprite!: DirectionalSprite;
  private assaltanteSprite!: DirectionalSprite;
  private debugGraphics!: Phaser.GameObjects.Graphics;
  private keys!: {
    weapon1: Phaser.Input.Keyboard.Key;
    weapon2: Phaser.Input.Keyboard.Key;
    weapon3: Phaser.Input.Keyboard.Key;
    charged: Phaser.Input.Keyboard.Key;
    dodge: Phaser.Input.Keyboard.Key;
    guard: Phaser.Input.Keyboard.Key;
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
    this.load.spritesheet(ASSET_KEYS.playerIdle, '/assets/characters/player/idle.png', {
      frameWidth: CHARACTER_FRAME_SIZE,
      frameHeight: CHARACTER_FRAME_SIZE,
    });
    this.load.spritesheet(ASSET_KEYS.playerWalk, '/assets/characters/player/walk.png', {
      frameWidth: CHARACTER_FRAME_SIZE,
      frameHeight: CHARACTER_FRAME_SIZE,
    });
    this.load.spritesheet(ASSET_KEYS.assaltanteIdle, '/assets/characters/assaltante/idle.png', {
      frameWidth: CHARACTER_FRAME_SIZE,
      frameHeight: CHARACTER_FRAME_SIZE,
    });
    this.load.spritesheet(ASSET_KEYS.assaltanteWalk, '/assets/characters/assaltante/walk.png', {
      frameWidth: CHARACTER_FRAME_SIZE,
      frameHeight: CHARACTER_FRAME_SIZE,
    });
    generatePlaceholderTextures(this);
  }

  create(): void {
    this.ready = false;

    createGroundTilemap(this, ARENA_BOUNDS, ISO_CONFIG);

    this.playerSprite = new DirectionalSprite(
      this,
      { idleTextureKey: ASSET_KEYS.playerIdle, walkTextureKey: ASSET_KEYS.playerWalk, walkFrameCount: WALK_FRAME_COUNT },
      ENTITY_VISUAL_WIDTH,
      ENTITY_VISUAL_HEIGHT,
      { x: 100, y: 300 },
      ISO_CONFIG,
    );
    this.assaltanteSprite = new DirectionalSprite(
      this,
      { idleTextureKey: ASSET_KEYS.assaltanteIdle, walkTextureKey: ASSET_KEYS.assaltanteWalk, walkFrameCount: WALK_FRAME_COUNT },
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

    this.hudText = this.add.text(10, 400, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    });
    this.hudText.setScrollFactor(0);

    this.weaponText = this.add.text(10, 690, '', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffeb3b',
    });
    this.weaponText.setScrollFactor(0);

    const controlsText = this.add.text(
      590,
      10,
      [
        'Controls:',
        '  WASD        - move',
        '  Mouse       - mira',
        '  Clique esq  - ataque primario da arma equipada',
        '  Clique dir  - ataque secundario (sem efeito no arco)',
        '  Q (segurar) - carregado (sem efeito no arco)',
        '  1 / 2 / 3   - espada+escudo / arco / arma pesada',
        '  Espaço     - esquiva (use durante o telegraph do boss pra i-frames)',
        '  E (segure)  - guarda: aperte bem em cima do golpe = parry, segure de longe = bloqueio',
        '  F2 / F8 / F9 - resetar perfil / exportar / importar historico',
      ],
      { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff' },
    );
    controlsText.setScrollFactor(0);

    this.input.mouse?.disableContextMenu();

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input plugin not available');
    this.keys = {
      weapon1: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      weapon2: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      weapon3: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      charged: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      dodge: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      guard: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.keys.weapon1.on('down', () => this.ready && this.encounter.player.switchWeapon('sword_shield'));
    this.keys.weapon2.on('down', () => this.ready && this.encounter.player.switchWeapon('bow'));
    this.keys.weapon3.on('down', () => this.ready && this.encounter.player.switchWeapon('heavy_weapon'));
    this.keys.charged.on('down', () => this.tryEquippedAction('charged'));
    this.keys.charged.on('up', () => this.ready && this.encounter.player.releaseAction());
    this.keys.dodge.on('down', () => this.ready && this.encounter.player.tryDodge());
    this.keys.guard.on('down', () => this.ready && this.encounter.player.startBlock());
    this.keys.guard.on('up', () => this.ready && this.encounter.player.stopBlock());

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        if (!this.tryEquippedAction('light')) this.tryEquippedAction('throw');
      } else if (pointer.rightButtonDown()) {
        this.tryEquippedAction('heavy');
      }
    });

    keyboard.addCapture([
      Phaser.Input.Keyboard.KeyCodes.F2,
      Phaser.Input.Keyboard.KeyCodes.F8,
      Phaser.Input.Keyboard.KeyCodes.F9,
    ]);
    keyboard.on('keydown-F2', () => {
      if (this.ready) this.stack.recording.resetSession();
    });
    keyboard.on('keydown-F8', () => void this.exportHistory());
    keyboard.on('keydown-F9', () => this.importHistory());

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

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', this.onHide);
      window.removeEventListener('pagehide', this.onPageHide);
      this.store.close();
    });
    void this.boot();
  }

  private async boot(): Promise<void> {
    try {
      this.store = await IndexedDbEventStore.open();
    } catch (err) {
      console.warn('[telemetry] IndexedDB unavailable, history will not survive a reload', err);
      this.store = new MemoryEventStore();
    }
    const boot = await loadProfileState(this.store, () => crypto.randomUUID());
    this.startGame(boot);
  }

  private startGame(boot: BootState): void {
    this.stack = createTelemetryStack({
      accumulator: boot.accumulator,
      playerId: boot.playerId,
      sessionId: crypto.randomUUID(),
      firstRunIdx: boot.firstRunIdx,
      nextSeed: () => Math.floor(Math.random() * 0x100000000),
      entitySize: ENTITY_SIZE,
      onRunEnd: () => void this.persist(),
    });

    new OpportunityOverlay(this.encounter.bus, (lines) => {
      this.overlayText.setText(lines.length > 0 ? lines : ['(no opportunities open)']);
    });
    new HudState(this.encounter.bus, (counters) => {
      this.hudCounters = counters;
    });
    this.loop = createFixedTimestepLoop(STEP_MS, (stepMs) => this.stack.step(stepMs));

    // session.start, then the run the previous session left open (tab closed)
    // is closed under its own indices, then the first run of this session.
    this.stack.startSession(
      {
        wall_clock_iso: new Date().toISOString(),
        game_version: GAME_VERSION,
        schema_v: SCHEMA_VERSION,
        persistent: this.store instanceof IndexedDbEventStore && boot.restored,
      },
      boot.abandonedRun,
    );

    this.time.addEvent({ delay: PERSIST_INTERVAL_MS, loop: true, callback: () => void this.persist() });
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('pagehide', this.onPageHide);
    this.ready = true;
  }

  private async persist(): Promise<void> {
    if (!this.stack) return;
    const batch = this.stack.recorder.drain();
    if (batch.length === 0) return;
    try {
      await this.store.append(batch);
    } catch (err) {
      if (!this.persistWarned) {
        console.warn('[telemetry] failed to persist events; continuing in memory', err);
        this.persistWarned = true;
      }
    }
  }

  private flushAndPersist(): void {
    if (!this.ready) return;
    this.stack.recording.flushPending();
    void this.persist();
  }

  private async exportHistory(): Promise<void> {
    if (!this.ready) return;
    this.stack.recording.flushPending();
    await this.persist();
    const events = await this.store.readAll();
    const playerId = String(events[events.length - 1]?.player_id ?? 'sem-id').slice(0, 8);
    const date = new Date().toISOString().slice(0, 10);
    downloadText(`tcc-historico-${playerId}-${date}.ndjson`, toNdjson(events));
  }

  private importHistory(): void {
    if (!this.ready) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ndjson,.jsonl,.txt';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.stack.recording.flushPending();
      await this.persist();
      const result = await importInto(this.store, await file.text());
      if (result.invalidLines > 0) {
        console.warn(`[telemetry] import skipped ${result.invalidLines} invalid line(s)`);
      }
      if (result.foreignPlayerIds.length > 0) {
        console.warn(
          `[telemetry] import brought events of other player(s) (${result.foreignPlayerIds.join(', ')}); ` +
            `adopted player ${result.playerId} — only that player's events are replayed`,
        );
      }
      this.scene.restart(); // new session: profile rebuilt from the merged history
    };
    input.click();
  }

  update(_time: number, delta: number): void {
    if (!this.ready) return;

    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const playerScreen = toScreen(this.encounter.player.position, ISO_CONFIG);
    const aimDelta = { x: worldPoint.x - playerScreen.x, y: worldPoint.y - playerScreen.y };
    this.encounter.player.setAimDirection(fromScreen(aimDelta, ISO_CONFIG));

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
    this.playerSprite.syncDirection(
      this.encounter.player.facing,
      this.lastMoveInput.dx !== 0 || this.lastMoveInput.dy !== 0,
    );
    this.playerSprite.setTint(this.encounter.player.isInvulnerable ? 0x8bc34a : 0xffffff);

    this.assaltanteSprite.syncPosition(assaltantePos);
    this.assaltanteSprite.syncDirection(
      this.encounter.assaltante.attackDirection,
      this.encounter.assaltante.state === 'chasing',
    );
    this.assaltanteSprite.setTint(
      this.encounter.assaltante.state === 'attacking' ? 0xff9800 : 0xffffff,
    );

    const equippedWeaponId = this.encounter.player.equippedWeaponId;
    this.weaponText.setText(`Arma: ${WEAPON_LABELS[equippedWeaponId] ?? equippedWeaponId}`);

    this.hudText.setText([
      `HP: ${this.encounter.player.hp}/${PLAYER_MAX_HP} · inimigo: ${this.encounter.assaltante.hp}/${ASSALTANTE_MAX_HP}`,
      `run ${this.stack.director.runIdx} · sala ${this.stack.director.roomIdx + 1} · encontro ${this.stack.director.encIdx + 1}/${ROOM_ENCOUNTER_COUNT}`,
      `move: (${this.lastMoveInput.dx}, ${this.lastMoveInput.dy})`,
      `dash: ${this.encounter.player.isInvulnerable ? 'active (i-frames)' : 'idle'}`,
      `dashes: ${this.hudCounters.effectiveDashes} effective / ${this.hudCounters.wastedDashes} wasted`,
      `boss: ${this.encounter.assaltante.state} (${this.encounter.assaltante.activeRuleId ?? '-'})`,
      `boss hits landed: ${this.hudCounters.bossHitsLanded}`,
      `postura: ${Math.round(this.encounter.player.poise)}/100`,
      `hits sofridos: ${this.hudCounters.hitsUnmitigated}`,
    ]);

    this.drawDebugHitboxes();
  }

  private tryEquippedAction(actionType: ActionType): boolean {
    if (!this.ready) return false;
    const action = findWeaponAction(this.encounter.player.equippedWeaponId, actionType);
    if (!action) return false;
    this.encounter.player.tryAction(action.id);
    return true;
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
    if (playerAttack) this.debugGraphics.fillPoints(this.sectorAsPoints(playerAttack), true);
    const assaltanteAttack = this.encounter.assaltante.attackHitbox();
    if (assaltanteAttack) this.debugGraphics.fillPoints(this.sectorAsPoints(assaltanteAttack), true);
  }

  private sectorAsPoints(sector: AttackSector, samples = 10): Phaser.Geom.Point[] {
    const centerAngle = Math.atan2(sector.direction.y, sector.direction.x);
    const originScreen = toScreen(sector.origin, ISO_CONFIG);
    const points: Phaser.Geom.Point[] = [new Phaser.Geom.Point(originScreen.x, originScreen.y)];
    for (let i = 0; i <= samples; i++) {
      const angle = centerAngle - sector.halfAngleRad + (2 * sector.halfAngleRad * i) / samples;
      const worldPoint = {
        x: sector.origin.x + Math.cos(angle) * sector.reach,
        y: sector.origin.y + Math.sin(angle) * sector.reach,
      };
      const screen = toScreen(worldPoint, ISO_CONFIG);
      points.push(new Phaser.Geom.Point(screen.x, screen.y));
    }
    return points;
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
