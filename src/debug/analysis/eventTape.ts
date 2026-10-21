// Fixed-size tape of the most recent events, for the analysis HUD. Pure: no Phaser, no DOM.
import type { LoggedEvent } from '../../telemetry/schema';

export interface TapeEntry {
  seq: number;
  t_ms: number;
  type: string;
  summary: string;
}

const str = (v: unknown): v is string => typeof v === 'string';
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One-line description of an event, or '' when the type is unknown or the payload is invalid. */
export function summarize(ev: LoggedEvent): string {
  try {
    const e = ev as Record<string, unknown>;
    switch (e.type) {
      case 'pos.sample':
        return 'pos';
      case 'player.action':
        return str(e.actionId) ? e.actionId : '';
      case 'player.cancel':
        return str(e.by) && str(e.actionId) ? `${e.by} (${e.actionId})` : '';
      case 'opp.close': {
        if (!str(e.opp_type) || !str(e.outcome)) return '';
        const base = `${e.opp_type} ${e.outcome}`;
        return str(e.reason) ? `${base} (${e.reason})` : base;
      }
      case 'player.hurt':
        return fin(e.dmg) && fin(e.hp_after) ? `dmg=${e.dmg} hp=${e.hp_after}` : '';
      case 'player.stamina_denied':
        return str(e.action) ? `negada ${e.action}` : '';
      case 'player.guard_break':
        return 'guard break';
      case 'item.spawn':
        return str(e.kind) ? `surgiu ${e.kind}` : '';
      case 'item.pickup':
        return str(e.kind) && fin(e.wait_ms) ? `pegou ${e.kind} (${Math.round(e.wait_ms)} ms)` : '';
      case 'item.expire':
        return str(e.kind) ? `sumiu ${e.kind}${str(e.reason) ? ` (${e.reason})` : ''}` : '';
      case 'item.use':
        return str(e.kind) ? `usou ${e.kind}${e.effective === false ? ' (desperdício)' : ''}` : '';
      case 'projectile.hit':
        return fin(e.dmg) ? `projétil acertou dmg=${e.dmg}` : '';
      case 'projectile.expire':
        return 'projétil expirou';
      default:
        return '';
    }
  } catch {
    return '';
  }
}

/** Ring buffer of the last `capacity` events, oldest first when read. */
export class EventTape {
  private readonly slots: (TapeEntry | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private readonly capacity = 40) {
    this.slots = new Array<TapeEntry | undefined>(capacity);
  }

  push(ev: LoggedEvent): void {
    this.slots[this.head] = { seq: ev.seq, t_ms: ev.t_ms, type: ev.type, summary: summarize(ev) };
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Entries from oldest to newest. */
  entries(): TapeEntry[] {
    const out: TapeEntry[] = [];
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const entry = this.slots[(start + i) % this.capacity];
      if (entry) out.push(entry);
    }
    return out;
  }

  clear(): void {
    this.slots.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
