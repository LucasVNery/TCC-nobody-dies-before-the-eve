// Rebuilds the floor from the telemetry log (pure; type-only telemetry import).
import type { LoggedEvent } from '../../telemetry/schema';
import { composeFloorWithSkirt, type FloorLayout, type TileSet } from './composeFloor';
import { floorSeed } from './floorSeed';

/** Fallback run seed when no run.start has been seen. */
export const DEFAULT_FLOOR_SEED = 0x2f0a;

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function floorFromEvents(
  events: readonly LoggedEvent[],
  runIdx: number,
  roomIdx: number,
  colunas: number,
  linhas: number,
  skirt: number,
  tileset: TileSet,
): FloorLayout | null {
  for (const e of events) {
    if (e?.type !== 'run.start' || e.run_idx !== runIdx) continue;
    const seed = finiteNumber(e.seed);
    if (seed === null) return null;
    return composeFloorWithSkirt(floorSeed(seed, roomIdx), colunas, linhas, skirt, tileset);
  }
  return null;
}

export class FloorTracker {
  private seed = DEFAULT_FLOOR_SEED;

  constructor(
    private readonly colunas: number,
    private readonly linhas: number,
    private readonly skirt: number,
    private readonly tileset: TileSet,
  ) {}

  apply(ev: LoggedEvent): FloorLayout | null {
    try {
      if (ev?.type === 'run.start') {
        const seed = finiteNumber(ev.seed);
        if (seed !== null) this.seed = seed;
        return null;
      }
      if (ev?.type === 'room.enter') {
        const room = finiteNumber(ev.room_idx);
        if (room === null) return null;
        return this.build(room);
      }
    } catch {
      return null;
    }
    return null;
  }

  initial(): FloorLayout {
    return this.build(0, DEFAULT_FLOOR_SEED);
  }

  private build(room: number, seed: number = this.seed): FloorLayout {
    return composeFloorWithSkirt(
      floorSeed(seed, room),
      this.colunas,
      this.linhas,
      this.skirt,
      this.tileset,
    );
  }
}
