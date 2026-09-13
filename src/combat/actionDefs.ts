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
  durationMs: 250,
  iframesMs: 200,
  cooldownMs: 300,
};

export const SWITCH_RECOVERY_MS = 250;

export const POISE_MAX = 100;
export const POISE_DRAIN_PER_BLOCK = 40; // 3 bloqueios seguidos quebram a postura
export const POISE_REGEN_DELAY_MS = 1000; // tempo parado em 'idle' antes de regenerar
export const POISE_REGEN_PER_SECOND = 50; // recarga total em ~2s depois do delay
export const STAGGER_MS = 350;
export const PARRY_WINDOW_MS = 150; // guarda levantada há menos que isso quando o golpe conecta = parry
export const PARRY_BONUS_RECOVERY_MS = 750; // vs. RECOVERY_MS = 500 em assaltanteController.ts
