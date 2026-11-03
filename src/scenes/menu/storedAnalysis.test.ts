import { describe, expect, it } from 'vitest';
import { MemoryEventStore } from '../../telemetry/eventStore';
import { buildAnalysisView } from '../../debug/analysis/analysisViewModel';
import { DASH } from '../../debug/analysis/format';
import { loadStoredAnalysis } from './storedAnalysis';

describe('loadStoredAnalysis', () => {
  it('on an empty store (new player) builds a view without writing any event', async () => {
    const store = new MemoryEventStore();
    const input = await loadStoredAnalysis(store, () => 'player-new');
    expect(await store.readAll()).toEqual([]);
    expect(input.tape).toEqual([]);
    expect(input.metrics.eventCounts).toEqual({});
    expect(input.status.playerId).toBe('player-new');

    const view = buildAnalysisView(input);
    const cells = (sectionId: string) => view.find((s) => s.id === sectionId)!.rows.flatMap((r) => r.cells.slice(1));
    expect(cells('inputs').every((c) => c === DASH || c === `${DASH}, ${DASH}`)).toBe(true);
    expect(cells('perf')).toEqual([DASH, DASH]);
    expect(view.find((s) => s.id === 'events')!.rows).toEqual([]);
  });

  it('keeps an existing player id and does not append to the store', async () => {
    const store = new MemoryEventStore();
    await store.setMeta('player_id', 'player-old');
    const input = await loadStoredAnalysis(store, () => 'unused');
    expect(input.status.playerId).toBe('player-old');
    expect(await store.readAll()).toEqual([]);
  });
});
