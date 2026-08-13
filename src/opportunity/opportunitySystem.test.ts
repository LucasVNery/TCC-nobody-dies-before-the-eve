// src/opportunity/opportunitySystem.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from './opportunitySystem';

function makeSystem() {
  const bus = new EventBus<GameEvents>();
  const sys = new OpportunitySystem(bus);
  return { bus, sys };
}

describe('OpportunitySystem', () => {
  it('open() emits opp.open with the given type, src and window', () => {
    const { bus, sys } = makeSystem();
    const handler = vi.fn();
    bus.on('opp.open', handler);
    const id = sys.open('dodge', 'assaltante.attack', 400);
    expect(handler).toHaveBeenCalledWith({ opp_id: id, type: 'dodge', src: 'assaltante.attack', window_ms: 400 });
  });

  it('resolve() emits opp.close with the given outcome and removes it from active', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    const id = sys.open('punish', 'assaltante.recover', 500);
    sys.resolve(id, 'taken');
    expect(closeHandler).toHaveBeenCalledWith({ opp_id: id, type: 'punish', outcome: 'taken' });
    expect(sys.activeOfType('punish')).toHaveLength(0);
  });

  it('step() expires an opportunity once its window elapses', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    const id = sys.open('dodge', 'assaltante.attack', 100);
    sys.step(60);
    expect(closeHandler).not.toHaveBeenCalled();
    sys.step(60); // 120ms total >= 100ms window
    expect(closeHandler).toHaveBeenCalledWith({ opp_id: id, type: 'dodge', outcome: 'expired' });
  });

  it('resolve() on an already-closed opportunity is a no-op', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    const id = sys.open('dodge', 'assaltante.attack', 100);
    sys.step(100);
    bus.on('opp.close', closeHandler);
    sys.resolve(id, 'taken');
    expect(closeHandler).not.toHaveBeenCalled();
  });

  it('activeOfType() tracks multiple concurrent opportunities independently', () => {
    const { sys } = makeSystem();
    const dodgeId = sys.open('dodge', 'assaltante.attack', 400);
    const punishId = sys.open('punish', 'assaltante.recover', 500);
    expect(sys.activeOfType('dodge').map((o) => o.opp_id)).toEqual([dodgeId]);
    expect(sys.activeOfType('punish').map((o) => o.opp_id)).toEqual([punishId]);
  });
});
