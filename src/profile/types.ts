// src/profile/types.ts
export type SkillId = string;
export type Clock = 'trait' | 'state';
export type ProfileOutcome = 'taken' | 'missed' | 'expired';

export interface ProfileSnapshotPayload {
  at: 'room.exit' | 'boss.entry' | 'transfer.entry';
  /** Família A: [aproveitadas (numerator), oportunidades (denominator)] — decayed counts, relógio traço only.
   *  Família B (entropy dims): [nº de rótulos distintos usados, total count] — informativo, ver spec §6. */
  counts: Record<SkillId, [number, number]>;
  domain: Record<SkillId, number | null>;
  confidence: Record<SkillId, number>;
  target: SkillId | null; // sempre null neste sub-projeto — seleção de alvo é passo 6 do §8
  lambda: number;         // sempre 0 neste sub-projeto — pesos de regra são passo 7 do §8
  /** boss.entry only: frozen habit levels (0..1) the boss fight uses. */
  levels?: Record<string, number>;
  /** boss.entry only: response totals applied to the fight. */
  applied?: { dash_cooldown_ms: number; advance_mult: number };
  /** boss.entry only: the boss room was entered by the playtest shortcut (F4), not by clearing the encounters. */
  debug_jump?: true;
}
