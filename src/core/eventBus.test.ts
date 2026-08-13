import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './eventBus';

interface TestEvents {
  ping: { n: number };
  pong: { msg: string };
}

describe('EventBus', () => {
  it('calls subscribed handler with the emitted payload', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('ping', handler);
    bus.emit('ping', { n: 1 });
    expect(handler).toHaveBeenCalledWith({ n: 1 });
  });

  it('calls multiple handlers for the same event', () => {
    const bus = new EventBus<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('ping', h1);
    bus.on('ping', h2);
    bus.emit('ping', { n: 2 });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('does not call handlers of a different event type', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('pong', handler);
    bus.emit('ping', { n: 3 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe stops future calls', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsubscribe = bus.on('ping', handler);
    unsubscribe();
    bus.emit('ping', { n: 4 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('emit with no subscribers does not throw', () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit('ping', { n: 5 })).not.toThrow();
  });
});
