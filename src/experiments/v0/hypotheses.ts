// src/experiments/v0/hypotheses.ts
// Pre-registered hypotheses of the V0 experiment (spec §4.4). Pinned by a test:
// changing them requires the author's decision and a note in the report.
// Final set (author review 2026-10-20, after the pilot and before the full run):
// H1 got `orLowerUndefined`; H12 was retired (redundant with H2u).
import type { SkillId } from '../../profile/types';
import type { StyleId } from './styles';

/**
 * - 'greater': the per-run values of `higher` exceed those of `lower` (Cliff's
 *   delta, spec §4.4 criterion). `orLowerUndefined`: also confirmed when
 *   `lower` is undefined in >= 95% of its runs (spec "(ou ... indefinido)").
 * - 'undefinedRate': `style` is undefined (domain null) in >= 95% of its runs.
 */
export interface Hypothesis {
  id: string;
  skill: SkillId;
  kind: 'greater' | 'undefinedRate';
  higher?: StyleId;
  lower?: StyleId;
  style?: StyleId;
  orLowerUndefined?: boolean;
}

export const HYPOTHESES: readonly Hypothesis[] = [
  {
    id: 'H1',
    skill: 'weapon_repertoire',
    kind: 'greater',
    higher: 'variado',
    lower: 'agressivo',
    orLowerUndefined: true,
  },
  { id: 'H1u', skill: 'weapon_repertoire', kind: 'undefinedRate', style: 'repetitivo' },
  { id: 'H2', skill: 'action_repertoire', kind: 'greater', higher: 'variado', lower: 'bloqueador' },
  { id: 'H2u', skill: 'action_repertoire', kind: 'undefinedRate', style: 'repetitivo' },
  { id: 'H3', skill: 'punish', kind: 'greater', higher: 'paciente', lower: 'evasivo' },
  { id: 'H4', skill: 'punish', kind: 'greater', higher: 'bloqueador', lower: 'evasivo' },
  {
    id: 'H5',
    skill: 'defensive_repertoire',
    kind: 'greater',
    higher: 'aleatorio',
    lower: 'agressivo',
    orLowerUndefined: true,
  },
  { id: 'H6', skill: 'defensive_repertoire', kind: 'greater', higher: 'aleatorio', lower: 'evasivo' },
  { id: 'H7', skill: 'distance', kind: 'greater', higher: 'agressivo', lower: 'evasivo' },
  { id: 'H8', skill: 'distance', kind: 'greater', higher: 'agressivo', lower: 'paciente' },
  { id: 'H9', skill: 'patience', kind: 'greater', higher: 'paciente', lower: 'agressivo' },
  { id: 'H10', skill: 'patience', kind: 'greater', higher: 'evasivo', lower: 'agressivo' },
  { id: 'H11', skill: 'patience', kind: 'greater', higher: 'paciente', lower: 'aleatorio' },
];
