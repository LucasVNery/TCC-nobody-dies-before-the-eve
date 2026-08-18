// src/profile/profileAccumulator.ts
import type { SkillId, Clock, ProfileSnapshotPayload, ProfileOutcome } from './types';
import { DecayedRatio } from './decayedRatio';

const TRAIT_GAMMA = 0.87;
const STATE_GAMMA = 0.55;
const BETA_ALPHA = 1;
const BETA_BETA = 1;
const DEFAULT_CONFIDENCE_KAPPA = 10;

interface SkillRatios {
  domain: DecayedRatio;
  omission: DecayedRatio;
  folded: boolean;
}

function makeSkillRatios(): SkillRatios {
  return { domain: new DecayedRatio(), omission: new DecayedRatio(), folded: false };
}

export class ProfileAccumulator {
  private trait = new Map<SkillId, SkillRatios>();
  private state = new Map<SkillId, SkillRatios>();

  constructor(private confidenceKappa: number = DEFAULT_CONFIDENCE_KAPPA) {}

  record(skill: SkillId, numerator: number, denominator: number): void {
    this.ratiosFor(this.trait, skill).domain.add(numerator, denominator);
    this.ratiosFor(this.state, skill).domain.add(numerator, denominator);
  }

  recordOutcome(skill: SkillId, outcome: ProfileOutcome): void {
    this.record(skill, outcome === 'taken' ? 1 : 0, 1);

    if (outcome === 'missed' || outcome === 'expired') {
      const omissionNumerator = outcome === 'expired' ? 1 : 0;
      this.ratiosFor(this.trait, skill).omission.add(omissionNumerator, 1);
      this.ratiosFor(this.state, skill).omission.add(omissionNumerator, 1);
    }
  }

  applyRoomBoundary(): void {
    this.decayClock(this.trait, TRAIT_GAMMA);
  }

  applyEncounterBoundary(): void {
    this.decayClock(this.state, STATE_GAMMA);
  }

  resetSession(): void {
    this.trait.clear();
    this.state.clear();
  }

  domain(skill: SkillId, clock: Clock): number {
    const r = this.clockFor(clock).get(skill);
    const num = r?.domain.num ?? 0;
    const den = r?.domain.den ?? 0;
    return (num + BETA_ALPHA) / (den + BETA_ALPHA + BETA_BETA);
  }

  confidence(skill: SkillId, clock: Clock): number {
    const den = this.clockFor(clock).get(skill)?.domain.den ?? 0;
    return den / (den + this.confidenceKappa);
  }

  deficit(skill: SkillId, clock: Clock): number {
    return 1 - this.domain(skill, clock);
  }

  /**
   * Fração das oportunidades "não aproveitadas" que expiraram sem tentativa,
   * em vez de terem sido tentadas e erradas (§2.4 do doc de perfil). `null`
   * quando nenhum `missed`/`expired` foi registrado ainda para essa skill
   * nesse relógio — não confundir com `0`.
   */
  omission(skill: SkillId, clock: Clock): number | null {
    const r = this.clockFor(clock).get(skill)?.omission;
    if (!r || r.den === 0) return null;
    return r.num / r.den;
  }

  /**
   * Empacota o relógio traço no formato do §7. Só inclui skills que já
   * passaram por pelo menos uma `applyRoomBoundary()` — evidência ainda
   * pendente (registrada via `record()`/`recordOutcome()` mas não decaída)
   * não aparece aqui. Para incluir a sala que acabou de terminar, chame
   * `applyRoomBoundary()` imediatamente antes de `snapshot('room.exit')`.
   */
  snapshot(at: ProfileSnapshotPayload['at']): ProfileSnapshotPayload {
    const counts: Record<SkillId, [number, number]> = {};
    const domain: Record<SkillId, number> = {};
    const confidence: Record<SkillId, number> = {};
    for (const [skill, r] of this.trait) {
      if (!r.folded) continue;
      counts[skill] = [r.domain.num, r.domain.den];
      domain[skill] = this.domain(skill, 'trait');
      confidence[skill] = this.confidence(skill, 'trait');
    }
    return { at, counts, domain, confidence, target: null, lambda: 0 };
  }

  private clockFor(clock: Clock): Map<SkillId, SkillRatios> {
    return clock === 'trait' ? this.trait : this.state;
  }

  private ratiosFor(clockMap: Map<SkillId, SkillRatios>, skill: SkillId): SkillRatios {
    let r = clockMap.get(skill);
    if (!r) {
      r = makeSkillRatios();
      clockMap.set(skill, r);
    }
    return r;
  }

  private decayClock(clockMap: Map<SkillId, SkillRatios>, gamma: number): void {
    for (const r of clockMap.values()) {
      r.domain.decay(gamma);
      r.omission.decay(gamma);
      r.folded = true;
    }
  }
}
