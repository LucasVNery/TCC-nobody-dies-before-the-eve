// src/experiments/v0/hypotheses.ts
// Pre-registered hypotheses of the V0 experiment (spec §4.4). Pinned by a test:
// changing them requires the author's decision and a note in the report.
// Final set (author review 2026-10-20, after the pilot and before the full run):
// H1 got `orLowerUndefined`; H12 was retired (redundant with H2u).
import type { SkillId } from '../../profile/types';
import type { StyleId } from './styles';
import type { RunMetricId } from './runMetrics';

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

/**
 * M family (V0.1 spec 2026-10-21 §4.3): per-RUN values of the panel metrics
 * (runMetrics.ts); the per-run values of `higher` exceed those of `lower`, same
 * criterion as the P family 'greater' rule (Cliff's delta, bootstrap 95% CI
 * above 0 and delta >= 0.33). Claude's guesses, reviewed by the author before
 * the full run. Pinned by a test, like HYPOTHESES.
 */
export interface MHypothesis {
  id: string;
  metric: RunMetricId;
  higher: StyleId;
  lower: StyleId;
}

export const M_HYPOTHESES: readonly MHypothesis[] = [
  { id: 'M1', metric: 'staminaSpentPerMinute', higher: 'agressivo', lower: 'bloqueador' },
  { id: 'M2', metric: 'staminaHighFraction', higher: 'bloqueador', lower: 'agressivo' },
  { id: 'M3', metric: 'dodgeSpendShare', higher: 'evasivo', lower: 'agressivo' },
  { id: 'M4', metric: 'blockSpendShare', higher: 'bloqueador', lower: 'evasivo' },
  { id: 'M5', metric: 'itemPickRate', higher: 'evasivo', lower: 'agressivo' },
];
