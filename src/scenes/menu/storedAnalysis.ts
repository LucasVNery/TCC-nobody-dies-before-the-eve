// Read-only analysis input for the menu's Análise screen: the stored history, no live session. No Phaser, no DOM.
import { loadProfileState } from '../../telemetry/bootstrap';
import type { EventStore } from '../../telemetry/eventStore';
import { GAME_VERSION, SCHEMA_VERSION } from '../../telemetry/schema';
import { MetricsAggregator } from '../../debug/analysis/metricsAggregator';
import type { AnalysisInput } from '../../debug/analysis/analysisViewModel';
import { DASH } from '../../debug/analysis/format';

/**
 * Builds the same AnalysisInput ArenaScene feeds buildAnalysisView, from the
 * stored history only: profile rebuilt by loadProfileState, metrics folded from
 * the history, and no live, tape or perf data (rendered as '—'). It never
 * appends an event; loadProfileState may write the `player_id` meta key when
 * the store has none (a fresh player), which is not an event.
 */
export async function loadStoredAnalysis(store: EventStore, newId: () => string): Promise<AnalysisInput> {
  const boot = await loadProfileState(store, newId);
  const aggregator = new MetricsAggregator();
  aggregator.applyAll(boot.history);
  return {
    metrics: aggregator.snapshot(),
    profile: boot.accumulator,
    live: {
      keysDown: [],
      move: { dx: NaN, dy: NaN },
      aimDeg: NaN,
      weaponId: DASH,
      playerState: DASH,
      enemyState: DASH,
      playerHp: NaN,
      enemyHp: NaN,
      stamina: NaN,
    },
    tape: [],
    status: {
      gameVersion: GAME_VERSION,
      schemaV: SCHEMA_VERSION,
      playerId: boot.playerId,
      sessionId: DASH,
      runIdx: 0,
      roomIdx: 0,
      encIdx: 0,
      nextSeq: 0,
      buffered: 0,
      store: 'indexeddb',
      persistent: boot.restored,
      writeFailures: 0,
    },
    perf: { fps: NaN, stepMs: NaN },
  };
}
