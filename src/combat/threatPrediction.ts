// src/combat/threatPrediction.ts
import type { AABB, EnemyState, Vec2 } from './types';
import { normalizeVelocity } from './movement';
import { directionalSector, sectorOverlapsBox } from './sector';

export interface ChaseTelegraphConfig {
  attackRange: number; // distância na qual o inimigo entra em 'attacking'
  chaseSpeedPxPerSec: number;
  telegraphMs: number;
  swingMs: number;
  recoveryMs: number;
  reach: number; // alcance efetivo do leque (já inclui a metade da largura do atacante)
  halfAngleRad: number;
  /** Mandatory idle time after a recovery before the next attack may start (0 when the enemy has none). */
  patternPauseMs?: number;
}

export interface ChaseTelegraphSnapshot {
  state: EnemyState;
  phaseElapsedMs: number;
  position: Vec2; // canto superior esquerdo — mesma convenção de assaltanteRules.distanceToPlayer
  width: number;
  height: number;
  /**
   * Offset from `position` to the point distances are measured from (the top-left a base-size body with the
   * same centre would have). Set only for a grown boss body; absent = 0, the plain elite's arithmetic.
   */
  anchorOffset?: Vec2;
  attackDirection: Vec2; // só relevante quando state === 'attacking'
  /** Idle/chasing only: ms until the enemy may start an attack at all (opening delay or pause still running). */
  readyInMs?: number;
}

const MAX_ITERATIONS = 8;

export function predictThreatMs(
  config: ChaseTelegraphConfig,
  snapshot: ChaseTelegraphSnapshot,
  target: AABB,
  horizonMs: number,
): number | null {
  let elapsed = 0;
  let state = snapshot.state;
  let phaseElapsedMs = snapshot.phaseElapsedMs;
  let position = { ...snapshot.position };
  let attackDirection = snapshot.attackDirection;
  let readyAt = snapshot.readyInMs ?? 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (state === 'idle' || state === 'chasing') {
      const off = snapshot.anchorOffset;
      const dx = off ? target.x - (position.x + off.x) : target.x - position.x;
      const dy = off ? target.y - (position.y + off.y) : target.y - position.y;
      const distance = Math.hypot(dx, dy);

      // The earliest possible attack: the enemy has closed to attack range and its pause is over.
      const inRange = distance <= config.attackRange;
      const travel = inRange ? 0 : distance - config.attackRange;
      const startAt = Math.max(elapsed + (travel / config.chaseSpeedPxPerSec) * 1000, readyAt);
      if (startAt > horizonMs) return null;

      const direction = distance > 0 ? normalizeVelocity(dx, dy) : attackDirection;
      position = { x: position.x + direction.x * travel, y: position.y + direction.y * travel };
      elapsed = startAt;
      state = 'attacking';
      phaseElapsedMs = 0;
      attackDirection = direction;
      continue;
    }

    if (state === 'attacking') {
      const center = { x: position.x + snapshot.width / 2, y: position.y + snapshot.height / 2 };
      const sector = directionalSector(center, attackDirection, config.reach, config.halfAngleRad);
      const timeToActive = Math.max(0, config.telegraphMs - phaseElapsedMs);
      const timeToRecover = config.telegraphMs + config.swingMs - phaseElapsedMs;

      // A hit landing at exactly the last millisecond of the horizon still
      // counts as a threat, not as safe — the player is considered locked
      // through that instant, so `<=` (not `<`) is intentional here.
      if (elapsed + timeToActive <= horizonMs && sectorOverlapsBox(sector, target)) {
        return elapsed + timeToActive;
      }

      if (elapsed + timeToRecover > horizonMs) return null;
      elapsed += timeToRecover;
      state = 'recovering';
      phaseElapsedMs = 0;
      continue;
    }

    // state === 'recovering'
    const timeToIdle = config.recoveryMs - phaseElapsedMs;
    if (elapsed + timeToIdle > horizonMs) return null;
    elapsed += timeToIdle;
    readyAt = elapsed + (config.patternPauseMs ?? 0);
    state = 'idle';
    phaseElapsedMs = 0;
  }

  return null;
}
