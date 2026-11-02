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
  durationMs: 220,
  iframesMs: 200,
  cooldownMs: 2500,
};

export const SWITCH_RECOVERY_MS = 150;
/** How long a pressed-but-not-yet-executable attack/dash waits for the player to become able to act. */
export const INPUT_BUFFER_MS = 170;
/** A dash pressed within this many ms of the end of the locked (startup+active) part already cancels a non-charged attack. */
export const DASH_CANCEL_EARLY_MS = 60;
/** Fraction of walk speed the player keeps while in the locked part of a non-charged attack. */
export const LOCKED_MOVE_FACTOR = 0.4;

export const STAGGER_MS = 250;
export const PARRY_WINDOW_MS = 150; // guarda levantada há menos que isso quando o golpe conecta = parry
/** A hit landing while the dash is younger than this (dash age at impact) is a perfect dodge. */
export const PERFECT_DODGE_MS = 110;
export const PARRY_BONUS_RECOVERY_MS = 750; // vs. RECOVERY_MS = 500 em assaltanteController.ts
