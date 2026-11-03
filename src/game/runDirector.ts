// src/game/runDirector.ts
import type { Encounter } from '../combat/encounter';
import type { ProfileSink } from '../profile/profileSink';
import type { ProfileSnapshotPayload } from '../profile/types';
import type { Vec2 } from '../combat/types';
import { createPrng, type Prng } from '../core/prng';
import { ARENA_BOUNDS, ROOM_ENCOUNTER_COUNT, MIN_SPAWN_DISTANCE } from '../combat/movementDefs';
import type { BossPlan } from '../boss/types';
import { BOSS_AFTER_ENCOUNTERS, BOSS_CONFIG, type BossConfig } from '../boss/bossConfig';
import { advanceMult, dashCooldownMs } from '../boss/responses';
import { BossBrain } from '../boss/bossBrain';

/** Player start position of every run (center of the arena). */
export const PLAYER_START: Vec2 = {
  x: ARENA_BOUNDS.x + ARENA_BOUNDS.width / 2 - 10,
  y: ARENA_BOUNDS.y + ARENA_BOUNDS.height / 2 - 10,
};

const SPAWN_INSET = 100;

/** 8 candidate spawn points: corners and edge midpoints, inset from the arena border. */
export function spawnCandidates(): Vec2[] {
  const { x, y, width, height } = ARENA_BOUNDS;
  const left = x + SPAWN_INSET;
  const right = x + width - SPAWN_INSET;
  const top = y + SPAWN_INSET;
  const bottom = y + height - SPAWN_INSET;
  const cx = x + width / 2;
  const cy = y + height / 2;
  return [
    { x: left, y: top }, { x: cx, y: top }, { x: right, y: top }, { x: right, y: cy },
    { x: right, y: bottom }, { x: cx, y: bottom }, { x: left, y: bottom }, { x: left, y: cy },
  ];
}

/**
 * Seeded choice among the candidates at least MIN_SPAWN_DISTANCE from the
 * player. In a 1600×1200 arena at least one inset corner is always ≥ 600 px
 * away from any player position, so the filtered list is never empty.
 */
export function pickSpawn(prng: Prng, player: Vec2): Vec2 {
  const far = spawnCandidates().filter(
    (c) => Math.hypot(c.x - player.x, c.y - player.y) >= MIN_SPAWN_DISTANCE,
  );
  return far[prng.nextInt(far.length)];
}

export interface SnapshotSource {
  snapshot(at: ProfileSnapshotPayload['at']): ProfileSnapshotPayload;
}

export interface RunDirectorOptions {
  encounter: Encounter<ProfileSink>;
  /** Read side of the same profile the encounter writes to. */
  snapshots: SnapshotSource;
  /** Injected so logic stays free of Math.random; one call per run. */
  nextSeed: () => number;
  /** Continues run numbering across sessions (read from the stored log). */
  firstRunIdx?: number;
  /** Boss plan, called once at each boss room entry. Without it there is no boss room. */
  planBoss?: () => BossPlan;
  /** Encounters cleared in a run before the boss room (default BOSS_AFTER_ENCOUNTERS). */
  bossAfterEncounters?: number;
  bossConfig?: BossConfig;
}

/**
 * Owns the encounter → room → run lifecycle over a single Encounter (spec
 * 2026-09-30 §3.2): Assaltante death ends an encounter, ROOM_ENCOUNTER_COUNT
 * encounters end a room, player death ends the run (the interrupted room
 * still counts, flagged partial). The profile is never reset here — it is the
 * player's, not the run's (D4).
 *
 * With `planBoss`, the run's encounter number `bossAfterEncounters` closes its
 * room and opens the boss room: the plan's levels are frozen and logged at
 * boss.entry, and killing the boss ends the run as a victory.
 */
export class RunDirector {
  private _runIdx: number;
  private _roomIdx = 0;
  private _encIdx = 0;
  private runElapsedMs = 0;
  private roomsCleared = 0;
  private encountersCleared = 0;
  private prng: Prng = createPrng(0);
  private runSeed = 0;
  private bossRoom = false;
  private started = false;

  constructor(private readonly opts: RunDirectorOptions) {
    this._runIdx = opts.firstRunIdx ?? 0;
  }

  get runIdx(): number {
    return this._runIdx;
  }

  get roomIdx(): number {
    return this._roomIdx;
  }

  get encIdx(): number {
    return this._encIdx;
  }

  get inBossRoom(): boolean {
    return this.bossRoom;
  }

  private get bossConfig(): BossConfig {
    return this.opts.bossConfig ?? BOSS_CONFIG;
  }

  start(): void {
    if (this.started) throw new Error('RunDirector already started');
    this.started = true;
    this.beginRun();
  }

  step(stepMs: number): void {
    if (!this.started) throw new Error('RunDirector not started');
    const { encounter } = this.opts;
    encounter.step(stepMs);
    this.runElapsedMs += stepMs;
    if (encounter.player.isDead) {
      this.endRun(); // player death wins a same-tick double KO
      return;
    }
    if (!encounter.assaltante.isDead) return;
    if (this.bossRoom) this.endBossRun();
    else this.endEncounter();
  }

  /**
   * Playtest shortcut: closes the current encounter as a normal clear and opens the boss room right away
   * (the log looks like a run that cleared its encounters). No-op without a boss plan or inside the boss room.
   */
  debugEnterBoss(): void {
    if (!this.started || this.bossRoom || !this.opts.planBoss) return;
    this.encountersCleared = (this.opts.bossAfterEncounters ?? BOSS_AFTER_ENCOUNTERS) - 1;
    this.endEncounter();
  }

  /**
   * Playtest shortcut: makes the boss start a barrage now (base strikes, not logged as boss.barrage).
   * Ignored outside the boss room or while the boss is busy.
   */
  debugBarrage(): void {
    if (!this.bossRoom) return;
    const cfg = this.bossConfig;
    this.opts.encounter.assaltante.startBarrage(cfg.barrageBaseStrikes, cfg.barragePauseMs);
  }

  private get bus() {
    return this.opts.encounter.bus;
  }

  private get profile(): ProfileSink {
    return this.opts.encounter.profile;
  }

  private beginRun(): void {
    const { encounter } = this.opts;
    const seed = this.opts.nextSeed() >>> 0;
    this.prng = createPrng(seed);
    this.runSeed = seed;
    this.bossRoom = false;
    encounter.boss = null;
    this._roomIdx = 0;
    this._encIdx = 0;
    this.runElapsedMs = 0;
    this.roomsCleared = 0;
    this.encountersCleared = 0;
    encounter.items.reset((seed ^ 0x1e7e55) >>> 0);
    encounter.assaltante.reseed((seed ^ 0x5eed11) >>> 0);
    encounter.resetPlayer(PLAYER_START); // also restores the base dash cooldown
    encounter.respawnEnemy(pickSpawn(this.prng, PLAYER_START), 'source_interrupted');
    this.bus.emit('run.start', { run_idx: this._runIdx, seed });
    this.bus.emit('room.enter', { room_idx: 0 });
    this.bus.emit('encounter.start', { enc_idx: 0 });
  }

  private endEncounter(): void {
    const { encounter } = this.opts;
    this.bus.emit('enemy.death', {});
    encounter.respawnEnemy(pickSpawn(this.prng, encounter.player.position), 'source_interrupted');
    this.bus.emit('encounter.end', { enc_idx: this._encIdx });
    this.profile.applyEncounterBoundary();
    this.encountersCleared += 1;
    this._encIdx += 1;
    const toBoss =
      this.opts.planBoss !== undefined &&
      !this.bossRoom &&
      this.encountersCleared >= (this.opts.bossAfterEncounters ?? BOSS_AFTER_ENCOUNTERS);
    if (toBoss || this._encIdx >= ROOM_ENCOUNTER_COUNT) {
      // The boss closes the current room early; it always holds at least the encounter just ended.
      this.profile.applyRoomBoundary();
      this.emitSnapshot(false);
      this.roomsCleared += 1;
      this._roomIdx += 1;
      this._encIdx = 0;
      this.bus.emit('room.enter', { room_idx: this._roomIdx });
    }
    if (toBoss) this.enterBossRoom();
    this.bus.emit('encounter.start', { enc_idx: this._encIdx });
  }

  /**
   * Boss setup on the enemy endEncounter just respawned. The plan is read once
   * and its levels stay frozen for the whole fight. Logs, in order:
   * profile.snapshot{at:'boss.entry'} (always: it is what opens the gate for
   * later runs), then one boss.adapt per active response.
   */
  private enterBossRoom(): void {
    const { encounter } = this.opts;
    const cfg = this.bossConfig;
    const plan = this.opts.planBoss!();
    const levels = { ...plan.levels };
    const dodgeLevel = Math.max(levels.dodge_abuse, levels.reflex_dash);
    const applied = {
      dash_cooldown_ms: dashCooldownMs(dodgeLevel, cfg),
      advance_mult: Math.max(advanceMult(levels.far, cfg), advanceMult(dodgeLevel, cfg)),
    };
    this.bossRoom = true;
    this.bus.emit('profile.snapshot', {
      partial: false,
      snapshot: { ...this.opts.snapshots.snapshot('boss.entry'), levels: { ...levels }, applied: { ...applied } },
    });
    const assaltante = encounter.assaltante;
    assaltante.configureBoss({ maxHp: cfg.bossMaxHp, advanceMult: applied.advance_mult, bodyScale: cfg.bodyScale });
    encounter.player.setDodgeCooldownMs(applied.dash_cooldown_ms);
    // After configureBoss: the boss.adapt ctx describes the boss, not the respawned elite.
    for (const record of plan.records) {
      if (record.active) this.bus.emit('boss.adapt', { ...record, ...applied });
    }
    encounter.boss = new BossBrain({
      barrageLevel: levels.passive_defense,
      prng: createPrng((this.runSeed ^ 0xb055) >>> 0),
      config: cfg,
      onBarrage: (strikes, info) => {
        assaltante.startBarrage(strikes, cfg.barragePauseMs);
        this.bus.emit('boss.barrage', {
          strikes,
          chance: info.chance,
          duration_mult: info.durationMult,
          level: info.level,
        });
      },
    });
  }

  /** The boss died (the player did not, same tick): the run ends as a victory. */
  private endBossRun(): void {
    const { encounter } = this.opts;
    this.bus.emit('enemy.death', {});
    // Close the dead boss's open windows inside the run that is ending, as any enemy death does.
    encounter.respawnEnemy(encounter.assaltante.position, 'source_interrupted');
    this.bus.emit('encounter.end', { enc_idx: this._encIdx });
    this.profile.applyEncounterBoundary();
    this.encountersCleared += 1;
    this.profile.applyRoomBoundary(); // the boss room is cleared
    this.emitSnapshot(false);
    this.roomsCleared += 1;
    encounter.items.endRun();
    this.bus.emit('run.end', {
      run_idx: this._runIdx,
      cause: 'victory',
      duration_ms: this.runElapsedMs,
      rooms_cleared: this.roomsCleared,
      encounters_cleared: this.encountersCleared,
    });
    this._runIdx += 1;
    this.beginRun();
  }

  private endRun(): void {
    const { encounter } = this.opts;
    this.bus.emit('player.death', {});
    // Close the enemy's open windows inside the run that is ending.
    encounter.respawnEnemy(encounter.assaltante.position, 'player_dead');
    this.bus.emit('encounter.end', { enc_idx: this._encIdx });
    this.profile.applyEncounterBoundary();
    this.profile.applyRoomBoundary(); // the interrupted room counts, flagged partial
    this.emitSnapshot(true);
    encounter.items.endRun(); // ground items expire as run_end before the run closes
    this.bus.emit('run.end', {
      run_idx: this._runIdx,
      cause: 'death',
      duration_ms: this.runElapsedMs,
      rooms_cleared: this.roomsCleared,
      encounters_cleared: this.encountersCleared,
    });
    this._runIdx += 1;
    this.beginRun();
  }

  private emitSnapshot(partial: boolean): void {
    this.bus.emit('profile.snapshot', { partial, snapshot: this.opts.snapshots.snapshot('room.exit') });
  }
}
