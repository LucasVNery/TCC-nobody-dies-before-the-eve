// src/profile/decayedCount.ts — mirrors DecayedRatio for a single counter
export class DecayedCount {
  private count = 0;
  private pending = 0;

  add(n = 1): void {
    this.pending += n;
  }

  decay(gamma: number): void {
    this.count = gamma * this.count + this.pending;
    this.pending = 0;
  }

  reset(): void {
    this.count = 0;
    this.pending = 0;
  }

  get value(): number {
    return this.count;
  }
}
