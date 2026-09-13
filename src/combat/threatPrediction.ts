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
}

export interface ChaseTelegraphSnapshot {
  state: EnemyState;
  phaseElapsedMs: number;
  position: Vec2; // canto superior esquerdo — mesma convenção de assaltanteRules.distanceToPlayer
  width: number;
  height: number;
  attackDirection: Vec2; // só relevante quando state === 'attacking'
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

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (state === 'idle' || state === 'chasing') {
      const dx = target.x - position.x;
      const dy = target.y - position.y;
      const distance = Math.hypot(dx, dy);

      if (distance <= config.attackRange) {
        state = 'attacking';
        phaseElapsedMs = 0;
        attackDirection = distance > 0 ? normalizeVelocity(dx, dy) : attackDirection;
        continue;
      }

      const closeMs = ((distance - config.attackRange) / config.chaseSpeedPxPerSec) * 1000;
      if (elapsed + closeMs > horizonMs) return null;

      const direction = normalizeVelocity(dx, dy);
      const travel = distance - config.attackRange;
      position = { x: position.x + direction.x * travel, y: position.y + direction.y * travel };
      elapsed += closeMs;
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
    state = 'idle';
    phaseElapsedMs = 0;
  }

  return null;
}
