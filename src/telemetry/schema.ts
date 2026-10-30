// src/telemetry/schema.ts
// Event-log schema v2 (spec 2026-09-30 §4). One LoggedEvent per NDJSON line.

import { DODGE, PERFECT_DODGE_MS, PARRY_WINDOW_MS, INPUT_BUFFER_MS } from '../combat/actionDefs';
import { LUNGE, LONG_LUNGE } from '../combat/movementDefs';
import { ELITE_TELEGRAPH_MS } from '../combat/eliteDefs';

export const SCHEMA_VERSION = 2 as const;

/**
 * Bump whenever gameplay/balance changes make older logs non-comparable
 * (hp, damage, timings, hitbox geometry). Written into every session.start.
 */
export const GAME_VERSION = '0.0.5';

/** Window/timing configuration revision, written into every session.start next to windows_ms. */
export const CONFIG_VERSION = '0.0.5-c2';

/** The timing windows (ms) in force, logged so analyses can tell configurations apart. */
export interface WindowsMs {
  iframes: number;
  perfect: number;
  parry: number;
  buffer: number;
  telegraph_swing: number;
  telegraph_combo: number;
  telegraph_lunge: number;
  telegraph_charge: number;
  telegraph_slam: number;
}

export function windowsMs(): WindowsMs {
  return {
    iframes: DODGE.iframesMs,
    perfect: PERFECT_DODGE_MS,
    parry: PARRY_WINDOW_MS,
    buffer: INPUT_BUFFER_MS,
    telegraph_swing: ELITE_TELEGRAPH_MS.swing,
    telegraph_combo: ELITE_TELEGRAPH_MS.combo,
    telegraph_lunge: LUNGE.telegraphMs,
    telegraph_charge: LONG_LUNGE.telegraphMs,
    telegraph_slam: ELITE_TELEGRAPH_MS.slam,
  };
}

/** The session.start payload; shared by the live session controller and the V0 agent runner. */
export function sessionStartPayload(wallClockIso: string, persistent: boolean): Record<string, unknown> {
  return {
    wall_clock_iso: wallClockIso,
    game_version: GAME_VERSION,
    config_version: CONFIG_VERSION,
    schema_v: SCHEMA_VERSION,
    windows_ms: windowsMs(),
    persistent,
  };
}

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
  p_stam: number;
  weapon: string;
  ms_since_last_action: number | null;
}
