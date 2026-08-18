import type { SkillId, Clock, ProfileSnapshotPayload } from './types';

const TRAIT_GAMMA = 0.87;
const STATE_GAMMA = 0.55;
const BETA_ALPHA = 1;
const BETA_BETA = 1;
const CONFIDENCE_KAPPA = 10;

interface SkillCounts {
  aproveitadas: number;
  oportunidades: number;
}

function emptyCounts(): SkillCounts {
  return { aproveitadas: 0, oportunidades: 0 };
}

export class ProfileAccumulator {
  private traitTotals = new Map<SkillId, SkillCounts>();
  private stateTotals = new Map<SkillId, SkillCounts>();
  private traitPending = new Map<SkillId, SkillCounts>();
  private statePending = new Map<SkillId, SkillCounts>();

  recordOutcome(skill: SkillId, taken: boolean): void {
    this.addToPending(this.traitPending, skill, taken);
    this.addToPending(this.statePending, skill, taken);
  }

  applyRoomBoundary(): void {
    this.decayAndFold(this.traitTotals, this.traitPending, TRAIT_GAMMA);
  }

  applyEncounterBoundary(): void {
    this.decayAndFold(this.stateTotals, this.statePending, STATE_GAMMA);
  }

  resetSession(): void {
    this.traitTotals.clear();
    this.stateTotals.clear();
    this.traitPending.clear();
    this.statePending.clear();
  }

  domain(skill: SkillId, clock: Clock): number {
    const c = this.totalsFor(clock).get(skill) ?? emptyCounts();
    return (c.aproveitadas + BETA_ALPHA) / (c.oportunidades + BETA_ALPHA + BETA_BETA);
  }

  confidence(skill: SkillId, clock: Clock): number {
    const c = this.totalsFor(clock).get(skill) ?? emptyCounts();
    return c.oportunidades / (c.oportunidades + CONFIDENCE_KAPPA);
  }

  deficit(skill: SkillId, clock: Clock): number {
    return 1 - this.domain(skill, clock);
  }

  snapshot(at: ProfileSnapshotPayload['at']): ProfileSnapshotPayload {
    const counts: Record<SkillId, [number, number]> = {};
    const domain: Record<SkillId, number> = {};
    const confidence: Record<SkillId, number> = {};
    for (const [skill, c] of this.traitTotals) {
      counts[skill] = [c.aproveitadas, c.oportunidades];
      domain[skill] = this.domain(skill, 'trait');
      confidence[skill] = this.confidence(skill, 'trait');
    }
    return { at, counts, domain, confidence, target: null, lambda: 0 };
  }

  private totalsFor(clock: Clock): Map<SkillId, SkillCounts> {
    return clock === 'trait' ? this.traitTotals : this.stateTotals;
  }

  private addToPending(pending: Map<SkillId, SkillCounts>, skill: SkillId, taken: boolean): void {
    const c = pending.get(skill) ?? emptyCounts();
    c.oportunidades += 1;
    if (taken) c.aproveitadas += 1;
    pending.set(skill, c);
  }

  private decayAndFold(
    totals: Map<SkillId, SkillCounts>,
    pending: Map<SkillId, SkillCounts>,
    gamma: number,
  ): void {
    const skills = new Set([...totals.keys(), ...pending.keys()]);
    for (const skill of skills) {
      const total = totals.get(skill) ?? emptyCounts();
      const p = pending.get(skill) ?? emptyCounts();
      totals.set(skill, {
        aproveitadas: gamma * total.aproveitadas + p.aproveitadas,
        oportunidades: gamma * total.oportunidades + p.oportunidades,
      });
    }
    pending.clear();
  }
}
