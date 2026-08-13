export type EventMap = Record<string, unknown>;

export class EventBus<T extends EventMap> {
  private listeners: { [K in keyof T]?: Array<(payload: T[K]) => void> } = {};

  on<K extends keyof T>(type: K, handler: (payload: T[K]) => void): () => void {
    const arr = this.listeners[type] ?? [];
    arr.push(handler);
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
