import { describe, expect, it } from 'vitest';
import { ASSALTANTE_RULES } from './assaltanteRules';

describe('ASSALTANTE_RULES', () => {
  const pick = (distanceToPlayer: number) =>
    ASSALTANTE_RULES.find((r) => r.precond({ distanceToPlayer, state: 'idle' }));

  it('assaltante.attack wins when the player is within 60 units, otherwise assaltante.chase', () => {
    expect(pick(60)?.id).toBe('assaltante.attack');
    expect(pick(61)?.id).toBe('assaltante.chase');
  });

  it('tags the attack rule as a dodge opportunity', () => {
    expect(ASSALTANTE_RULES.find((r) => r.id === 'assaltante.attack')?.opportunity_tags).toEqual({ dodge: 1 });
  });
});
