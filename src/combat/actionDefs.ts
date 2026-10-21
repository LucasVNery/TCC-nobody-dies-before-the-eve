// src/combat/actionDefs.ts
export interface ActionPhaseTiming {
  startupMs: number;
  activeMs: number;
  recoveryMs: number;
}

export interface DodgeTiming {
  durationMs: number;
  iframesMs: number;
  cooldownMs: number;
}

export const DODGE: DodgeTiming = {
  durationMs: 180,
  iframesMs: 150,
  cooldownMs: 200,
};

export const SWITCH_RECOVERY_MS = 150;
/** How long a pressed-but-not-yet-executable attack/dash waits for the player to become able to act. */
export const INPUT_BUFFER_MS = 120;

export const STAGGER_MS = 250;
export const PARRY_WINDOW_MS = 150; // guarda levantada há menos que isso quando o golpe conecta = parry
/** A hit landing while the dash is younger than this (dash age at impact) is a perfect dodge. */
export const PERFECT_DODGE_MS = 80;
export const PARRY_BONUS_RECOVERY_MS = 750; // vs. RECOVERY_MS = 500 em assaltanteController.ts
