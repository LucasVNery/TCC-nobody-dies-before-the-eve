import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';

export class OpportunityOverlay {
  private open = new Map<string, { type: string; src: string }>();

  constructor(
    private bus: EventBus<GameEvents>,
    private render: (lines: string[]) => void,
  ) {
    this.bus.on('opp.open', (e) => {
      this.open.set(e.opp_id, { type: e.type, src: e.src });
      this.renderNow();
    });
    this.bus.on('opp.close', (e) => {
      this.open.delete(e.opp_id);
      this.renderNow();
    });
    this.renderNow();
  }

  private renderNow(): void {
    const lines = [...this.open.values()].map((o) => `${o.type} — OPEN (${o.src})`);
    this.render(lines);
  }
}
