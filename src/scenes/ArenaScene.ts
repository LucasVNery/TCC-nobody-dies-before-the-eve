// src/scenes/ArenaScene.ts
import Phaser from 'phaser';
import { createFixedTimestepLoop } from '../core/fixedTimestepLoop';
import { PLAYER_MAX_HP, ASSALTANTE_MAX_HP, ROOM_ENCOUNTER_COUNT } from '../combat/movementDefs';
import { findWeaponAction } from '../combat/actionRegistry';
import { ASSET_KEYS } from '../visual/assetRegistry';
import { loadFloorTiles } from '../visual/floor/floorAssets';
import { generatePlaceholderTextures, ENTITY_SIZE } from '../visual/placeholderTextures';
import { SessionController } from './session/sessionController';
import { createBrowserPlatform } from './session/browserPlatform';
import { PlayerInput, type PlayerIntents } from './input/playerInput';
import { bindHotkeys } from './input/hotkeys';
import { CameraRig } from './view/cameraRig';
import { WorldView } from './view/worldView';
import { DebugDraw } from './view/debugDraw';
import { GameplayHud, WEAPON_LABELS } from './hud/gameplayHud';
import { MetricsAggregator } from '../debug/analysis/metricsAggregator';
import { EventTape } from '../debug/analysis/eventTape';
import { buildAnalysisView } from '../debug/analysis/analysisViewModel';
import { AnalysisPanel, RefreshGate } from '../debug/analysis/analysisPanel';

const STEP_MS = 1000 / 60;
const PERSIST_INTERVAL_MS = 2000;
const STEP_AVG_FRAMES = 60;
// Frame size of every character sheet (FRAME_SIZE in tools/blender/render_character.py).
const CHARACTER_FRAME_SIZE = 128;

/** Moving average of the last `size` samples. */
class MovingAverage {
  private readonly samples: number[] = [];
  private sum = 0;
  constructor(private readonly size: number) {}
  add(v: number): void {
    this.samples.push(v);
    this.sum += v;
    if (this.samples.length > this.size) this.sum -= this.samples.shift() ?? 0;
  }
  get value(): number { return this.samples.length === 0 ? 0 : this.sum / this.samples.length; }
}

/** Thin orchestrator: wires the session, input, views, gameplay HUD and analysis panel. */
export class ArenaScene extends Phaser.Scene {
  private session!: SessionController;
  /** Settles once the previous scene instance's session has shut down (its store closed). */
  private previousShutdown: Promise<void> = Promise.resolve();
  private aggregator!: MetricsAggregator;
  private tape!: EventTape;
  private loop!: ReturnType<typeof createFixedTimestepLoop>;
  private playerInput!: PlayerInput;
  private world!: WorldView;
  private debugDraw!: DebugDraw;
  private hud!: GameplayHud;
  private panel!: AnalysisPanel;
  private gate!: RefreshGate;
  private stepAvg!: MovingAverage;

  constructor() {
    super('ArenaScene');
  }

  preload(): void {
    const sheet = { frameWidth: CHARACTER_FRAME_SIZE, frameHeight: CHARACTER_FRAME_SIZE };
    loadFloorTiles(this);
    this.load.spritesheet(ASSET_KEYS.playerIdle, '/assets/characters/player/idle.png', sheet);
    this.load.spritesheet(ASSET_KEYS.playerWalk, '/assets/characters/player/walk.png', sheet);
    this.load.spritesheet(ASSET_KEYS.assaltanteIdle, '/assets/characters/assaltante/idle.png', sheet);
    this.load.spritesheet(ASSET_KEYS.assaltanteWalk, '/assets/characters/assaltante/walk.png', sheet);
    generatePlaceholderTextures(this);
  }

  create(): void {
    const session = new SessionController({
      platform: createBrowserPlatform(),
      entitySize: ENTITY_SIZE,
      nextSeed: () => Math.floor(Math.random() * 0x100000000),
    });
    this.session = session;
    this.aggregator = new MetricsAggregator();
    this.tape = new EventTape();
    this.gate = new RefreshGate();
    this.stepAvg = new MovingAverage(STEP_AVG_FRAMES);

    // Every Phaser object exists before the camera rig splits world and UI.
    this.world = new WorldView(this);
    this.debugDraw = new DebugDraw(this);
    this.hud = new GameplayHud(this);
    new CameraRig(this).attach(this.world.playerSprite.gameObject, this.hud.objects);

    this.playerInput = new PlayerInput(this, () => (session.ready ? this.intents() : null));
    this.panel = new AnalysisPanel(document.body);
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input plugin not available');
    bindHotkeys(keyboard, {
      resetProfile: () => { if (session.ready) session.resetProfile(); },
      exportHistory: () => void session.exportHistory(),
      importHistory: () =>
        void session.importHistory().then((r) => {
          if (r === 'restart') this.scene.restart();
        }),
      togglePanel: () => this.panel.toggle(),
      toggleHelp: () => this.hud.toggleHelp(),
    });

    this.time.addEvent({ delay: PERSIST_INTERVAL_MS, loop: true, callback: () => void session.persist() });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.playerInput.destroy();
      this.panel.destroy();
      this.previousShutdown = session.shutdown();
    });

    void session.start({
      after: this.previousShutdown,
      onStackReady: (stack, history) => {
        const { aggregator: agg, tape, world } = this;
        agg.applyAll(history);
        stack.recorder.subscribe((e) => {
          // recorder.log rethrows listener errors into the game loop; the HUD must never break it.
          try {
            agg.apply(e);
            tape.push(e);
            world.handleEvent(e);
          } catch (err) {
            console.warn('[analysis] failed to fold an event', err);
          }
        });
        this.loop = createFixedTimestepLoop(STEP_MS, (stepMs) => stack.step(stepMs));
      },
    });
  }

  /** Player intents for PlayerInput; only called while the session is ready. */
  private intents(): PlayerIntents {
    const encounter = this.session.stack.encounter;
    const player = encounter.player;
    return {
      setMoveInput: (dx, dy) => encounter.setPlayerMoveInput(dx, dy),
      setAimDirection: (v) => player.setAimDirection(v),
      switchWeapon: (id) => player.switchWeapon(id),
      releaseAction: () => player.releaseAction(),
      tryDodge: () => player.tryDodge(),
      startBlock: () => player.startBlock(),
      stopBlock: () => player.stopBlock(),
      tryEquippedAction: (type) => {
        const action = findWeaponAction(player.equippedWeaponId, type);
        if (!action) return false;
        player.tryAction(action.id);
        return true;
      },
      equippedWeaponId: player.equippedWeaponId,
      position: player.position,
    };
  }

  update(_time: number, delta: number): void {
    const session = this.session;
    if (!session.ready) return;
    const { encounter, director, accumulator } = session.stack;
    const { player, assaltante } = encounter;

    this.playerInput.update();
    const t0 = performance.now();
    this.loop.advance(delta);
    this.stepAvg.add(performance.now() - t0);

    const snap = this.playerInput.snapshot();
    this.world.sync(encounter, snap.move.dx !== 0 || snap.move.dy !== 0);
    this.hud.update({
      hp: player.hp,
      maxHp: PLAYER_MAX_HP,
      enemyHp: assaltante.hp,
      enemyMaxHp: ASSALTANTE_MAX_HP,
      poise: player.poise,
      weaponLabel: WEAPON_LABELS[player.equippedWeaponId] ?? player.equippedWeaponId,
      run: director.runIdx + 1, room: director.roomIdx + 1, enc: director.encIdx + 1, encTotal: ROOM_ENCOUNTER_COUNT,
    });
    this.debugDraw.draw(encounter);

    if (!this.gate.due(performance.now(), this.panel.visible)) return;
    this.panel.render(
      buildAnalysisView({
        metrics: this.aggregator.snapshot(),
        profile: accumulator,
        live: {
          keysDown: snap.keysDown,
          move: snap.move,
          aimDeg: (Math.atan2(snap.aim.y, snap.aim.x) * 180) / Math.PI,
          weaponId: player.equippedWeaponId,
          playerState: player.state,
          enemyState: assaltante.state,
          playerHp: player.hp,
          enemyHp: assaltante.hp,
          poise: player.poise,
        },
        tape: this.tape.entries(),
        status: session.status(),
        perf: { fps: this.game.loop.actualFps, stepMs: this.stepAvg.value },
      }),
    );
  }
}
