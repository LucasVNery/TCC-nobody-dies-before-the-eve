// Incremental fold of the NDJSON event log into per-run habit tallies. Pure: no Phaser, no I/O.

import { DODGE } from '../combat/actionDefs';
import type { LoggedEvent } from '../telemetry/schema';
import { BOSS_CONFIG } from './bossConfig';
import type { BossConfig } from './bossConfig';

export interface RunTally {
  runIdx: number;
  nearNum: number;
  nearDen: number;
  dodge: number;
  block: number;
  parry: number;
  retreat: number;
  reflexDashes: number;
  closed: boolean;
}

type DefenseLabel = 'dodge' | 'block' | 'parry' | 'retreat';
const DEFENSE_LABELS: ReadonlySet<string> = new Set<DefenseLabel>(['dodge', 'block', 'parry', 'retreat']);
/** Enemy states with no active threat: a dash here is not a reaction to an attack. */
const CALM_STATES: ReadonlySet<string> = new Set(['idle', 'chasing', 'recovering']);

interface RunState {
  tally: RunTally;
  inBoss: boolean;
  lastDashStartMs: number | null;
}

export class HabitEvidence {
  private readonly playerId: string;
  private readonly gameVersion: string;
  private readonly config: BossConfig;
  private readonly sessions = new Map<string, { accepted: boolean; dodgeCooldown: number }>();
  private readonly byRun = new Map<number, RunState>();
  private faced = false;

  constructor(opts: { playerId: string; gameVersion: string; config?: BossConfig }) {
    this.playerId = opts.playerId;
    this.gameVersion = opts.gameVersion;
    this.config = opts.config ?? BOSS_CONFIG;
  }

  get facedBoss(): boolean {
    return this.faced;
  }

  /** Tallies per run, ascending by runIdx (copies). Includes the run in progress and the boss run. */
  runs(): readonly RunTally[] {
    return [...this.byRun.values()].map((r) => ({ ...r.tally })).sort((a, b) => a.runIdx - b.runIdx);
  }

  applyAll(events: readonly LoggedEvent[]): void {
    for (const e of events) this.apply(e);
  }

  apply(e: LoggedEvent): void {
    if (e.player_id !== this.playerId) return;
    if (e.type === 'session.start') {
      const w = e.windows_ms as { dodge_cooldown?: unknown } | undefined;
      const cd = typeof w?.dodge_cooldown === 'number' ? w.dodge_cooldown : DODGE.cooldownMs;
      this.sessions.set(e.session_id, { accepted: e.game_version === this.gameVersion, dodgeCooldown: cd });
      return;
    }
    const session = this.sessions.get(e.session_id);
    if (!session?.accepted) return;

    switch (e.type) {
      case 'run.start':
        this.runOf(e.run_idx);
        for (const r of this.byRun.values()) if (r.tally.runIdx < e.run_idx) r.tally.closed = true;
        return;
      case 'run.end':
        this.runOf(e.run_idx).tally.closed = true;
        return;
      case 'profile.snapshot':
        if (e.at === 'boss.entry') {
          this.faced = true;
          this.runOf(e.run_idx).inBoss = true;
        }
        return;
      case 'obs.record': {
        const run = this.runOf(e.run_idx);
        if (run.inBoss || e.skill !== 'distance') return;
        run.tally.nearNum += Number(e.num);
        run.tally.nearDen += Number(e.den);
        return;
      }
      case 'obs.defense': {
        const run = this.runOf(e.run_idx);
        const label = e.label;
        if (run.inBoss || typeof label !== 'string' || !DEFENSE_LABELS.has(label)) return;
        run.tally[label as DefenseLabel] += 1;
        return;
      }
      case 'player.dodge':
        this.applyDash(e, session.dodgeCooldown);
        return;
    }
  }

  private applyDash(e: LoggedEvent, cooldownMs: number): void {
    const run = this.runOf(e.run_idx);
    if (run.inBoss) return;
    if (run.lastDashStartMs !== null) {
      const gap = e.t_ms - (run.lastDashStartMs + DODGE.durationMs + cooldownMs);
      const eState = (e.ctx as { e_state?: unknown } | undefined)?.e_state;
      if (typeof eState === 'string' && CALM_STATES.has(eState) && gap >= 0 && gap <= this.config.reflexToleranceMs) {
        run.tally.reflexDashes += 1;
      }
    }
    run.lastDashStartMs = e.t_ms;
  }

  private runOf(runIdx: number): RunState {
    let r = this.byRun.get(runIdx);
    if (!r) {
      r = {
        tally: { runIdx, nearNum: 0, nearDen: 0, dodge: 0, block: 0, parry: 0, retreat: 0, reflexDashes: 0, closed: false },
        inBoss: false,
        lastDashStartMs: null,
      };
      this.byRun.set(runIdx, r);
    }
    return r;
  }
}
