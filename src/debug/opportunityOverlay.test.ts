import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunityOverlay } from './opportunityOverlay';

describe('OpportunityOverlay', () => {
  it('renders an empty list initially', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new OpportunityOverlay(bus, render);
    expect(render).toHaveBeenCalledWith([]);
  });

  it('adds a line when an opportunity opens', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new OpportunityOverlay(bus, render);
    bus.emit('opp.open', { opp_id: 'opp_1', type: 'dodge', src: 'assaltante.attack', window_ms: 400 });
    expect(render).toHaveBeenLastCalledWith(['dodge — OPEN (assaltante.attack)']);
  });

  it('removes the line when the opportunity closes', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new OpportunityOverlay(bus, render);
    bus.emit('opp.open', { opp_id: 'opp_1', type: 'punish', src: 'assaltante.recover', window_ms: 500 });
    bus.emit('opp.close', { opp_id: 'opp_1', type: 'punish', outcome: 'taken' });
    expect(render).toHaveBeenLastCalledWith([]);
  });

  it('tracks multiple concurrent opportunities independently', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new OpportunityOverlay(bus, render);
    bus.emit('opp.open', { opp_id: 'opp_1', type: 'dodge', src: 'assaltante.attack', window_ms: 400 });
    bus.emit('opp.open', { opp_id: 'opp_2', type: 'punish', src: 'assaltante.recover', window_ms: 500 });
    bus.emit('opp.close', { opp_id: 'opp_1', type: 'dodge', outcome: 'expired' });
    expect(render).toHaveBeenLastCalledWith(['punish — OPEN (assaltante.recover)']);
  });
});
