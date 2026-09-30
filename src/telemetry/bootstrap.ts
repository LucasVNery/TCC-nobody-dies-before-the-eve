// src/telemetry/bootstrap.ts
import { ProfileAccumulator } from '../profile/profileAccumulator';
import type { EventStore } from './eventStore';
import { rebuildProfile, nextRunIdx } from './replay';

export interface BootState {
  accumulator: ProfileAccumulator;
  playerId: string;
  firstRunIdx: number;
  /** false when the store failed and the game runs on a fresh in-memory profile. */
  restored: boolean;
}

/**
 * Game start (spec §5.3): player_id from the store (or a new one), profile
 * rebuilt from the stored log, run numbering continued. Any store failure
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
    return { accumulator: rebuildProfile(events), playerId, firstRunIdx: nextRunIdx(events), restored: true };
  } catch (err) {
    console.warn('[telemetry] could not load history, starting with a fresh in-memory profile', err);
    return { accumulator: new ProfileAccumulator(), playerId: newId(), firstRunIdx: 0, restored: false };
  }
}
