import { describe, it, expect } from 'vitest';
import { RefreshGate, needsRebuild } from './analysisPanel';
import type { ViewSection } from './analysisViewModel';

const sec = (cols: string[], ids: string[]): ViewSection => ({
  id: 'events', title: 'Eventos', columns: cols, rows: ids.map((id) => ({ id, cells: cols.map(() => 'x') })),
});

describe('RefreshGate', () => {
  it('is never due when hidden and due at most once per interval when visible', () => {
    const g = new RefreshGate(100);
    expect(g.due(0, false)).toBe(false);
    expect(g.due(0, true)).toBe(true);
    expect(g.due(50, true)).toBe(false);
    expect(g.due(100, true)).toBe(true);
  });
});

describe('needsRebuild', () => {
  it('rebuilds when there is no previous section', () => {
    expect(needsRebuild(null, sec(['a'], ['r1']))).toBe(true);
  });
  it('does not rebuild when columns and ordered row ids are identical', () => {
    expect(needsRebuild(sec(['a', 'b'], ['r1', 'r2']), sec(['a', 'b'], ['r1', 'r2']))).toBe(false);
  });
  it('rebuilds when a row is added, removed or reordered', () => {
    const base = sec(['a'], ['r1', 'r2']);
    expect(needsRebuild(base, sec(['a'], ['r1', 'r2', 'r3']))).toBe(true);
    expect(needsRebuild(base, sec(['a'], ['r1']))).toBe(true);
    expect(needsRebuild(base, sec(['a'], ['r2', 'r1']))).toBe(true);
    expect(needsRebuild(base, sec(['a'], ['r1', 'rX']))).toBe(true);
  });
  it('rebuilds when the columns change', () => {
    expect(needsRebuild(sec(['a'], ['r1']), sec(['a', 'b'], ['r1']))).toBe(true);
    expect(needsRebuild(sec(['a'], ['r1']), sec(['z'], ['r1']))).toBe(true);
  });
});
