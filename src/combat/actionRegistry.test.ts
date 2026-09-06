import { describe, it, expect } from 'vitest';
import { ACTION_REGISTRY, ACTION_TYPES, resolveAction, SWORD_SHIELD_ACTIONS } from './actionRegistry';

describe('actionRegistry', () => {
  it('ACTION_TYPES has exactly 5 members (n is fixed regardless of how many are implemented)', () => {
    expect(ACTION_TYPES).toHaveLength(5);
    expect(ACTION_TYPES).toEqual(['light', 'heavy', 'charged', 'throw', 'utility']);
  });

  it('resolveAction() returns the matching ActionDef', () => {
    const action = resolveAction('sword_shield.light');
    expect(action.actionType).toBe('light');
    expect(action.weaponId).toBe('sword_shield');
  });

  it('resolveAction() throws for an unknown id', () => {
    expect(() => resolveAction('nope')).toThrow();
  });

  it('charge is present if and only if actionType is charged', () => {
    for (const action of SWORD_SHIELD_ACTIONS) {
      expect(action.charge !== undefined).toBe(action.actionType === 'charged');
    }
  });

  it('the sword_shield charged action has consistent hold bounds', () => {
    const charged = resolveAction('sword_shield.charged');
    expect(charged.charge!.minHoldMs).toBeLessThan(charged.charge!.maxHoldMs);
    expect(charged.charge!.reachMax).toBeGreaterThan(charged.reach);
  });

  it('ACTION_REGISTRY contains exactly the sword_shield actions for now', () => {
    expect(ACTION_REGISTRY.size).toBe(SWORD_SHIELD_ACTIONS.length);
  });
});
