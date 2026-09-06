import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { HudState } from './hudState';

describe('HudState', () => {
  it('starts with zeroed counters', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    expect(render).toHaveBeenCalledWith({
      dashAttempts: 0,
      effectiveDashes: 0,
      wastedDashes: 0,
      bossHitsLanded: 0,
    });
  });

  it('counts a dodge as a dash attempt', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    bus.emit('player.dodge', {});
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({ dashAttempts: 1, wastedDashes: 1 }),
    );
  });

  it('does not count a light attack as a dash attempt', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    bus.emit('player.action', { actionId: 'sword_shield.light', actionType: 'light', weaponId: 'sword_shield' });
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ dashAttempts: 0 }));
  });

  it('a dash opportunity resolved as taken counts as effective, not wasted', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    bus.emit('player.dodge', {});
    bus.emit('opp.close', { opp_id: 'opp_1', type: 'dodge', outcome: 'taken' });
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({ dashAttempts: 1, effectiveDashes: 1, wastedDashes: 0 }),
    );
  });

  it('a dash opportunity resolved as expired does not count as effective', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    bus.emit('player.dodge', {});
    bus.emit('opp.close', { opp_id: 'opp_1', type: 'dodge', outcome: 'expired' });
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({ dashAttempts: 1, effectiveDashes: 0, wastedDashes: 1 }),
    );
  });

  it('a punish opportunity resolved as taken counts as a boss hit landed', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    bus.emit('opp.close', { opp_id: 'opp_1', type: 'punish', outcome: 'taken' });
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ bossHitsLanded: 1 }));
  });

  it('a punish opportunity resolved as expired does not count as a boss hit landed', () => {
    const bus = new EventBus<GameEvents>();
    const render = vi.fn();
    new HudState(bus, render);
    bus.emit('opp.close', { opp_id: 'opp_1', type: 'punish', outcome: 'expired' });
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ bossHitsLanded: 0 }));
  });
});
