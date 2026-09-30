// src/profile/profileSink.ts
import type { ActionType } from '../combat/actionRegistry';
import type { DefensiveLabel } from './profileAccumulator';
import type { SkillId, ProfileOutcome } from './types';

/**
 * The profile's write side. `ProfileAccumulator` implements it directly;
 * `RecordingProfile` (src/telemetry/) implements it by logging each call as an
 * `obs.*` event before forwarding. Code that only *feeds* the profile
 * (`Encounter`, `RunDirector`) depends on this interface, never on the
 * accumulator's read side.
 */
export interface ProfileSink {
  record(skill: SkillId, numerator: number, denominator: number): void;
  recordOutcome(skill: SkillId, outcome: ProfileOutcome): void;
  recordAction(actionType: ActionType, weaponId?: string): void;
  recordDefense(label: DefensiveLabel): void;
  applyEncounterBoundary(): void;
  applyRoomBoundary(): void;
  resetSession(): void;
}
