// Builds synthetic LoggedEvent logs for boss tests (one session, one player at a time).

import { GAME_VERSION } from '../../telemetry/schema';
import type { LoggedEvent } from '../../telemetry/schema';
import { DODGE } from '../../combat/actionDefs';

export class LogBuilder {
  readonly events: LoggedEvent[] = [];
  private seq = 0;
  private run = 0;

  constructor(
    readonly playerId = 'p1',
    readonly sessionId = 's1',
    private readonly gameVersion: string = GAME_VERSION,
    private readonly dodgeCooldown: number = DODGE.cooldownMs,
  ) {}

  private push(type: string, t: number, payload: Record<string, unknown> = {}): this {
    this.events.push({
      v: 2, seq: this.seq++, t_ms: t, player_id: this.playerId, session_id: this.sessionId,
      run_idx: this.run, room_idx: 0, enc_idx: 0, type, ...payload,
    });
    return this;
  }

  sessionStart(): this {
    return this.push('session.start', 0, {
      game_version: this.gameVersion,
      windows_ms: { dodge_cooldown: this.dodgeCooldown },
    });
  }
  runStart(runIdx: number, t = 0): this { this.run = runIdx; return this.push('run.start', t); }
  runEnd(t = 0, cause: 'death' | 'abandoned' | 'victory' = 'death'): this { return this.push('run.end', t, { cause }); }
  distance(num: number, den: number, t = 0): this { return this.push('obs.record', t, { skill: 'distance', num, den }); }
  record(skill: string, num: number, den: number, t = 0): this { return this.push('obs.record', t, { skill, num, den }); }
  defense(label: string, t = 0): this { return this.push('obs.defense', t, { label }); }
  dodge(t: number, eState = 'idle'): this {
    return this.push('player.dodge', t, { ctx: { e_state: eState } });
  }
  bossEntry(t = 0): this { return this.push('profile.snapshot', t, { partial: false, at: 'boss.entry' }); }
}
