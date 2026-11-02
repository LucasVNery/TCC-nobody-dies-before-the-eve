// Response curves: habit level (0..1) -> boss behavior parameters.
import { DODGE } from '../combat/actionDefs';
import { BOSS_CONFIG, type BossConfig } from './bossConfig';

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Barrage chance rises until barrageFrequencyUntil; after that its duration grows. */
export function barrageParams(
  level: number,
  cfg: BossConfig = BOSS_CONFIG,
): { chance: number; durationMult: number } {
  const l = clamp01(level);
  const split = cfg.barrageFrequencyUntil;
  const chance = cfg.barrageMaxFraction * (Math.min(l, split) / split);
  const durationMult =
    l <= split ? 1 : 1 + (cfg.barrageDurationMaxMult - 1) * ((l - split) / (1 - split));
  return { chance, durationMult };
}

export function advanceMult(level: number, cfg: BossConfig = BOSS_CONFIG): number {
  return 1 + (cfg.advanceMaxMult - 1) * clamp01(level);
}

export function dashCooldownMs(level: number, cfg: BossConfig = BOSS_CONFIG): number {
  return DODGE.cooldownMs + (cfg.dashCooldownMaxMs - DODGE.cooldownMs) * clamp01(level);
}
