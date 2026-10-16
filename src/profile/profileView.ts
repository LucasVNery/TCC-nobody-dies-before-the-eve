// src/profile/profileView.ts
import type { SkillId, Clock } from './types';

/** The six dimensions the analysis HUD reads, in display order. */
export const PROFILE_SKILLS: readonly SkillId[] = [
  'weapon_repertoire', 'action_repertoire', 'punish', 'defensive_repertoire', 'distance', 'patience',
];

/** Read-only view of the player profile (no recording, no boundaries). */
export interface ProfileView {
  domain(skill: SkillId, clock: Clock): number | null;
  confidence(skill: SkillId, clock: Clock): number;
  deficit(skill: SkillId, clock: Clock): number | null;
  omission(skill: SkillId, clock: Clock): number | null;
  /** Folded evidence behind the estimate: ratio denominator, or total count for entropy skills. */
  sampleSize(skill: SkillId, clock: Clock): number;
}
