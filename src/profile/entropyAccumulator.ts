import { DecayedCount } from './decayedCount';
import type { Clock } from './types';

export class EntropyAccumulator {
  private readonly labelSet: ReadonlySet<string>;
  private readonly n: number;
  private trait = new Map<string, DecayedCount>();
  private state = new Map<string, DecayedCount>();

  constructor(
    private readonly labels: readonly string[],
    private readonly kappa = 25,
  ) {
    this.labelSet = new Set(labels);
    this.n = labels.length;
    for (const label of labels) {
      this.trait.set(label, new DecayedCount());
      this.state.set(label, new DecayedCount());
    }
  }

  record(label: string): void {
    if (!this.labelSet.has(label)) throw new Error(`unknown label: ${label}`);
    this.trait.get(label)!.add(1);
    this.state.get(label)!.add(1);
  }

  decayTrait(gamma: number): void {
    for (const c of this.trait.values()) c.decay(gamma);
  }

  decayState(gamma: number): void {
    for (const c of this.state.values()) c.decay(gamma);
  }

  reset(): void {
    for (const c of this.trait.values()) c.reset();
    for (const c of this.state.values()) c.reset();
  }

  domain(clock: Clock): number | null {
    const counts = Object.values(this.counts(clock)).filter((v) => v > 0);
    if (counts.length < 2) return null;
    const total = counts.reduce((a, b) => a + b, 0);
    const negEntropy = counts.reduce((acc, c) => {
      const p = c / total;
      return acc + p * Math.log(p);
    }, 0);
    return -negEntropy / Math.log(this.n);
  }

  deficit(clock: Clock): number | null {
    const d = this.domain(clock);
    return d === null ? null : 1 - d;
  }

  confidence(clock: Clock): number {
    const total = this.totalCount(clock);
    return total / (total + this.kappa);
  }

  totalCount(clock: Clock): number {
    return Object.values(this.counts(clock)).reduce((a, b) => a + b, 0);
  }

  counts(clock: Clock): Record<string, number> {
    const map = clock === 'trait' ? this.trait : this.state;
    const out: Record<string, number> = {};
    for (const [label, c] of map) out[label] = c.value;
    return out;
  }
}
