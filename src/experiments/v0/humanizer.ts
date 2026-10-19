import type { Vec2 } from '../../combat/types';

export interface HumanizerConfig {
  reactionMeanMs: number;
  reactionSdMs: number;
  lapseProb: number;
  aimNoiseRad: number;
}

export const DEFAULT_HUMANIZER: HumanizerConfig = {
  reactionMeanMs: 250,
  reactionSdMs: 60,
  lapseProb: 0.05,
  aimNoiseRad: 0.05,
};

export const MIN_REACTION_MS = 80;

/**
 * Human-like imperfection shared by every synthetic style: reaction delay,
 * lapses and aim noise. All randomness comes from the injected `rng`.
 */
export class Humanizer {
  private readonly mu: number;
  private readonly sigma: number;

  constructor(
    private readonly cfg: HumanizerConfig,
    private readonly rng: () => number,
  ) {
    // Log-normal with mean m and sd s: sigma^2 = ln(1 + s^2/m^2), mu = ln(m) - sigma^2/2.
    const m = cfg.reactionMeanMs;
    const s = cfg.reactionSdMs;
    const sigma2 = Math.log(1 + (s * s) / (m * m));
    this.sigma = Math.sqrt(sigma2);
    this.mu = Math.log(m) - sigma2 / 2;
  }

  /** Standard normal draw (Box-Muller); u1 = 0 is redrawn to avoid log(0). */
  private normal(): number {
    let u1 = this.rng();
    while (u1 <= 0) u1 = this.rng();
    const u2 = this.rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Reaction delay in ms. Clamped below at MIN_REACTION_MS, which slightly
   * biases the mean upward (negligible for the default 250/60: the floor
   * sits almost 3 sd below the mean).
   */
  sampleReactionMs(): number {
    return Math.max(MIN_REACTION_MS, Math.exp(this.mu + this.sigma * this.normal()));
  }

  /** lapseProb 1 always lapses because it relies on rng() < 1 (true for the project PRNG). */
  lapses(): boolean {
    return this.rng() < this.cfg.lapseProb;
  }

  /** Rotates `dir` by a normal angle (sd aimNoiseRad); length preserved, zero stays zero. */
  noisyAim(dir: Vec2): Vec2 {
    if (dir.x === 0 && dir.y === 0) return { x: 0, y: 0 };
    const a = this.normal() * this.cfg.aimNoiseRad;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: dir.x * c - dir.y * s, y: dir.x * s + dir.y * c };
  }
}
