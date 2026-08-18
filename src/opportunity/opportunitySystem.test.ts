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

  it('every opened opportunity gets exactly one opp.close, even with missed/expired/invalid and redundant resolves (denominator conservation)', () => {
    const { bus, sys } = makeSystem();
    const opened = new Set<string>();
    const closeCounts = new Map<string, number>();
    bus.on('opp.open', (e) => opened.add(e.opp_id));
    bus.on('opp.close', (e) => closeCounts.set(e.opp_id, (closeCounts.get(e.opp_id) ?? 0) + 1));

    const a = sys.open('dodge', 'src1', 100);
    sys.resolve(a, 'taken');
    sys.resolve(a, 'taken'); // redundant resolve after close — must not double-count

    const b = sys.open('punish', 'src2', 200);
    sys.step(200); // expires b

    const c = sys.open('dodge', 'src3', 100, () => ({ outcome: 'invalid', reason: 'out_of_range' }));
    sys.step(100); // resolves c via onExpire

    const d = sys.open('dodge', 'src4', 500);
    sys.resolve(d, 'missed', { attempt: 'light_attack' });

    const eOpp = sys.open('punish', 'src5', 100);
    sys.step(100); // expires normally
    sys.resolve(eOpp, 'taken'); // resolve after expiry — must not double-count

    expect(opened.size).toBe(5);
    for (const id of opened) {
      expect(closeCounts.get(id)).toBe(1);
    }
  });

  it('resolving an already-taken opportunity as missed does not re-close it', () => {
    const { bus, sys } = makeSystem();
    const closeHandler = vi.fn();
    const id = sys.open('dodge', 'assaltante.attack', 400);
    sys.resolve(id, 'taken');
    bus.on('opp.close', closeHandler);
    sys.resolve(id, 'missed', { attempt: 'light_attack' });
    expect(closeHandler).not.toHaveBeenCalled();
  });

  it('onExpire is never invoked for an opportunity already resolved before its window elapses', () => {
    const { sys } = makeSystem();
    const onExpire = vi.fn(() => ({ outcome: 'invalid' as const, reason: 'out_of_range' as const }));
    const id = sys.open('punish', 'assaltante.recover', 100, onExpire);
    sys.resolve(id, 'taken');
    sys.step(100);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
