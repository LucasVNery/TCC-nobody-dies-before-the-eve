// src/ai/rules/assaltanteRules.ts
import type { EnemyState } from '../../combat/types';
import { LUNGE, LONG_LUNGE } from '../../combat/movementDefs';
import { ELITE, ELITE_PATTERN_WEIGHTS, type AttackKind } from '../../combat/eliteDefs';
import type { Prng } from '../../core/prng';

export const ATTACK_RANGE = 60;

export interface Blackboard {
  distanceToPlayer: number;
  state: EnemyState;
  lungeReady: boolean;
  /** Long-charge cooldown is over (separate from the short lunge's). */
  chargeReady: boolean;
  /** Mandatory pause since the last pattern is over and the first-attack delay since birth has passed. */
  patternReady: boolean;
}

export interface Rule {
  id: string;
  archetype: 'assaltante';
  opportunity_tags: Partial<Record<'dodge' | 'punish', number>>;
  precond: (bb: Blackboard) => boolean;
  /** Set on the attack patterns: those compete in the weighted draw. Absent on chase. */
  pattern?: AttackKind;
}

export const ASSALTANTE_RULES: Rule[] = [
  {
    id: 'assaltante.attack',
    archetype: 'assaltante',
    opportunity_tags: { dodge: 1 },
    pattern: 'swing',
    precond: (bb) => bb.patternReady && bb.distanceToPlayer <= ATTACK_RANGE,
  },
  {
    id: 'assaltante.combo',
    archetype: 'assaltante',
    opportunity_tags: { dodge: 1 },
    pattern: 'combo',
    precond: (bb) => bb.patternReady && bb.distanceToPlayer <= ATTACK_RANGE,
  },
  {
    id: 'assaltante.slam',
    archetype: 'assaltante',
    opportunity_tags: { dodge: 1 },
    pattern: 'slam',
    precond: (bb) => bb.patternReady && bb.distanceToPlayer <= ELITE.slamMaxDistance,
  },
  {
    id: 'assaltante.lunge',
    archetype: 'assaltante',
    opportunity_tags: { dodge: 1 },
    pattern: 'lunge',
    precond: (bb) =>
      bb.patternReady &&
      ((bb.lungeReady && bb.distanceToPlayer >= LUNGE.minDistance && bb.distanceToPlayer <= LUNGE.maxDistance) ||
        (bb.chargeReady &&
          bb.distanceToPlayer > LUNGE.maxDistance &&
          bb.distanceToPlayer <= LONG_LUNGE.maxDistance)),
  },
  {
    id: 'assaltante.chase',
    archetype: 'assaltante',
    opportunity_tags: {},
    precond: () => true,
  },
];

/**
 * Weighted draw among the attack rules whose precondition holds; chase when none is eligible.
 * The PRNG is consumed only when at least one pattern is eligible.
 */
export function choosePatternRule(bb: Blackboard, prng: Prng): Rule {
  const eligible = ASSALTANTE_RULES.filter((r) => r.pattern !== undefined && r.precond(bb));
  if (eligible.length === 0) return ASSALTANTE_RULES.find((r) => r.id === 'assaltante.chase')!;
  const total = eligible.reduce((sum, r) => sum + ELITE_PATTERN_WEIGHTS[r.pattern!], 0);
  let roll = prng.next() * total;
  for (const r of eligible) {
    roll -= ELITE_PATTERN_WEIGHTS[r.pattern!];
    if (roll < 0) return r;
  }
  return eligible[eligible.length - 1];
}
