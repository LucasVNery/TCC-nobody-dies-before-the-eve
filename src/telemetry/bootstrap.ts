// src/telemetry/bootstrap.ts
import { ProfileAccumulator } from '../profile/profileAccumulator';
import type { EventStore } from './eventStore';
import { rebuildProfileWithStats, nextRunIdx } from './replay';
import { findAbandonedRun, type AbandonedRun } from './abandonedRun';

export interface BootState {
  accumulator: ProfileAccumulator;
  playerId: string;
  firstRunIdx: number;
  /** false when the store failed and the game runs on a fresh in-memory profile. */
  restored: boolean;
  /** The current player's last run when the previous session left it open (tab closed); close it before starting. */
  abandonedRun: AbandonedRun | null;
}

/**
 * Game start (spec §5.3): player_id from the store (or a new one), profile
 * rebuilt from the stored log, run numbering continued, and an
 * unterminated last run reported so it can be closed. Any store failure
 * degrades to a fresh profile — the game must never fail to start because of
 * telemetry.
 */
export async function loadProfileState(store: EventStore, newId: () => string): Promise<BootState> {
  try {
    let playerId = await store.getMeta<string>('player_id');
    if (!playerId) {
      playerId = newId();
      await store.setMeta('player_id', playerId);
    }
    const events = await store.readAll();
    // Only the current player's events count: an import can leave other
    // players' history in the store (spec §5.3).
    const { accumulator, skipped } = rebuildProfileWithStats(events, playerId);
    if (skipped > 0) {
      console.warn(`[telemetry] skipped ${skipped} malformed observation(s) while rebuilding the profile`);
    }
    return {
      accumulator,
      playerId,
      firstRunIdx: nextRunIdx(events, playerId),
      restored: true,
      abandonedRun: findAbandonedRun(events, playerId),
    };
  } catch (err) {
    console.warn('[telemetry] could not load history, starting with a fresh in-memory profile', err);
    return { accumulator: new ProfileAccumulator(), playerId: newId(), firstRunIdx: 0, restored: false, abandonedRun: null };
  }
}
