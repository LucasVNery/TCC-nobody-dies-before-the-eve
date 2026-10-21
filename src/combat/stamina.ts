// src/combat/stamina.ts
export type SpendKind = 'attack' | 'sprint' | 'dodge' | 'block';

export const STAMINA_MAX = 100;
export const STAMINA_COST = {
  light: 12,
  heavy: 22,
  charged: 28,
  throw: 8,
  utility: 0,
  dodge: 30,
  blockHit: 15,
  sprintPerSecond: 10,
} as const;
export const STAMINA_REGEN = { perSecond: 35, delayMs: 600, exhaustedDelayMs: 1200 } as const;

function emptySpent(): Record<SpendKind, number> {
  return { attack: 0, sprint: 0, dodge: 0, block: 0 };
}

export class Stamina {
  private _value = STAMINA_MAX;
  private delayRemainingMs = 0;
  private spent = emptySpent();

  get value(): number {
    return this._value;
  }

  get exhausted(): boolean {
    return this._value <= 0;
  }

  /** Clamps at 0 and restarts the regen wait (longer if it hit 0). */
  spend(amount: number, kind: SpendKind): void {
    if (amount <= 0) return;
    const taken = Math.min(amount, this._value);
    this._value -= taken;
    this.spent[kind] += taken;
    this.delayRemainingMs = this._value <= 0 ? STAMINA_REGEN.exhaustedDelayMs : STAMINA_REGEN.delayMs;
  }

  /** Clamps at STAMINA_MAX; leaves the regen wait alone. */
  refund(amount: number): void {
    this._value = Math.min(STAMINA_MAX, this._value + amount);
  }

  /** Only with canRegen does the wait count down and stamina come back; a big step regens its part after the wait. */
  step(stepMs: number, canRegen: boolean): void {
    if (!canRegen || this._value >= STAMINA_MAX) return;
    const delayBefore = this.delayRemainingMs;
    this.delayRemainingMs = Math.max(0, delayBefore - stepMs);
    const regenMs = stepMs - delayBefore;
    if (regenMs > 0) {
      this._value = Math.min(STAMINA_MAX, this._value + (regenMs / 1000) * STAMINA_REGEN.perSecond);
    }
  }

  /** Returns and zeroes the spend accumulated since the last call. */
  takeSpent(): Record<SpendKind, number> {
    const out = this.spent;
    this.spent = emptySpent();
    return out;
  }

  reset(): void {
    this._value = STAMINA_MAX;
    this.delayRemainingMs = 0;
    this.spent = emptySpent();
  }
}
