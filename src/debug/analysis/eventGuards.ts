// Payload validation for the event types the metrics read. Other types pass.
import type { LoggedEvent } from '../../telemetry/schema';

const OPP_TYPES = new Set(['dodge', 'punish']);
const OUTCOMES = new Set(['taken', 'missed', 'expired', 'invalid']);
const CANCEL_BY = new Set(['move', 'dash', 'attack']);
const DEFENSE_LABELS = new Set(['dodge', 'block', 'parry', 'retreat']);

const ITEM_KINDS = new Set(['heal', 'power', 'bomb']);

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const vec2 = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && fin(v[0]) && fin(v[1]);

const validSpent = (v: unknown): boolean =>
  v === undefined || (v !== null && typeof v === 'object' && Object.values(v).every(fin));

export function isWellFormed(ev: LoggedEvent): boolean {
  if (ev === null || typeof ev !== 'object') return false;
  const e = ev as Record<string, unknown>;
  if (!str(e.type) || !fin(e.t_ms) || !str(e.session_id)) return false;
  switch (e.type) {
    case 'pos.sample':
      // stam/spent are absent in logs from before 0.0.4: optional, but numeric when present.
      return vec2(e.p) && vec2(e.e) && (e.stam === undefined || fin(e.stam)) && validSpent(e.spent);
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
    case 'player.stamina_denied':
      return str(e.action);
    case 'item.spawn':
    case 'item.expire':
      return str(e.item_id) && str(e.kind) && ITEM_KINDS.has(e.kind);
    case 'item.pickup':
      return str(e.item_id) && str(e.kind) && ITEM_KINDS.has(e.kind) && fin(e.wait_ms);
    case 'item.use':
      return (
        str(e.kind) && ITEM_KINDS.has(e.kind) && fin(e.hp) && fin(e.dist_to_enemy) &&
        fin(e.held_ms) && typeof e.effective === 'boolean'
      );
    case 'projectile.hit':
      return fin(e.id) && fin(e.dmg);
    case 'projectile.expire':
      return fin(e.id);
    default:
      return true;
  }
}
