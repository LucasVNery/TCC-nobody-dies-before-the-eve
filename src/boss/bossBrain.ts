// Detects passive-defense windows and decides when to fire a capped barrage.
import type { Prng } from '../core/prng';
import { BOSS_CONFIG, type BossConfig } from './bossConfig';
import { barrageParams } from './responses';

export interface BrainView {
  playerBlocking: boolean;
  /** Measured player speed, px/s. */
  playerSpeed: number;
  distance: number;
  /** Boss is idle/chasing with no barrage in progress. */
  bossFree: boolean;
}

export interface BarrageInfo {
  chance: number;
  durationMult: number;
  level: number;
}

export interface BossBrainOptions {
  barrageLevel: number;
  prng: Prng;
  config?: BossConfig;
  onBarrage: (strikes: number, info: BarrageInfo) => void;
}

export class BossBrain {
  private readonly level: number;
  private readonly prng: Prng;
  private readonly cfg: BossConfig;
  private readonly onBarrage: BossBrainOptions['onBarrage'];
  private elapsedMs = 0;
  private passiveMs = 0;
  // Passive time reached the window; decided on the first tick the boss is free.
  private pending = false;
  // Window already decided; re-armed only once the player-side condition breaks.
  private consumed = false;
  private lastBarrageAtMs: number | null = null;
  private windows = 0;
  private fired = 0;

  constructor(opts: BossBrainOptions) {
    this.level = opts.barrageLevel;
    this.prng = opts.prng;
    this.cfg = opts.config ?? BOSS_CONFIG;
    this.onBarrage = opts.onBarrage;
  }

  get windowsSeen(): number {
    return this.windows;
  }

  get barragesFired(): number {
    return this.fired;
  }

  /**
   * Passive time accumulates from the PLAYER-side condition only (blocking,
   * still, near), whatever the boss is doing: the boss attacking does not
   * reset or pause it. Once it reaches passiveWindowMs the window is pending
   * and is decided on the first tick the boss is free. A player-side break
   * clears the time, a pending window and the consumed flag.
   */
  step(stepMs: number, view: BrainView): void {
    this.elapsedMs += stepMs;
    const cfg = this.cfg;
    const passive =
      view.playerBlocking &&
      view.playerSpeed <= cfg.passiveMaxSpeed &&
      view.distance <= cfg.passiveMaxDistance;
    if (!passive) {
      this.passiveMs = 0;
      this.pending = false;
      this.consumed = false;
      return;
    }
    if (this.consumed) return;
    if (!this.pending) {
      this.passiveMs += stepMs;
      if (this.passiveMs < cfg.passiveWindowMs) return;
      this.pending = true;
    }
    if (!view.bossFree) return;

    this.pending = false;
    this.passiveMs = 0;
    this.consumed = true;
    this.windows += 1;
    // Level 0 never draws, so it leaves the PRNG stream untouched.
    if (this.level <= 0) return;
    const cooled =
      this.lastBarrageAtMs === null || this.elapsedMs - this.lastBarrageAtMs >= cfg.barrageCooldownMs;
    if (!cooled) return;
    const { chance, durationMult } = barrageParams(this.level, cfg);
    if (this.prng.next() >= chance) return;
    this.fired += 1;
    this.lastBarrageAtMs = this.elapsedMs;
    // Floor keeps the strikes within base x barrageDurationMaxMult (round gave 5 = 1.67x at level 1).
    const strikes = Math.max(1, Math.floor(cfg.barrageBaseStrikes * durationMult));
    this.onBarrage(strikes, { chance, durationMult, level: this.level });
  }
}
