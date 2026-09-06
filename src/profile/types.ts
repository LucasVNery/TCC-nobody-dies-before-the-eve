// src/profile/types.ts
export type SkillId = string;
export type Clock = 'trait' | 'state';
export type ProfileOutcome = 'taken' | 'missed' | 'expired';

export interface ProfileSnapshotPayload {
  at: 'room.exit' | 'boss.entry' | 'transfer.entry';
  /** tuple order: [aproveitadas (numerator), oportunidades (denominator)] — decayed counts, relógio traço only */
  counts: Record<SkillId, [number, number]>;
  domain: Record<SkillId, number | null>;
  confidence: Record<SkillId, number>;
  target: SkillId | null; // sempre null neste sub-projeto — seleção de alvo é passo 6 do §8
  lambda: number;         // sempre 0 neste sub-projeto — pesos de regra são passo 7 do §8
}
