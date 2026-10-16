// src/scenes/session/sessionController.ts
import { createTelemetryStack, type TelemetryStack } from '../../telemetry/stack';
import { MemoryEventStore, type EventStore } from '../../telemetry/eventStore';
import { loadProfileState, type BootState } from '../../telemetry/bootstrap';
import { ProfileAccumulator } from '../../profile/profileAccumulator';
import { toNdjson, importInto } from '../../telemetry/ndjson';
import { SCHEMA_VERSION, GAME_VERSION, type LoggedEvent } from '../../telemetry/schema';
import type { Platform } from './platform';

export interface SessionStatus {
  gameVersion: string;
  schemaV: number;
  playerId: string;
  sessionId: string;
  runIdx: number;
  roomIdx: number;
  encIdx: number;
  nextSeq: number;
  buffered: number;
  store: 'indexeddb' | 'memory';
  persistent: boolean;
  /** Counts failure episodes (a streak of failed writes counts once), not individual failed writes. */
  writeFailures: number;
}

export interface SessionControllerOptions {
  platform: Platform;
  entitySize: number;
  nextSeed: () => number;
}

export interface StartOptions {
  /** Settles once the previous controller's last writes are in and its store is closed. */
  after?: Promise<void>;
  /** Runs right after the stack is built and BEFORE session.start is logged, so subscribers see the first events. */
  onStackReady?: (stack: TelemetryStack, history: readonly LoggedEvent[]) => void;
}

/** Boot, batched persistence, export/import and shutdown of the telemetry session (no Phaser, no DOM). */
export class SessionController {
  private _stack: TelemetryStack | null = null;
  private store: EventStore = new MemoryEventStore();
  private storeKind: 'indexeddb' | 'memory' = 'memory';
  private _ready = false;
  private persistWarned = false;
  private lastWriteFailed = false;
  private writeFailures = 0;
  private playerId = '';
  private sessionId = '';
  private persistent = false;
  /** Store writes, serialized; the store is closed only after they settle. */
  private writes: Promise<void> = Promise.resolve();
  private unsubscribeHide: (() => void) | null = null;

  constructor(private readonly opts: SessionControllerOptions) {}

  get ready(): boolean {
    return this._ready;
  }

  get stack(): TelemetryStack {
    if (!this._stack) throw new Error('SessionController not started');
    return this._stack;
  }

  /** Never rejects: on any failure the game still starts on an in-memory profile when it can. */
  async start(opts: StartOptions = {}): Promise<void> {
    try {
      await opts.after; // after a restart: the previous session's last events are stored
    } catch {
      // a failed predecessor must not block this session
    }
    const { platform } = this.opts;
    try {
      try {
        const opened = await platform.openStore();
        this.store = opened.store;
        this.storeKind = opened.persistent ? 'indexeddb' : 'memory';
      } catch (err) {
        console.warn('[telemetry] IndexedDB unavailable, history will not survive a reload', err);
        this.store = new MemoryEventStore();
        this.storeKind = 'memory';
      }
      const boot = await loadProfileState(this.store, platform.newUuid);
      this.startGame(boot, opts);
    } catch (err) {
      // The game must still start: fresh in-memory profile, nothing persisted.
      console.error('[telemetry] boot failed, starting on a fresh in-memory profile', err);
      try {
        this.store.close();
        this.store = new MemoryEventStore();
        this.storeKind = 'memory';
        this.startGame(
          {
            accumulator: new ProfileAccumulator(),
            playerId: platform.newUuid(),
            firstRunIdx: 0,
            restored: false,
            abandonedRun: null,
            history: [],
          },
          opts,
        );
      } catch (fatal) {
        console.error('[telemetry] could not start the game', fatal);
      }
    }
  }

  private startGame(boot: BootState, opts: StartOptions): void {
    const { platform } = this.opts;
    this.playerId = boot.playerId;
    this.sessionId = platform.newUuid();
    this.persistent = this.storeKind === 'indexeddb' && boot.restored;
    this._stack = createTelemetryStack({
      accumulator: boot.accumulator,
      playerId: boot.playerId,
      sessionId: this.sessionId,
      firstRunIdx: boot.firstRunIdx,
      nextSeed: this.opts.nextSeed,
      entitySize: this.opts.entitySize,
      onRunEnd: () => void this.persist(),
    });
    opts.onStackReady?.(this._stack, boot.history);

    // session.start, then the run the previous session left open (tab closed)
    // is closed under its own indices, then the first run of this session.
    this._stack.startSession(
      {
        wall_clock_iso: platform.nowIso(),
        game_version: GAME_VERSION,
        schema_v: SCHEMA_VERSION,
        persistent: this.persistent,
      },
      boot.abandonedRun,
    );

    this.unsubscribeHide?.();
    this.unsubscribeHide = platform.onHide(() => this.flushAndPersist());
    this._ready = true;
  }

  /**
   * Drains the recorder into the store. Writes are chained, so `writes`
   * tells when all of them settled; the returned promise never rejects. A
   * failed batch goes back to the front of the recorder buffer and is retried
   * by the next persist.
   */
  persist(): Promise<void> {
    if (!this._stack) return this.writes;
    const recorder = this._stack.recorder;
    const store = this.store;
    const batch = recorder.drain();
    if (batch.length === 0) return this.writes;
    this.writes = this.writes.then(async () => {
      try {
        await store.append(batch);
        this.lastWriteFailed = false;
      } catch (err) {
        recorder.requeue(batch);
        // Counts failure episodes: consecutive failures are one outage.
        if (!this.lastWriteFailed) this.writeFailures += 1;
        this.lastWriteFailed = true;
        if (!this.persistWarned) {
          console.warn('[telemetry] failed to persist events; continuing in memory', err);
          this.persistWarned = true;
        }
      }
    });
    return this.writes;
  }

  flushAndPersist(): void {
    if (!this._ready) return;
    this.stack.recording.flushPending();
    void this.persist();
  }

  resetProfile(): void {
    if (this._ready) this.stack.recording.resetSession();
  }

  async exportHistory(): Promise<void> {
    if (!this._ready) return;
    try {
      this.stack.recording.flushPending();
      await this.persist();
      const events = await this.store.readAll();
      const playerId = String(events[events.length - 1]?.player_id ?? 'sem-id').slice(0, 8);
      const date = this.opts.platform.nowIso().slice(0, 10);
      this.opts.platform.downloadText(`tcc-historico-${playerId}-${date}.ndjson`, toNdjson(events));
    } catch (err) {
      console.warn('[telemetry] export failed', err);
    }
  }

  /** 'restart' when a file was merged (the caller restarts the scene); 'kept' otherwise. */
  async importHistory(): Promise<'restart' | 'kept'> {
    if (!this._ready) return 'kept';
    let text: string | null;
    try {
      text = await this.opts.platform.pickFile();
    } catch (err) {
      console.warn('[telemetry] import failed', err);
      return 'kept';
    }
    if (text === null || !this._ready) return 'kept';
    // Stop the simulation (and with it every new event) before the awaits,
    // so nothing is produced between the last persist and the restart.
    this._ready = false;
    let merged = false;
    try {
      this.stack.recording.flushPending();
      await this.persist();
      const result = await importInto(this.store, text);
      merged = true;
      if (result.invalidLines > 0) {
        console.warn(`[telemetry] import skipped ${result.invalidLines} invalid line(s)`);
      }
      if (result.foreignPlayerIds.length > 0) {
        console.warn(
          `[telemetry] import brought events of other player(s) (${result.foreignPlayerIds.join(', ')}); ` +
            `adopted player ${result.playerId} — only that player's events are replayed`,
        );
      }
      this.stack.recording.flushPending();
      await this.persist();
    } catch (err) {
      console.warn('[telemetry] import failed', err);
    }
    if (merged) return 'restart'; // new session: profile rebuilt from the merged history
    this._ready = true; // nothing was merged: keep playing this session
    return 'kept';
  }

  /** Final flush, then closes the store only after every in-flight append settled. */
  shutdown(): Promise<void> {
    this.unsubscribeHide?.();
    this.unsubscribeHide = null;
    const wasRunning = this._ready;
    this._ready = false;
    if (wasRunning) this.stack.recording.flushPending();
    const store = this.store;
    return this.persist().finally(() => store.close());
  }

  status(): SessionStatus {
    const s = this._stack;
    return {
      gameVersion: GAME_VERSION,
      schemaV: SCHEMA_VERSION,
      playerId: this.playerId,
      sessionId: this.sessionId,
      runIdx: s?.director.runIdx ?? 0,
      roomIdx: s?.director.roomIdx ?? 0,
      encIdx: s?.director.encIdx ?? 0,
      nextSeq: s?.recorder.nextSeq ?? 0,
      buffered: s?.recorder.bufferedCount ?? 0,
      store: this.storeKind,
      persistent: this.persistent,
      writeFailures: this.writeFailures,
    };
  }
}
