import { describe, it, expect } from 'vitest';
import {
  ACTION_REGISTRY,
  ACTION_TYPES,
  resolveAction,
  SWORD_SHIELD_ACTIONS,
  WEAPON_IDS,
  HEAVY_WEAPON_ACTIONS,
  BOW_ACTIONS,
  findWeaponAction,
} from './actionRegistry';

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

  it('ACTION_REGISTRY contains the sword_shield, heavy_weapon, and bow actions', () => {
    expect(ACTION_REGISTRY.size).toBe(
      SWORD_SHIELD_ACTIONS.length + HEAVY_WEAPON_ACTIONS.length + BOW_ACTIONS.length,
    );
  });
});

describe('bow and heavy_weapon data', () => {
  it('WEAPON_IDS has exactly 3 members', () => {
    expect(WEAPON_IDS).toEqual(['sword_shield', 'bow', 'heavy_weapon']);
  });

  it('ACTION_REGISTRY contains all three weapons worth of actions', () => {
    expect(ACTION_REGISTRY.size).toBe(
      SWORD_SHIELD_ACTIONS.length + HEAVY_WEAPON_ACTIONS.length + BOW_ACTIONS.length,
    );
  });

  it('every registered action belongs to a known weapon in WEAPON_IDS', () => {
    for (const action of ACTION_REGISTRY.values()) {
      expect(WEAPON_IDS).toContain(action.weaponId);
    }
  });

  it('the bow has exactly one action, of type throw', () => {
    expect(BOW_ACTIONS).toHaveLength(1);
    expect(BOW_ACTIONS[0].actionType).toBe('throw');
    expect(BOW_ACTIONS[0].charge).toBeUndefined();
  });

  it('heavy_weapon mirrors sword_shield\'s three action types', () => {
    const types = HEAVY_WEAPON_ACTIONS.map((a) => a.actionType).sort();
    expect(types).toEqual(['charged', 'heavy', 'light']);
  });

  it('heavy_weapon.charged has consistent hold bounds and a higher reach ceiling than sword_shield.charged', () => {
    const heavyCharged = resolveAction('heavy_weapon.charged');
    const swordCharged = resolveAction('sword_shield.charged');
    expect(heavyCharged.charge!.minHoldMs).toBeLessThan(heavyCharged.charge!.maxHoldMs);
    expect(heavyCharged.charge!.reachMax).toBeGreaterThan(swordCharged.charge!.reachMax);
  });
});

describe('findWeaponAction', () => {
  it('returns the matching ActionDef when it exists', () => {
    const action = findWeaponAction('bow', 'throw');
    expect(action?.id).toBe('bow.shot');
  });

  it('returns undefined for a weapon/actionType combination that does not exist', () => {
    expect(findWeaponAction('bow', 'heavy')).toBeUndefined();
    expect(findWeaponAction('bow', 'charged')).toBeUndefined();
  });

  it('returns undefined for an unknown weaponId', () => {
    expect(findWeaponAction('unknown_weapon', 'light')).toBeUndefined();
  });
});
