import type { ActionPhaseTiming } from './actionDefs';

export type ActionType = 'light' | 'heavy' | 'charged' | 'throw' | 'utility';

export const ACTION_TYPES: readonly ActionType[] = ['light', 'heavy', 'charged', 'throw', 'utility'];

export interface ChargeSpec {
  minHoldMs: number;
  maxHoldMs: number;
  /**
   * Reach at maxHoldMs; ActionDef.reach is the base value at minHoldMs.
   * Not in the design doc's §3.1 snippet — added because linear
   * interpolation (§3.2) needs two endpoints and ActionDef only carries
   * one `reach` field.
   */
  reachMax: number;
}

export interface ActionDef {
  id: string;
  weaponId: string;
  actionType: ActionType;
  timing: ActionPhaseTiming;
  reach: number;
  charge?: ChargeSpec;
}

export const SWORD_SHIELD_ACTIONS: ActionDef[] = [
  {
    id: 'sword_shield.light',
    weaponId: 'sword_shield',
    actionType: 'light',
    timing: { startupMs: 100, activeMs: 100, recoveryMs: 150 },
    reach: 45,
  },
  {
    id: 'sword_shield.heavy',
    weaponId: 'sword_shield',
    actionType: 'heavy',
    timing: { startupMs: 220, activeMs: 120, recoveryMs: 300 },
    reach: 55,
  },
  {
    id: 'sword_shield.charged',
    weaponId: 'sword_shield',
    actionType: 'charged',
    // startupMs mirrors charge.minHoldMs for documentation only — the
    // charged lifecycle in PlayerController drives startup from
    // charge.minHoldMs/maxHoldMs, not from timing.startupMs.
    timing: { startupMs: 150, activeMs: 140, recoveryMs: 350 },
    reach: 50,
    charge: { minHoldMs: 150, maxHoldMs: 900, reachMax: 70 },
  },
];

function buildRegistry(weaponActionLists: readonly ActionDef[][]): ReadonlyMap<string, ActionDef> {
  const map = new Map<string, ActionDef>();
  for (const list of weaponActionLists) {
    for (const action of list) {
      if (map.has(action.id)) throw new Error(`duplicate action id: ${action.id}`);
      map.set(action.id, action);
    }
  }
  return map;
}

export const ACTION_REGISTRY: ReadonlyMap<string, ActionDef> = buildRegistry([SWORD_SHIELD_ACTIONS]);

export function resolveAction(id: string): ActionDef {
  const action = ACTION_REGISTRY.get(id);
  if (!action) throw new Error(`unknown action id: ${id}`);
  return action;
}
