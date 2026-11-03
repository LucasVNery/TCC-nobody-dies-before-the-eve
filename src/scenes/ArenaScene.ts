// src/scenes/ArenaScene.ts
import Phaser from 'phaser';
import { createFixedTimestepLoop } from '../core/fixedTimestepLoop';
import { PLAYER_MAX_HP } from '../combat/movementDefs';
import { findWeaponAction } from '../combat/actionRegistry';
import { ASSET_KEYS } from '../visual/assetRegistry';
import { loadFloorTiles } from '../visual/floor/floorAssets';
import { generatePlaceholderTextures, ENTITY_SIZE } from '../visual/placeholderTextures';
import { SessionController } from './session/sessionController';
import { BOSS_CONFIG_DEMO } from '../boss/bossConfig';
import { createBrowserPlatform } from './session/browserPlatform';
import { PlayerInput, type PlayerIntents } from './input/playerInput';
import { bindHotkeys } from './input/hotkeys';
import { claimStore } from './session/storeHandoff';
import { CameraRig } from './view/cameraRig';
import { WorldView } from './view/worldView';
import { FeedbackView } from './view/feedbackView';
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
  private aggregator!: MetricsAggregator;
  private tape!: EventTape;
  private loop!: ReturnType<typeof createFixedTimestepLoop>;
  private playerInput!: PlayerInput;
  private world!: WorldView;
  private cameraRig!: CameraRig;
  private debugDraw!: DebugDraw;
  private feedback!: FeedbackView;
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
      // playtest: open the game with ?boss=demo for the short-run thresholds
      bossConfig: new URLSearchParams(window.location.search).get('boss') === 'demo' ? BOSS_CONFIG_DEMO : undefined,
    });
    this.session = session;
    this.aggregator = new MetricsAggregator();
    this.tape = new EventTape();
    this.gate = new RefreshGate();
    this.stepAvg = new MovingAverage(STEP_AVG_FRAMES);

    // Every Phaser object exists before the camera rig splits world and UI.
    this.world = new WorldView(this);
    this.debugDraw = new DebugDraw(this);
    this.feedback = new FeedbackView(this, {
      shake: (px, decayMs) => this.cameraRig.shake(px, decayMs),
      flash: (target) => this.world.flash(target),
      staminaDenied: () => this.hud.flashStamina(),
    });
    this.hud = new GameplayHud(this);
    this.cameraRig = new CameraRig(this);
    this.cameraRig.attach(this.world.playerSprite.gameObject, this.hud.objects);

    // Waits for whoever held the store before (a restarted ArenaScene or the menu's Análise) to close it.
    const storeClaim = claimStore(this.registry);
    this.playerInput = new PlayerInput(this, () => (session.ready ? this.intents() : null));
    this.panel = new AnalysisPanel(document.body);
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input plugin not available');
    const unbindHotkeys = bindHotkeys(keyboard, {
      resetProfile: () => { if (session.ready) session.resetProfile(); },
      exportHistory: () => void session.exportHistory(),
      importHistory: () =>
        void session.importHistory().then((r) => {
          if (r === 'restart') this.scene.restart();
        }),
      togglePanel: () => this.panel.toggle(),
      toggleHelp: () => this.hud.toggleHelp(),
      toggleDebug: () => this.debugDraw.toggle(),
      jumpToBoss: () => { if (session.ready) session.stack.director.debugEnterBoss(); },
      forceBarrage: () => { if (session.ready) session.stack.director.debugBarrage(); },
      backToMenu: () => this.scene.start('MenuScene'),
    });

    this.time.addEvent({ delay: PERSIST_INTERVAL_MS, loop: true, callback: () => void session.persist() });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unbindHotkeys();
      this.playerInput.destroy();
      // PlayerInput's keys were added with capture on; captures are global, so drop them before the next scene.
      keyboard.clearCaptures();
      this.panel.destroy();
      // The next store holder (restart or menu) waits for the final flush and the close.
      storeClaim.release(session.shutdown());
    });

    void session.start({
      after: storeClaim.ready,
      onStackReady: (stack, history) => {
        const { aggregator: agg, tape, world, feedback } = this;
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
          // Separate guard: a failure above must not skip the effects, nor the reverse.
          try {
            feedback.handleEvent(e);
          } catch (err) {
            console.warn('[feedback] failed to apply an event', err);
          }
        });
        this.loop = createFixedTimestepLoop(STEP_MS, (ms) => { stack.step(ms); world.recordStep(stack.encounter); });
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
      useItem: () => encounter.useItem(),
      startBlock: () => player.startBlock(),
      stopBlock: () => player.stopBlock(),
      setSprint: (on) => player.setSprint(on),
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
    this.world.sync(encounter, snap.move.dx !== 0 || snap.move.dy !== 0, this.loop.alpha);
    this.cameraRig.update(delta);
    this.hud.update({
      hp: player.hp, maxHp: PLAYER_MAX_HP, enemyHp: assaltante.hp, enemyMaxHp: assaltante.maxHp,
      stamina: player.stamina.value,
      weaponLabel: WEAPON_LABELS[player.equippedWeaponId] ?? player.equippedWeaponId,
      heldItem: encounter.items.held,
      powerActive: encounter.items.powerActive,
      run: director.runIdx + 1, room: director.roomIdx + 1, enc: director.encIdx + 1, encTotal: director.roomEncounterTotal,
      bossRoom: director.inBossRoom,
    });
    this.feedback.update(encounter);
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
          stamina: player.stamina.value,
        },
        tape: this.tape.entries(),
        status: session.status(),
        perf: { fps: this.game.loop.actualFps, stepMs: this.stepAvg.value },
      }),
    );
  }
}
