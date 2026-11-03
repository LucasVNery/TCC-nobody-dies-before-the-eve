/** Tint of the boss body when no attack telegraph is showing (dark red). */
export const BOSS_BASE_TINT = 0xc04040;

export const SWING_TINT = 0xff9800;
export const LUNGE_TELEGRAPH_TINT = 0x00bcd4;
export const LUNGE_CHARGE_TINT = 0xf44336;
const NEUTRAL_TINT = 0xffffff;

/** Tint for the enemy sprite: attack telegraphs win over the boss base colour. */
export function enemyTint(s: { lunge: 'telegraph' | 'charge' | null; attacking: boolean; boss: boolean }): number {
  if (s.lunge === 'telegraph') return LUNGE_TELEGRAPH_TINT;
  if (s.lunge === 'charge') return LUNGE_CHARGE_TINT;
  if (s.attacking) return SWING_TINT;
  return s.boss ? BOSS_BASE_TINT : NEUTRAL_TINT;
}
