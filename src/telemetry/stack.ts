// src/telemetry/stack.ts
import { Encounter } from '../combat/encounter';
import type { ProfileAccumulator } from '../profile/profileAccumulator';
import { RunDirector, PLAYER_START } from '../game/runDirector';
import { RecordingProfile } from './recordingProfile';
import { TelemetryRecorder } from './telemetryRecorder';
import type { AbandonedRun } from './abandonedRun';
import type { LoggedEvent } from './schema';
import { GAME_VERSION } from './schema';
import { HabitEvidence } from '../boss/habitEvidence';
import { planBoss } from '../boss/bossPlanner';
import type { BossConfig } from '../boss/bossConfig';

export interface TelemetryStackOptions {
  /** The live profile — freshly rebuilt from the stored log on load. */
  accumulator: ProfileAccumulator;
  playerId: string;
  sessionId: string;
  firstRunIdx: number;
  nextSeed: () => number;
  /** Hurtbox size of player and Assaltante (the scene passes ENTITY_SIZE). */
  entitySize: number;
  onRunEnd?: () => void;
  /** The current player's stored events (all game versions); only read when `boss` is set. */
  history?: readonly LoggedEvent[];
  /** Opt-in boss room: habit evidence from `history` + the live log drives the boss plan. */
  boss?: { config?: BossConfig; afterEncounters?: number };
}

export interface TelemetryStack {
  accumulator: ProfileAccumulator;
  recorder: TelemetryRecorder;
  recording: RecordingProfile;
  encounter: Encounter<RecordingProfile>;
  director: RunDirector;
  /** Habit evidence behind the boss plan; null when the boss room is off. */
  evidence: HabitEvidence | null;
  /** One fixed simulation step: advance telemetry time, then the game. */
  step(stepMs: number): void;
  /**
   * Closes a run the previous session left open (see findAbandonedRun), under
   * that run's own indices: encounter.end, encounter + room boundaries (logged
   * as ordinary obs.* by the RecordingProfile, so replay stays exact),
   * profile.snapshot {partial: true}, run.end {cause: 'abandoned'}.
   */
  closeAbandonedRun(run: AbandonedRun): void;
  /** Session start: log session.start, close the abandoned run if any, start the first run. */
  startSession(sessionStart: Record<string, unknown>, abandoned: AbandonedRun | null): void;
}

/** Wires recorder → recording profile → encounter → director (used by the scene and by tests). */
export function createTelemetryStack(opts: TelemetryStackOptions): TelemetryStack {
  const recorder = new TelemetryRecorder({
    playerId: opts.playerId,
    sessionId: opts.sessionId,
    onRunEnd: opts.onRunEnd,
  });
  const recording = new RecordingProfile(opts.accumulator, (t, p) => recorder.log(t, p), () => recorder.nowMs);
  const size = opts.entitySize;
  const encounter = new Encounter(
    { x: PLAYER_START.x, y: PLAYER_START.y, width: size, height: size },
    { x: 0, y: 0, width: size, height: size },
    recording,
  );
  recorder.attach(encounter);
  const boss = opts.boss;
  let evidence: HabitEvidence | null = null;
  if (boss) {
    evidence = new HabitEvidence({ playerId: opts.playerId, gameVersion: GAME_VERSION, config: boss.config });
    evidence.applyAll(opts.history ?? []);
    // Subscribed before session.start is logged: the evidence learns the session's version from it.
    const live = evidence;
    recorder.subscribe((e) => live.apply(e));
  }
  const director = new RunDirector({
    encounter,
    snapshots: opts.accumulator,
    nextSeed: opts.nextSeed,
    firstRunIdx: opts.firstRunIdx,
    ...(evidence && boss
      ? {
          planBoss: () => planBoss(evidence, opts.accumulator, boss.config),
          bossAfterEncounters: boss.afterEncounters,
          bossConfig: boss.config,
        }
      : {}),
  });
  const closeAbandonedRun = (run: AbandonedRun): void => {
    recorder.withIndices(run, () => {
      const bus = encounter.bus;
      bus.emit('encounter.end', { enc_idx: run.enc_idx });
      recording.applyEncounterBoundary();
      recording.applyRoomBoundary();
      bus.emit('profile.snapshot', { partial: true, snapshot: opts.accumulator.snapshot('room.exit') });
      bus.emit('run.end', {
        run_idx: run.run_idx,
        cause: 'abandoned',
        duration_ms: run.duration_ms,
        rooms_cleared: run.rooms_cleared,
        encounters_cleared: run.encounters_cleared,
      });
    });
  };
  return {
    accumulator: opts.accumulator,
    recorder,
    recording,
    encounter,
    director,
    evidence,
    step(stepMs: number) {
      // Hit-stop: a frozen step advances nothing (log time, opportunities,
      // stamina, input-buffer clock, enemy, player).
      if (encounter.hitStop.active) {
        encounter.hitStop.consume();
        return;
      }
      encounter.hitStop.tickFree();
      recorder.beginTick(stepMs);
      director.step(stepMs);
    },
    closeAbandonedRun,
    startSession(sessionStart, abandoned) {
      encounter.hitStop.reset();
      recorder.log('session.start', sessionStart);
      if (abandoned) closeAbandonedRun(abandoned);
      director.start();
    },
  };
}
