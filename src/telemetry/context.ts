// src/telemetry/context.ts
import type { Encounter } from '../combat/encounter';
import type { ProfileSink } from '../profile/profileSink';
import type { Ctx } from './schema';

export const r1 = (n: number): number => Math.round(n * 10) / 10;
export const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Snapshot of the combat situation at the moment of an event — what a
 * sequential predictor (sub-project 5b) needs to condition "what does the
 * player do next" on. `dist` uses the same top-left positions as dim 5.
 */
export function buildCtx(encounter: Encounter<ProfileSink>, msSinceLastAction: number | null): Ctx {
  const p = encounter.player;
  const e = encounter.assaltante;
  const pp = p.position;
  const ep = e.position;
  const aim = p.facing;
  return {
    dist: r1(Math.hypot(ep.x - pp.x, ep.y - pp.y)),
    p_pos: [r1(pp.x), r1(pp.y)],
    e_pos: [r1(ep.x), r1(ep.y)],
    aim: [r3(aim.x), r3(aim.y)],
    p_state: p.state,
    e_state: e.state,
    p_hp: p.hp,
    e_hp: e.hp,
    p_poise: r1(p.poise),
    weapon: p.equippedWeaponId,
    ms_since_last_action: msSinceLastAction === null ? null : r1(msSinceLastAction),
  };
}
