// Payload validation for the event types the metrics read. Other types pass.
import type { LoggedEvent } from '../../telemetry/schema';

const OPP_TYPES = new Set(['dodge', 'punish']);
const OUTCOMES = new Set(['taken', 'missed', 'expired', 'invalid']);
const CANCEL_BY = new Set(['move', 'dash', 'attack']);
const DEFENSE_LABELS = new Set(['dodge', 'block', 'parry', 'retreat']);

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const vec2 = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && fin(v[0]) && fin(v[1]);

export function isWellFormed(ev: LoggedEvent): boolean {
  if (ev === null || typeof ev !== 'object') return false;
  const e = ev as Record<string, unknown>;
  if (!str(e.type) || !fin(e.t_ms) || !str(e.session_id)) return false;
  switch (e.type) {
    case 'pos.sample':
      return vec2(e.p) && vec2(e.e);
    case 'player.action':
      return str(e.actionType) && str(e.weaponId);
    case 'player.cancel':
      return str(e.by) && CANCEL_BY.has(e.by);
    case 'player.defense':
      return str(e.label) && DEFENSE_LABELS.has(e.label);
    case 'player.hurt':
    case 'enemy.hurt':
      return fin(e.dmg);
    case 'opp.open':
      return str(e.opp_id) && str(e.opp_type) && OPP_TYPES.has(e.opp_type) && fin(e.window_ms);
    case 'opp.close':
      return (
        str(e.opp_id) && str(e.opp_type) && OPP_TYPES.has(e.opp_type) &&
        str(e.outcome) && OUTCOMES.has(e.outcome)
      );
    case 'run.end':
      return fin(e.duration_ms) && fin(e.rooms_cleared) && fin(e.encounters_cleared);
    default:
      return true;
  }
}
