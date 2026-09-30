// src/telemetry/schema.ts
// Event-log schema v2 (spec 2026-09-30 §4). One LoggedEvent per NDJSON line.

export const SCHEMA_VERSION = 2 as const;

/**
 * Bump whenever gameplay/balance changes make older logs non-comparable
 * (hp, damage, timings, hitbox geometry). Written into every session.start.
 */
export const GAME_VERSION = '0.0.1+5a';

export interface Envelope {
  v: typeof SCHEMA_VERSION;
  /** Monotonic per session, from 0. (session_id, seq) is the unique key. */
  seq: number;
  /** Simulation time in ms (sum of fixed steps), rounded to 0.1. */
  t_ms: number;
  player_id: string;
  session_id: string;
  run_idx: number;
  room_idx: number;
  enc_idx: number;
  type: string;
}

export type LoggedEvent = Envelope & Record<string, unknown>;

export type LogFn = (type: string, payload: Record<string, unknown>) => void;

/** Combat context attached to every combat event (spec §4.3). */
export interface Ctx {
  dist: number;
  p_pos: [number, number];
  e_pos: [number, number];
  aim: [number, number];
  p_state: string;
  e_state: string;
  p_hp: number;
  e_hp: number;
  p_poise: number;
  weapon: string;
  ms_since_last_action: number | null;
}
