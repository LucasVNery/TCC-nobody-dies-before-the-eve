import type { ProfileSink } from '../profile/profileSink';
import type { DefensiveLabel } from '../profile/profileAccumulator';
import type { SkillId, ProfileOutcome } from '../profile/types';
import type { ActionType } from '../combat/actionRegistry';
import type { LogFn } from './schema';

export const RECORD_FLUSH_INTERVAL_MS = 250;

interface Pending {
  num: number;
  den: number;
  sinceMs: number;
}

/**
 * Logs every profile write as an `obs.*` event (layer A of the log, the source
 * of truth for rebuilding the profile — spec §4.2) and forwards it to `inner`.
 *
 * `record()` is aggregated per skill (dim 5 calls it every tick): the sum is
 * logged AND forwarded together, when RECORD_FLUSH_INTERVAL_MS of sim time
 * have passed or before any boundary/reset. Pending evidence is unobservable
 * (DecayedRatio only exposes folded counts), so deferring the forward changes
 * no read — and it makes the live accumulator and a replay perform exactly the
 * same floating-point additions, so the rebuilt profile is bit-identical.
 * Constraint: a skill fed by record() must not also be fed by recordOutcome().
 */
export class RecordingProfile implements ProfileSink {
  private pending = new Map<SkillId, Pending>();

  constructor(
    private readonly inner: ProfileSink,
    private readonly log: LogFn,
    private readonly now: () => number,
  ) {}

  record(skill: SkillId, numerator: number, denominator: number): void {
    let p = this.pending.get(skill);
    if (!p) {
      p = { num: 0, den: 0, sinceMs: this.now() };
      this.pending.set(skill, p);
    }
    p.num += numerator;
    p.den += denominator;
    if (this.now() - p.sinceMs >= RECORD_FLUSH_INTERVAL_MS) this.flushSkill(skill);
  }

  recordOutcome(skill: SkillId, outcome: ProfileOutcome): void {
    this.log('obs.outcome', { skill, outcome });
    this.inner.recordOutcome(skill, outcome);
  }

  recordAction(actionType: ActionType, weaponId?: string): void {
    this.log('obs.action', weaponId === undefined ? { actionType } : { actionType, weaponId });
    this.inner.recordAction(actionType, weaponId);
  }

  recordDefense(label: DefensiveLabel): void {
    this.log('obs.defense', { label });
    this.inner.recordDefense(label);
  }

  applyEncounterBoundary(): void {
    this.flushPending();
    this.log('obs.boundary', { kind: 'encounter' });
    this.inner.applyEncounterBoundary();
  }

  applyRoomBoundary(): void {
    this.flushPending();
    this.log('obs.boundary', { kind: 'room' });
    this.inner.applyRoomBoundary();
  }

  resetSession(): void {
    this.flushPending();
    this.log('obs.reset', {});
    this.inner.resetSession();
  }

  /** Flush every aggregated record() now (boundaries, reset, tab hide). */
  flushPending(): void {
    for (const skill of [...this.pending.keys()]) this.flushSkill(skill);
  }

  private flushSkill(skill: SkillId): void {
    const p = this.pending.get(skill);
    if (!p) return;
    this.pending.delete(skill);
    this.log('obs.record', { skill, num: p.num, den: p.den });
    this.inner.record(skill, p.num, p.den);
  }
}
