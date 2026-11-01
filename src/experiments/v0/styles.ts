export type StyleId = 'agressivo' | 'evasivo' | 'bloqueador' | 'paciente' | 'variado' | 'repetitivo' | 'aleatorio';

export const STYLE_IDS: readonly StyleId[] = [
  'agressivo',
  'evasivo',
  'bloqueador',
  'paciente',
  'variado',
  'repetitivo',
  'aleatorio',
];

export interface DefenseWeights {
  dodge: number;
  block: number;
  parry: number;
  none: number;
}

/**
 * A parameterized play style (spec §4.1). Weights are relative (they need not
 * sum to 1); a missing key counts as 0. Distance/cadence gating acts on the
 * world seen with the fixed PERCEPTION_LAG_MS (80 ms); defenceWeights and
 * waitForOpening act on events after the humanizer's sampled reaction (~250 ms).
 * See policy.ts.
 */
export interface AgentStyle {
  id: StyleId;
  /** Relative preference per weapon id; drawn whenever the weapon is (re)chosen. */
  weaponWeights: Record<string, number>;
  /**
   * Rate (per simulated minute) of weapon re-draw events, checked each time the
   * next attack is planned. 0 = keep the first weapon forever; a very large
   * value re-draws the weapon for every attack.
   */
  weaponSwitchPerMin: number;
  /** Relative preference per registered action id, used within the chosen weapon. */
  actionWeights: Record<string, number>;
  /** Minimum time between two attack starts. */
  attackCooldownMs: number;
  /** Distance (px) the agent keeps from the enemy while not closing in for an attack. */
  preferredDistance: number;
  /** Half-width (px) of the band around preferredDistance where it stands still. */
  distanceTolerance: number;
  /** Response chosen when a new enemy attack (telegraph) is seen. */
  defenseWeights: DefenseWeights;
  /** Attacks only in an opening: enemy seen recovering, or far away with a ranged action that reaches. */
  waitForOpening: boolean;
  /** Chance (0..1) that an approach stretch is run (sprint) instead of walked; drawn once per stretch. */
  sprintApproach: number;
  /** Stamina (0..60, of 150) kept for defence: a non-opening attack is not started if it would leave less. */
  staminaReserve: number;
  /** How much the agent goes after items on the floor (0..1); used by the item behaviour (Task 4). */
  itemSeeking: number;
  /** Item use rules (Task 4). */
  itemUse: ItemUse;
}

export interface ItemUse {
  healBelowHpFraction: number;
  bombWithinPx: number;
  powerOnAttackStart: boolean;
  /** Control style: uses items at random instead of by rule. */
  random: boolean;
}

const ITEM_USE: ItemUse = { healBelowHpFraction: 0.5, bombWithinPx: 110, powerOnAttackStart: true, random: false };

const ALL_ACTIONS_EQUAL: Record<string, number> = {
  'sword_shield.light': 1,
  'sword_shield.heavy': 1,
  'sword_shield.charged': 1,
  'heavy_weapon.light': 1,
  'heavy_weapon.heavy': 1,
  'heavy_weapon.charged': 1,
  'bow.shot': 1,
};

/**
 * Values calibrated in a pilot against raw behaviour only (V0 Task 6; every
 * change and its reason is in experiments/v0/calibration.md).
 */
export const AGENT_STYLES: Record<StyleId, AgentStyle> = {
  // close, high cadence, almost no defence
  agressivo: {
    id: 'agressivo',
    weaponWeights: { sword_shield: 0.8, heavy_weapon: 0.2 },
    weaponSwitchPerMin: 0.5,
    actionWeights: {
      'sword_shield.light': 4,
      'sword_shield.heavy': 2,
      'sword_shield.charged': 1,
      'heavy_weapon.light': 3,
      'heavy_weapon.heavy': 1,
      'heavy_weapon.charged': 1,
    },
    attackCooldownMs: 300,
    preferredDistance: 25,
    distanceTolerance: 10,
    defenseWeights: { dodge: 0.1, block: 0.05, parry: 0, none: 0.85 },
    waitForOpening: false,
    sprintApproach: 1,
    staminaReserve: 0,
    itemSeeking: 0.3,
    itemUse: ITEM_USE,
  },
  // keeps distance, prefers the bow, dodges
  evasivo: {
    id: 'evasivo',
    weaponWeights: { bow: 0.65, sword_shield: 0.35 },
    weaponSwitchPerMin: 2,
    actionWeights: { 'bow.shot': 1, 'sword_shield.light': 2, 'sword_shield.heavy': 1 },
    attackCooldownMs: 700,
    preferredDistance: 170,
    distanceTolerance: 30,
    defenseWeights: { dodge: 0.85, block: 0.05, parry: 0, none: 0.1 },
    waitForOpening: false,
    sprintApproach: 0.2,
    staminaReserve: 45,
    itemSeeking: 0.9,
    itemUse: ITEM_USE,
  },
  // holds the guard, times parries on the telegraph, counter-attacks
  bloqueador: {
    id: 'bloqueador',
    weaponWeights: { sword_shield: 1 },
    weaponSwitchPerMin: 0,
    actionWeights: { 'sword_shield.light': 3, 'sword_shield.heavy': 1 },
    attackCooldownMs: 650,
    preferredDistance: 40,
    distanceTolerance: 15,
    defenseWeights: { dodge: 0.05, block: 0.55, parry: 0.35, none: 0.05 },
    waitForOpening: true,
    sprintApproach: 0.5,
    staminaReserve: 30,
    itemSeeking: 0.5,
    itemUse: ITEM_USE,
  },
  // waits: attacks only after the enemy's swing (recovery) or from safe range
  paciente: {
    id: 'paciente',
    weaponWeights: { sword_shield: 0.6, bow: 0.4 },
    weaponSwitchPerMin: 1,
    actionWeights: { 'sword_shield.light': 3, 'sword_shield.heavy': 1, 'bow.shot': 1 },
    attackCooldownMs: 600,
    preferredDistance: 55,
    distanceTolerance: 15,
    defenseWeights: { dodge: 0.5, block: 0.3, parry: 0.1, none: 0.1 },
    waitForOpening: true,
    sprintApproach: 0.3,
    staminaReserve: 45,
    itemSeeking: 0.7,
    itemUse: ITEM_USE,
  },
  // switches weapons often, uses every action
  variado: {
    id: 'variado',
    weaponWeights: { sword_shield: 1, heavy_weapon: 1.2, bow: 0.35 },
    weaponSwitchPerMin: 15,
    actionWeights: { ...ALL_ACTIONS_EQUAL },
    attackCooldownMs: 600,
    preferredDistance: 50,
    distanceTolerance: 20,
    defenseWeights: { dodge: 0.35, block: 0.3, parry: 0.25, none: 0.1 },
    waitForOpening: false,
    sprintApproach: 0.6,
    staminaReserve: 15,
    itemSeeking: 0.6,
    itemUse: ITEM_USE,
  },
  // one weapon, one move
  repetitivo: {
    id: 'repetitivo',
    weaponWeights: { sword_shield: 1 },
    weaponSwitchPerMin: 0,
    actionWeights: { 'sword_shield.light': 1 },
    attackCooldownMs: 550,
    preferredDistance: 35,
    distanceTolerance: 10,
    defenseWeights: { dodge: 0.35, block: 0.35, parry: 0, none: 0.3 },
    waitForOpening: false,
    sprintApproach: 0.5,
    staminaReserve: 0,
    itemSeeking: 0.2,
    itemUse: ITEM_USE,
  },
  // control: uniform over the 7 registered actions (weapon weights 3:3:1 x
  // uniform within the weapon, weapon re-drawn every attack) and uniform defence
  aleatorio: {
    id: 'aleatorio',
    weaponWeights: { sword_shield: 3, heavy_weapon: 3, bow: 1 },
    weaponSwitchPerMin: 6000,
    actionWeights: { ...ALL_ACTIONS_EQUAL },
    attackCooldownMs: 600,
    preferredDistance: 60,
    distanceTolerance: 30,
    defenseWeights: { dodge: 0.25, block: 0.25, parry: 0.25, none: 0.25 },
    waitForOpening: false,
    sprintApproach: 0.5,
    staminaReserve: 0,
    itemSeeking: 0.5,
    itemUse: { ...ITEM_USE, random: true },
  },
};
