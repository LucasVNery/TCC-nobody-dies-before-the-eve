export type SkillId = string;
export type Clock = 'trait' | 'state';

export interface ProfileSnapshotPayload {
  at: 'room.exit' | 'boss.entry' | 'transfer.entry';
  counts: Record<SkillId, [number, number]>; // [aproveitadas, oportunidades], relógio traço
  domain: Record<SkillId, number>;
  confidence: Record<SkillId, number>;
  target: SkillId | null;
  lambda: number;
}
