// src/profile/profileAccumulator.ts
import type { SkillId, Clock, ProfileSnapshotPayload, ProfileOutcome } from './types';
import { DecayedRatio } from './decayedRatio';
import { EntropyAccumulator } from './entropyAccumulator';
import { ACTION_TYPES, WEAPON_IDS, type ActionType } from '../combat/actionRegistry';

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

interface EntropyDim {
  acc: EntropyAccumulator;
  folded: boolean;
  everRecorded: boolean;
}

export class ProfileAccumulator {
  private trait = new Map<SkillId, SkillRatios>();
  private state = new Map<SkillId, SkillRatios>();
  private entropyDims = new Map<SkillId, EntropyDim>();

  constructor(private confidenceKappa: number = DEFAULT_CONFIDENCE_KAPPA) {
    this.entropyDims.set('action_repertoire', {
      acc: new EntropyAccumulator(ACTION_TYPES),
      folded: false,
      everRecorded: false,
    });
    this.entropyDims.set('weapon_repertoire', {
      acc: new EntropyAccumulator(WEAPON_IDS),
      folded: false,
      everRecorded: false,
    });
  }

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

  recordAction(actionType: ActionType, weaponId?: string): void {
    const actionDim = this.entropyDims.get('action_repertoire')!;
    actionDim.acc.record(actionType);
    actionDim.everRecorded = true;

    if (weaponId !== undefined) {
      const weaponDim = this.entropyDims.get('weapon_repertoire')!;
      weaponDim.acc.record(weaponId);
      weaponDim.everRecorded = true;
    }
  }

  applyRoomBoundary(): void {
    this.decayClock(this.trait, TRAIT_GAMMA);
    for (const dim of this.entropyDims.values()) {
      dim.acc.decayTrait(TRAIT_GAMMA);
      if (dim.everRecorded) dim.folded = true;
    }
  }

  applyEncounterBoundary(): void {
    this.decayClock(this.state, STATE_GAMMA);
    for (const dim of this.entropyDims.values()) {
      dim.acc.decayState(STATE_GAMMA);
    }
  }

  resetSession(): void {
    this.trait.clear();
    this.state.clear();
    for (const dim of this.entropyDims.values()) {
      dim.acc.reset();
      dim.folded = false;
      dim.everRecorded = false;
    }
  }

  domain(skill: SkillId, clock: Clock): number | null {
    const dim = this.entropyDims.get(skill);
    if (dim) return dim.acc.domain(clock);

    const r = this.clockFor(clock).get(skill);
    const num = r?.domain.num ?? 0;
    const den = r?.domain.den ?? 0;
    return (num + BETA_ALPHA) / (den + BETA_ALPHA + BETA_BETA);
  }

  confidence(skill: SkillId, clock: Clock): number {
    const dim = this.entropyDims.get(skill);
    if (dim) return dim.acc.confidence(clock);

    const den = this.clockFor(clock).get(skill)?.domain.den ?? 0;
    return den / (den + this.confidenceKappa);
  }

  deficit(skill: SkillId, clock: Clock): number | null {
    const d = this.domain(skill, clock);
    return d === null ? null : 1 - d;
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
   * pendente (registrada via `record()`/`recordOutcome()`/`recordAction()`
   * mas não decaída) não aparece aqui. Para incluir a sala que acabou de
   * terminar, chame `applyRoomBoundary()` imediatamente antes de
   * `snapshot('room.exit')`.
   */
  snapshot(at: ProfileSnapshotPayload['at']): ProfileSnapshotPayload {
    const counts: Record<SkillId, [number, number]> = {};
    const domain: Record<SkillId, number | null> = {};
    const confidence: Record<SkillId, number> = {};

    for (const [skill, r] of this.trait) {
      if (!r.folded) continue;
      counts[skill] = [r.domain.num, r.domain.den];
      domain[skill] = this.domain(skill, 'trait');
      confidence[skill] = this.confidence(skill, 'trait');
    }

    for (const [skill, dim] of this.entropyDims) {
      if (!dim.folded) continue;
      const labelCounts = dim.acc.counts('trait');
      const usedLabels = Object.values(labelCounts).filter((v) => v > 0).length;
      counts[skill] = [usedLabels, dim.acc.totalCount('trait')];
      domain[skill] = dim.acc.domain('trait');
      confidence[skill] = dim.acc.confidence('trait');
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
