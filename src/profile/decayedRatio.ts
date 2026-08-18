// src/profile/decayedRatio.ts
export class DecayedRatio {
  private numerator = 0;
  private denominator = 0;
  private pendingNumerator = 0;
  private pendingDenominator = 0;

  add(numerator: number, denominator: number): void {
    this.pendingNumerator += numerator;
    this.pendingDenominator += denominator;
  }

  decay(gamma: number): void {
    this.numerator = gamma * this.numerator + this.pendingNumerator;
    this.denominator = gamma * this.denominator + this.pendingDenominator;
    this.pendingNumerator = 0;
    this.pendingDenominator = 0;
  }

  reset(): void {
    this.numerator = 0;
    this.denominator = 0;
    this.pendingNumerator = 0;
    this.pendingDenominator = 0;
  }

  get num(): number {
    return this.numerator;
  }

  get den(): number {
    return this.denominator;
  }
}
