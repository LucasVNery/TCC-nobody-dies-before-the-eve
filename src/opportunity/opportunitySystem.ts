// src/opportunity/opportunitySystem.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { OppType, OppOutcome } from './types';

export interface ActiveOpp {
  opp_id: string;
  type: OppType;
  src: string;
  remainingMs: number;
}

export class OpportunitySystem {
  private active: ActiveOpp[] = [];
  private nextId = 1;

  constructor(private bus: EventBus<GameEvents>) {}

  open(type: OppType, src: string, windowMs: number): string {
    const opp_id = `opp_${this.nextId++}`;
    this.active.push({ opp_id, type, src, remainingMs: windowMs });
    this.bus.emit('opp.open', { opp_id, type, src, window_ms: windowMs });
    return opp_id;
  }

  resolve(opp_id: string, outcome: Exclude<OppOutcome, 'expired'>): void {
    const idx = this.active.findIndex((o) => o.opp_id === opp_id);
    if (idx === -1) return;
    const opp = this.active[idx];
    this.active.splice(idx, 1);
    this.bus.emit('opp.close', { opp_id: opp.opp_id, type: opp.type, outcome });
  }

  step(stepMs: number): void {
    const stillActive: ActiveOpp[] = [];
    for (const opp of this.active) {
      opp.remainingMs -= stepMs;
      if (opp.remainingMs <= 0) {
        this.bus.emit('opp.close', { opp_id: opp.opp_id, type: opp.type, outcome: 'expired' });
      } else {
        stillActive.push(opp);
      }
    }
    this.active = stillActive;
  }

  activeOfType(type: OppType): ActiveOpp[] {
    return this.active.filter((o) => o.type === type);
  }
}
