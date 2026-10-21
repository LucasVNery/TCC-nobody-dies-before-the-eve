import { describe, expect, it } from 'vitest';
import { ASSALTANTE_RULES } from './assaltanteRules';

describe('ASSALTANTE_RULES', () => {
  const pick = (distanceToPlayer: number, lungeReady = false) =>
    ASSALTANTE_RULES.find((r) => r.precond({ distanceToPlayer, state: 'idle', lungeReady }));

  it('assaltante.attack wins when the player is within 60 units, otherwise assaltante.chase', () => {
    expect(pick(60)?.id).toBe('assaltante.attack');
    expect(pick(61)?.id).toBe('assaltante.chase');
  });

  it('tags the attack rule as a dodge opportunity', () => {
    expect(ASSALTANTE_RULES.find((r) => r.id === 'assaltante.attack')?.opportunity_tags).toEqual({ dodge: 1 });
  });

  it('assaltante.lunge needs the cooldown ready and a distance in [150, 260]; attack beats it, chase follows it', () => {
    expect(pick(150, true)?.id).toBe('assaltante.lunge');
    expect(pick(260, true)?.id).toBe('assaltante.lunge');
    expect(pick(149, true)?.id).toBe('assaltante.chase');
    expect(pick(261, true)?.id).toBe('assaltante.chase');
    expect(pick(120, true)?.id).toBe('assaltante.chase');
    expect(pick(200, false)?.id).toBe('assaltante.chase');
    expect(pick(60, true)?.id).toBe('assaltante.attack');
    expect(ASSALTANTE_RULES.map((r) => r.id)).toEqual(['assaltante.attack', 'assaltante.lunge', 'assaltante.chase']);
    expect(ASSALTANTE_RULES.find((r) => r.id === 'assaltante.lunge')?.opportunity_tags).toEqual({ dodge: 1 });
  });
});
