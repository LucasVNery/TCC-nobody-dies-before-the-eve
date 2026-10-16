// Cross-event state needed by the window accumulators. Computed once per event.
import type { LoggedEvent } from '../../telemetry/schema';

export interface Derived {
  /** Duration of the encounter that this event ends; null for any other event. */
  encounterMs: number | null;
}

export class StreamTracker {
  private encounterStartT: number | null = null;

  observe(ev: LoggedEvent): Derived {
    const out: Derived = { encounterMs: null };
    switch (ev.type) {
      case 'session.start':
        this.encounterStartT = null;
        break;
      case 'encounter.start':
        this.encounterStartT = ev.t_ms;
        break;
      case 'encounter.end':
        if (this.encounterStartT !== null) {
          out.encounterMs = Math.max(0, ev.t_ms - this.encounterStartT);
          this.encounterStartT = null;
        }
        break;
    }
    return out;
  }
}
