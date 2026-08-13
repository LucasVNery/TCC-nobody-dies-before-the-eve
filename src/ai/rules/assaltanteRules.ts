// src/ai/rules/assaltanteRules.ts
import type { EnemyState } from '../../combat/types';

export const ATTACK_RANGE = 60;

export interface Blackboard {
  distanceToPlayer: number;
  state: EnemyState;
}

export interface Rule {
  id: string;
  archetype: 'assaltante';
  opportunity_tags: Partial<Record<'dodge' | 'punish', number>>;
  precond: (bb: Blackboard) => boolean;
}

export const ASSALTANTE_RULES: Rule[] = [
  {
    id: 'assaltante.attack',
    archetype: 'assaltante',
    opportunity_tags: { dodge: 1 },
    precond: (bb) => bb.distanceToPlayer <= ATTACK_RANGE,
  },
  {
    id: 'assaltante.chase',
    archetype: 'assaltante',
    opportunity_tags: {},
    precond: () => true,
  },
];
