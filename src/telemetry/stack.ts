// src/telemetry/stack.ts
import { Encounter } from '../combat/encounter';
import type { ProfileAccumulator } from '../profile/profileAccumulator';
import { RunDirector, PLAYER_START } from '../game/runDirector';
import { RecordingProfile } from './recordingProfile';
import { TelemetryRecorder } from './telemetryRecorder';

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
}

export interface TelemetryStack {
  accumulator: ProfileAccumulator;
  recorder: TelemetryRecorder;
  recording: RecordingProfile;
  encounter: Encounter<RecordingProfile>;
  director: RunDirector;
  /** One fixed simulation step: advance telemetry time, then the game. */
  step(stepMs: number): void;
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
  const director = new RunDirector({
    encounter,
    snapshots: opts.accumulator,
    nextSeed: opts.nextSeed,
    firstRunIdx: opts.firstRunIdx,
  });
  return {
    accumulator: opts.accumulator,
    recorder,
    recording,
    encounter,
    director,
    step(stepMs: number) {
      recorder.beginTick(stepMs);
      director.step(stepMs);
    },
  };
}
