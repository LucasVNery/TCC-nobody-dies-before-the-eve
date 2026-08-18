import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';

export interface HudCounters {
  dashAttempts: number;
  effectiveDashes: number;
  wastedDashes: number;
  bossHitsLanded: number;
}

export class HudState {
  private dashAttempts = 0;
  private effectiveDashes = 0;
  private bossHitsLanded = 0;

  constructor(
    private bus: EventBus<GameEvents>,
    private render: (counters: HudCounters) => void,
  ) {
    this.bus.on('player.action', (e) => {
      if (e.action !== 'dodge') return;
      this.dashAttempts += 1;
      this.renderNow();
    });
    this.bus.on('opp.close', (e) => {
      if (e.type === 'dodge' && e.outcome === 'taken') {
        this.effectiveDashes += 1;
        this.renderNow();
      }
      if (e.type === 'punish' && e.outcome === 'taken') {
        this.bossHitsLanded += 1;
        this.renderNow();
      }
    });
    this.renderNow();
  }

  private renderNow(): void {
    this.render({
      dashAttempts: this.dashAttempts,
      effectiveDashes: this.effectiveDashes,
      wastedDashes: Math.max(0, this.dashAttempts - this.effectiveDashes),
      bossHitsLanded: this.bossHitsLanded,
    });
  }
}
