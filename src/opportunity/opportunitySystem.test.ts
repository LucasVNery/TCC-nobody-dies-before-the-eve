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

  it('resolve() with outcome invalid requires and forwards a reason', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    const id = sys.open('punish', 'assaltante.recover', 500);
    sys.resolve(id, 'invalid', { reason: 'out_of_range' });
    expect(closeHandler).toHaveBeenCalledWith({
      opp_id: id,
      type: 'punish',
      outcome: 'invalid',
      reason: 'out_of_range',
    });
  });

  it('resolve() with outcome invalid and no reason throws and does not close the opportunity', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    const id = sys.open('punish', 'assaltante.recover', 500);
    bus.on('opp.close', closeHandler);
    expect(() => sys.resolve(id, 'invalid')).toThrow();
    expect(closeHandler).not.toHaveBeenCalled();
    expect(sys.activeOfType('punish')).toHaveLength(1);
  });

  it('resolve() with outcome missed forwards the attempt', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    const id = sys.open('dodge', 'assaltante.attack', 400);
    sys.resolve(id, 'missed', { attempt: 'light_attack' });
    expect(closeHandler).toHaveBeenCalledWith({
      opp_id: id,
      type: 'dodge',
      outcome: 'missed',
      attempt: 'light_attack',
    });
  });

  it('open() with onExpire uses its result on timeout instead of expired', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    bus.on('opp.close', closeHandler);
    const id = sys.open('punish', 'assaltante.recover', 100, () => ({
      outcome: 'invalid',
      reason: 'out_of_range',
    }));
    sys.step(100);
    expect(closeHandler).toHaveBeenCalledWith({
      opp_id: id,
      type: 'punish',
      outcome: 'invalid',
      reason: 'out_of_range',
    });
  });

  it('every opened opportunity eventually gets exactly one opp.close (denominator conservation)', () => {
    const { bus, sys } = makeSystem();
    const opened = new Set<string>();
    const closed = new Set<string>();
    bus.on('opp.open', (e) => opened.add(e.opp_id));
    bus.on('opp.close', (e) => closed.add(e.opp_id));

    const a = sys.open('dodge', 'src1', 100);
    sys.resolve(a, 'taken');
    const b = sys.open('punish', 'src2', 200);
    sys.step(200); // expires b
    const c = sys.open('dodge', 'src3', 100, () => ({ outcome: 'invalid', reason: 'out_of_range' }));
    sys.step(100); // resolves c via onExpire

    expect(closed).toEqual(opened);
    expect(opened.size).toBe(3);
  });
});
