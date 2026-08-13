// src/combat/actionDefs.ts
export interface ActionPhaseTiming {
  startupMs: number;
  activeMs: number;
  recoveryMs: number;
}

export const LIGHT_ATTACK: ActionPhaseTiming = {
  startupMs: 100,
  activeMs: 100,
  recoveryMs: 150,
};

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

export function totalDurationMs(t: ActionPhaseTiming): number {
  return t.startupMs + t.activeMs + t.recoveryMs;
}
