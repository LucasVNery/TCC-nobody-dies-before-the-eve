import { describe, it, expect } from 'vitest';
import { findAbandonedRun } from './abandonedRun';
import type { LoggedEvent } from './schema';

function ev(
  session_id: string, seq: number, type: string,
  env: Partial<LoggedEvent> = {}, extra: Record<string, unknown> = {},
): LoggedEvent {
  return { v: 2, seq, t_ms: 0, player_id: 'me', session_id, run_idx: 0, room_idx: 0, enc_idx: 0, type, ...env, ...extra };
}

describe('findAbandonedRun', () => {
  it('null for an empty log, or when the last run has its run.end', () => {
    expect(findAbandonedRun([], 'me')).toBeNull();
    expect(findAbandonedRun([ev('s', 0, 'run.start'), ev('s', 1, 'run.end', {}, { cause: 'death' })], 'me')).toBeNull();
  });

  it('describes the unterminated last run from its stored events', () => {
    const log = [
      ev('s', 0, 'session.start', {}, { wall_clock_iso: '2026-09-30T00:00:00.000Z' }),
      ev('s', 1, 'run.start', { run_idx: 4, t_ms: 100 }),
      ev('s', 2, 'enemy.death', { run_idx: 4, t_ms: 900 }),
      ev('s', 3, 'enemy.death', { run_idx: 4, t_ms: 1900 }),
      ev('s', 4, 'enemy.death', { run_idx: 4, t_ms: 2900 }),
      ev('s', 5, 'profile.snapshot', { run_idx: 4, t_ms: 2900 }, { partial: false }),
      ev('s', 6, 'room.enter', { run_idx: 4, room_idx: 1, t_ms: 2900 }, { room_idx: 1 }),
      ev('s', 7, 'enemy.death', { run_idx: 4, room_idx: 1, t_ms: 3500 }),
      ev('s', 8, 'encounter.start', { run_idx: 4, room_idx: 1, enc_idx: 1, t_ms: 3500 }),
      ev('s', 9, 'pos.sample', { run_idx: 4, room_idx: 1, enc_idx: 1, t_ms: 4000.5 }),
    ];
    expect(findAbandonedRun(log, 'me')).toEqual({
      run_idx: 4, room_idx: 1, enc_idx: 1, duration_ms: 3900.5, rooms_cleared: 1, encounters_cleared: 4,
    });
  });

  it('only looks at the given player', () => {
    const log = [
      ev('a', 0, 'run.start', { player_id: 'me' }),
      ev('a', 1, 'run.end', { player_id: 'me' }, { cause: 'death' }),
      ev('b', 0, 'run.start', { player_id: 'other', run_idx: 3 }),
    ];
    expect(findAbandonedRun(log, 'me')).toBeNull();
    expect(findAbandonedRun(log, 'other')).toMatchObject({ run_idx: 3 });
  });

  it('a later session without runs does not change the result (its session.start is not part of the run)', () => {
    const log = [
      ev('a', 0, 'session.start', {}, { wall_clock_iso: '2026-09-30T00:00:00.000Z' }),
      ev('a', 1, 'run.start', { t_ms: 10 }),
      ev('a', 2, 'pos.sample', { t_ms: 260 }),
      ev('b', 0, 'session.start', { t_ms: 0 }, { wall_clock_iso: '2026-10-01T00:00:00.000Z' }),
    ];
    expect(findAbandonedRun(log, 'me')).toMatchObject({ run_idx: 0, duration_ms: 250 });
  });
});
