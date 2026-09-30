export type EventMap = Record<string, unknown>;

export interface SubscribeOptions {
  /**
   * Run this handler before every handler already registered for the event
   * (default: after). Telemetry uses it so an event is logged before anything
   * its other handlers cause (log order = causal order).
   */
  prepend?: boolean;
}

export class EventBus<T extends EventMap> {
  private listeners: { [K in keyof T]?: Array<(payload: T[K]) => void> } = {};

  on<K extends keyof T>(type: K, handler: (payload: T[K]) => void, options: SubscribeOptions = {}): () => void {
    const arr = this.listeners[type] ?? [];
    if (options.prepend) arr.unshift(handler);
    else arr.push(handler);
    this.listeners[type] = arr;
    return () => {
      this.listeners[type] = (this.listeners[type] ?? []).filter((h) => h !== handler);
    };
  }

  emit<K extends keyof T>(type: K, payload: T[K]): void {
    const arr = this.listeners[type];
    if (!arr) return;
    for (const handler of [...arr]) handler(payload);
  }
}
