export type BufferedInput = { kind: 'attack'; actionId: string } | { kind: 'dash' };

/** Holds at most one pending input for `windowMs` of simulation time. */
export class InputBuffer {
  private pending: { input: BufferedInput; atMs: number } | null = null;

  constructor(private readonly windowMs: number) {}

  push(input: BufferedInput, nowMs: number): void {
    this.pending = { input, atMs: nowMs };
  }

  /** Returns and clears the pending input if it is executable now; drops it if expired. */
  take(canExecute: (input: BufferedInput) => boolean, nowMs: number): BufferedInput | null {
    if (!this.pending) return null;
    if (nowMs - this.pending.atMs > this.windowMs) {
      this.pending = null;
      return null;
    }
    if (!canExecute(this.pending.input)) return null;
    const { input } = this.pending;
    this.pending = null;
    return input;
  }

  clear(): void {
    this.pending = null;
  }
}
