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
 * sum to 1); a missing key counts as 0.
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
}

const ALL_ACTIONS_EQUAL: Record<string, number> = {
  'sword_shield.light': 1,
  'sword_shield.heavy': 1,
  'sword_shield.charged': 1,
  'heavy_weapon.light': 1,
  'heavy_weapon.heavy': 1,
  'heavy_weapon.charged': 1,
  'bow.shot': 1,
};

/** Provisional values (Task 6 calibrates them against raw behaviour). */
export const AGENT_STYLES: Record<StyleId, AgentStyle> = {
  // close, high cadence, almost no defence
  agressivo: {
    id: 'agressivo',
    weaponWeights: { sword_shield: 0.6, heavy_weapon: 0.4 },
    weaponSwitchPerMin: 0.5,
    actionWeights: {
      'sword_shield.light': 3,
      'sword_shield.heavy': 2,
      'sword_shield.charged': 1,
      'heavy_weapon.light': 3,
      'heavy_weapon.heavy': 2,
      'heavy_weapon.charged': 1,
    },
    attackCooldownMs: 450,
    preferredDistance: 25,
    distanceTolerance: 10,
    defenseWeights: { dodge: 0.1, block: 0.05, parry: 0, none: 0.85 },
    waitForOpening: false,
  },
  // keeps distance, prefers the bow, dodges
  evasivo: {
    id: 'evasivo',
    weaponWeights: { bow: 0.75, sword_shield: 0.25 },
    weaponSwitchPerMin: 2,
    actionWeights: { 'bow.shot': 1, 'sword_shield.light': 2, 'sword_shield.heavy': 1 },
    attackCooldownMs: 700,
    preferredDistance: 170,
    distanceTolerance: 30,
    defenseWeights: { dodge: 0.85, block: 0.05, parry: 0, none: 0.1 },
    waitForOpening: false,
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
    waitForOpening: false,
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
  },
  // switches weapons often, uses every action
  variado: {
    id: 'variado',
    weaponWeights: { sword_shield: 1, heavy_weapon: 1, bow: 1 },
    weaponSwitchPerMin: 8,
    actionWeights: { ...ALL_ACTIONS_EQUAL },
    attackCooldownMs: 600,
    preferredDistance: 50,
    distanceTolerance: 20,
    defenseWeights: { dodge: 0.3, block: 0.3, parry: 0.2, none: 0.2 },
    waitForOpening: false,
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
    defenseWeights: { dodge: 0.3, block: 0.3, parry: 0, none: 0.4 },
    waitForOpening: false,
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
  },
};
