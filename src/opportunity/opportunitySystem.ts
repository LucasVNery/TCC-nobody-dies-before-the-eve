// src/opportunity/opportunitySystem.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { OppType, OppOutcome, InvalidReason, ActionId } from './types';

export type ExpiryResult = { outcome: 'expired' | 'invalid'; reason?: InvalidReason };

export interface ActiveOpp {
  opp_id: string;
  type: OppType;
  src: string;
  remainingMs: number;
  onExpire?: () => ExpiryResult;
}

export interface ResolveExtras {
  reason?: InvalidReason;
  attempt?: ActionId;
}

export class OpportunitySystem {
  private active: ActiveOpp[] = [];
  private nextId = 1;

  constructor(private bus: EventBus<GameEvents>) {}

  open(type: OppType, src: string, windowMs: number, onExpire?: () => ExpiryResult): string {
    const opp_id = `opp_${this.nextId++}`;
    this.active.push({ opp_id, type, src, remainingMs: windowMs, onExpire });
    this.bus.emit('opp.open', { opp_id, type, src, window_ms: windowMs });
    return opp_id;
  }

  resolve(opp_id: string, outcome: Exclude<OppOutcome, 'expired'>, extras?: ResolveExtras): void {
    if (outcome === 'invalid' && !extras?.reason) {
      throw new Error('invalid outcome requires a reason');
    }
    const idx = this.active.findIndex((o) => o.opp_id === opp_id);
    if (idx === -1) return;
    const opp = this.active[idx];
    this.active.splice(idx, 1);
    this.bus.emit('opp.close', {
      opp_id: opp.opp_id,
      type: opp.type,
      outcome,
      ...(extras?.reason ? { reason: extras.reason } : {}),
      ...(extras?.attempt ? { attempt: extras.attempt } : {}),
    });
  }

  step(stepMs: number): void {
    const expiring: ActiveOpp[] = [];
    const stillActive: ActiveOpp[] = [];
    for (const opp of this.active) {
      opp.remainingMs -= stepMs;
      if (opp.remainingMs <= 0) {
        expiring.push(opp);
      } else {
        stillActive.push(opp);
      }
    }
    this.active = stillActive;
    for (const opp of expiring) {
      const result: ExpiryResult = opp.onExpire?.() ?? { outcome: 'expired' };
      this.bus.emit('opp.close', {
        opp_id: opp.opp_id,
        type: opp.type,
        outcome: result.outcome,
        ...(result.reason ? { reason: result.reason } : {}),
      });
    }
  }

  activeOfType(type: OppType): ActiveOpp[] {
    return this.active.filter((o) => o.type === type);
  }
}
