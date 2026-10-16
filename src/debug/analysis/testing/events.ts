// Test helper: builds well-formed LoggedEvents for the analysis modules.
import type { Envelope, LoggedEvent } from '../../../telemetry/schema';

let nextSeq = 0;

export function mk(
  type: string,
  t_ms: number,
  payload: Record<string, unknown> = {},
  env: Partial<Envelope> = {},
): LoggedEvent {
  return {
    v: 2,
    seq: nextSeq++,
    t_ms,
    player_id: 'p',
    session_id: 's',
    run_idx: 0,
    room_idx: 0,
    enc_idx: 0,
    ...payload,
    ...env,
    type,
  } as LoggedEvent;
}
