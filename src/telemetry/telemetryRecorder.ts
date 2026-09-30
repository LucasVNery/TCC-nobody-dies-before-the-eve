// src/telemetry/telemetryRecorder.ts
import type { Encounter } from '../combat/encounter';
import type { ProfileSink } from '../profile/profileSink';
import { SCHEMA_VERSION, type LoggedEvent } from './schema';
import { buildCtx, r1 } from './context';

export const POS_SAMPLE_INTERVAL_MS = 250;

/** Bus events logged with a combat `ctx` (spec §4.3). */
const CONTEXT_EVENTS = [
  'player.action', 'player.dodge', 'player.defense', 'player.hit_unmitigated', 'player.hurt',
  'player.death', 'enemy.attack_start', 'enemy.hurt', 'enemy.death', 'opp.open', 'opp.close',
] as const;

export interface TelemetryRecorderOptions {
  playerId: string;
  sessionId: string;
  /** Called right after run.end is logged — the scene persists the buffer then. */
  onRunEnd?: () => void;
}

/**
 * Turns bus events into enveloped LoggedEvents in an in-memory buffer (layer B
 * of the log), and exposes `log()` for the obs.* layer and session.start.
 * Knows nothing about storage: the scene drains the buffer into an EventStore.
 */
export class TelemetryRecorder {
  private buffer: LoggedEvent[] = [];
  private seq = 0;
  private tMs = 0;
  private sinceSampleMs = 0;
  private runIdx = 0;
  private roomIdx = 0;
  private encIdx = 0;
  private lastActionT: number | null = null;
  private encounter: Encounter<ProfileSink> | null = null;

  constructor(private readonly opts: TelemetryRecorderOptions) {}

  get nowMs(): number {
    return this.tMs;
  }

  attach(encounter: Encounter<ProfileSink>): void {
    if (this.encounter) throw new Error('TelemetryRecorder already attached');
    this.encounter = encounter;
    const bus = encounter.bus;

    for (const type of CONTEXT_EVENTS) {
      bus.on(type, (payload: unknown) => this.logWithCtx(type, payload));
    }
    bus.on('run.start', (e) => {
      this.runIdx = e.run_idx;
      this.roomIdx = 0;
      this.encIdx = 0;
      this.lastActionT = null;
      this.log('run.start', { ...e });
    });
    bus.on('room.enter', (e) => {
      this.roomIdx = e.room_idx;
      this.encIdx = 0;
      this.log('room.enter', { ...e });
    });
    bus.on('encounter.start', (e) => {
      this.encIdx = e.enc_idx;
      this.log('encounter.start', { ...e });
    });
    bus.on('encounter.end', (e) => this.log('encounter.end', { ...e }));
    bus.on('profile.snapshot', (e) => this.log('profile.snapshot', { partial: e.partial, ...e.snapshot }));
    bus.on('run.end', (e) => {
      this.log('run.end', { ...e });
      this.opts.onRunEnd?.();
    });
  }

  /** Call once per fixed step, before the simulation step. */
  beginTick(stepMs: number): void {
    this.tMs += stepMs;
    this.sinceSampleMs += stepMs;
    if (this.sinceSampleMs >= POS_SAMPLE_INTERVAL_MS) {
      this.sinceSampleMs -= POS_SAMPLE_INTERVAL_MS;
      this.samplePositions();
    }
  }

  log(type: string, payload: Record<string, unknown>): void {
    // Envelope last so a payload field can never overwrite it.
    this.buffer.push({
      ...payload,
      v: SCHEMA_VERSION,
      seq: this.seq++,
      t_ms: r1(this.tMs),
      player_id: this.opts.playerId,
      session_id: this.opts.sessionId,
      run_idx: this.runIdx,
      room_idx: this.roomIdx,
      enc_idx: this.encIdx,
      type,
    });
  }

  drain(): LoggedEvent[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }

  private logWithCtx(type: string, payload: unknown): void {
    const fields: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
    // opp.* payloads carry their own `type` ('dodge' | 'punish'); keep it
    // without clobbering the envelope's event type.
    if ('type' in fields) {
      fields.opp_type = fields.type;
      delete fields.type;
    }
    fields.ctx = buildCtx(this.encounter!, this.lastActionT === null ? null : this.tMs - this.lastActionT);
    this.log(type, fields);
    if (type === 'player.action') this.lastActionT = this.tMs;
  }

  private samplePositions(): void {
    if (!this.encounter) return;
    const p = this.encounter.player;
    const e = this.encounter.assaltante;
    this.log('pos.sample', {
      p: [r1(p.position.x), r1(p.position.y)],
      e: [r1(e.position.x), r1(e.position.y)],
      p_state: p.state,
      e_state: e.state,
    });
  }
}
