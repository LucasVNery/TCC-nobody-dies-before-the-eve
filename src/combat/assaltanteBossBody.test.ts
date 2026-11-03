// src/combat/assaltanteBossBody.test.ts
// Boss body (UI structure spec §6.1): the hurtbox and every reach scale by bodyScale, centred, only in boss mode.
import { describe, it, expect } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from '../opportunity/opportunitySystem';
import { AssaltanteController, TELEGRAPH_MS } from './assaltanteController';
import { primeElite } from './testing/eliteTestKit';
import { ARENA_BOUNDS, ATTACK_REACH, LUNGE } from './movementDefs';
import { ELITE, ELITE_TELEGRAPH_MS } from './eliteDefs';
import { sectorOverlapsBox } from './sector';
import type { AABB, Vec2 } from './types';

const SIZE = 20;
const SCALE = 1.7;

function makeEnemy(x = 500, y = 500) {
  const bus = new EventBus<GameEvents>();
  const opp = new OpportunitySystem(bus);
  const enemy = new AssaltanteController(bus, opp, { x, y, width: SIZE, height: SIZE });
  return { bus, opp, enemy };
}

function boss(scale: number, x = 500, y = 500) {
  const ctx = makeEnemy(x, y);
  ctx.enemy.configureBoss({ maxHp: 400, advanceMult: 1, bodyScale: scale });
  return ctx;
}

function centreOf(box: AABB): Vec2 {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Top-left of a 20×20 player whose centre is `dx`,`dy` from the enemy's centre. */
function playerAt(enemy: AssaltanteController, dx: number, dy = 0): Vec2 {
  const c = centreOf(enemy.hurtbox());
  return { x: c.x + dx - SIZE / 2, y: c.y + dy - SIZE / 2 };
}

function playerBox(pos: Vec2): AABB {
  return { x: pos.x, y: pos.y, width: SIZE, height: SIZE };
}

describe('AssaltanteController — boss body', () => {
  it('outside boss mode the body is 20×20 at scale 1', () => {
    const { enemy } = makeEnemy();
    expect(enemy.bodyScale).toBe(1);
    expect(enemy.bodySize).toEqual({ width: 20, height: 20 });
  });

  it('configureBoss grows the hurtbox to 34×34 around the same centre', () => {
    const { enemy } = makeEnemy();
    const before = centreOf(enemy.hurtbox());
    enemy.configureBoss({ maxHp: 400, advanceMult: 1, bodyScale: SCALE });
    const box = enemy.hurtbox();
    expect(box.width).toBeCloseTo(34, 9);
    expect(box.height).toBeCloseTo(34, 9);
    expect(enemy.bodySize.width).toBeCloseTo(34, 9);
    expect(enemy.bodyScale).toBe(SCALE);
    const after = centreOf(box);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it.each([
    ['top-left', 0, 0],
    ['bottom-right', ARENA_BOUNDS.width - SIZE, ARENA_BOUNDS.height - SIZE],
  ])('in the %s corner the grown hurtbox stays inside the arena', (_name, x, y) => {
    const { enemy } = boss(SCALE, x, y);
    const box = enemy.hurtbox();
    expect(box.x).toBeGreaterThanOrEqual(ARENA_BOUNDS.x);
    expect(box.y).toBeGreaterThanOrEqual(ARENA_BOUNDS.y);
    expect(box.x + box.width).toBeLessThanOrEqual(ARENA_BOUNDS.x + ARENA_BOUNDS.width + 1e-9);
    expect(box.y + box.height).toBeLessThanOrEqual(ARENA_BOUNDS.y + ARENA_BOUNDS.height + 1e-9);
  });

  describe('swing reach', () => {
    // Centre distance 80: past the normal reach (55 + the player's half box) but inside the boss's (93.5).
    const GAP = 80;

    function strikeHits(scale: number): boolean {
      const { enemy } = boss(scale);
      const player = playerAt(enemy, GAP);
      enemy.beginPattern('combo', player);
      enemy.step(TELEGRAPH_MS, player); // strike 1 is now active
      const hitbox = enemy.attackHitbox();
      expect(hitbox).not.toBeNull();
      return sectorOverlapsBox(hitbox!, playerBox(player));
    }

    it('the boss strike lands on a player between the normal and the boss reach', () => {
      expect(strikeHits(SCALE)).toBe(true);
    });

    it('control: the same strike at scale 1 misses', () => {
      expect(strikeHits(1)).toBe(false);
    });

    it('a plain enemy (no boss mode) misses too', () => {
      const { enemy } = makeEnemy();
      const player = playerAt(enemy, GAP);
      enemy.beginPattern('combo', player);
      enemy.step(TELEGRAPH_MS, player);
      expect(sectorOverlapsBox(enemy.attackHitbox()!, playerBox(player))).toBe(false);
    });

    it('the reach is ATTACK_REACH × scale + half the width', () => {
      const { enemy } = boss(SCALE);
      const player = playerAt(enemy, GAP);
      enemy.beginPattern('combo', player);
      enemy.step(TELEGRAPH_MS, player);
      expect(enemy.attackHitbox()!.reach).toBeCloseTo(ATTACK_REACH * SCALE + (SIZE * SCALE) / 2, 9);
    });

    it('the boss decides to attack at that distance; the control enemy keeps chasing', () => {
      const attacks = (scale: number): boolean => {
        const { enemy } = boss(scale);
        primeElite(enemy);
        enemy.reseed(4242);
        enemy.step(16, playerAt(enemy, 90));
        return enemy.state === 'attacking';
      };
      expect(attacks(SCALE)).toBe(true);
      expect(attacks(1)).toBe(false);
    });

    it('threat prediction follows the scaled decision range and reach', () => {
      const threat = (scale: number): number | null => {
        const { enemy } = boss(scale);
        primeElite(enemy);
        return enemy.msUntilThreatens(playerBox(playerAt(enemy, 90)), 10_000);
      };
      expect(threat(SCALE)).toBe(TELEGRAPH_MS); // already in range: strikes after the wind-up
      expect(threat(1)!).toBeGreaterThan(TELEGRAPH_MS); // has to close in first
    });
  });

  it('the slam radius grows by the same factor', () => {
    const { enemy } = boss(SCALE);
    const player = playerAt(enemy, 40);
    enemy.beginPattern('slam', player);
    const t = enemy.telegraph!;
    expect(t.radius).toBeCloseTo(ELITE.slamRadius * SCALE, 9);
    expect(t.reach).toBeCloseTo(ELITE.slamRadius * SCALE + (SIZE * SCALE) / 2, 9);
    enemy.step(ELITE_TELEGRAPH_MS.slam, player);
    expect(enemy.attackHitbox()!.reach).toBeCloseTo(t.reach, 9);
  });

  describe('lunge contact', () => {
    function startCharge(scale: number) {
      const { enemy } = boss(scale, 100, 600);
      for (let t = 0; t < LUNGE.cooldownMs; t += 16) enemy.step(16, { x: -5000, y: 600 });
      const target = playerAt(enemy, 200);
      enemy.step(1, target);
      expect(enemy.state).toBe('lunging');
      const telegraph = enemy.telegraph!;
      enemy.step(LUNGE.telegraphMs - 1, target);
      expect(enemy.lungePhase).toBe('charge');
      return { enemy, telegraph };
    }

    it('the telegraph contact distance grows by the factor', () => {
      expect(startCharge(SCALE).telegraph.contactDistance).toBeCloseTo(LUNGE.contactDistance * SCALE, 9);
      expect(startCharge(1).telegraph.contactDistance).toBe(LUNGE.contactDistance);
    });

    it('a player 80 px beside the charging boss is hit; at scale 1 they are not', () => {
      const lands = (scale: number): boolean => {
        const { enemy } = startCharge(scale);
        enemy.step(16, playerAt(enemy, 0, 80));
        return enemy.strikeLanding();
      };
      expect(lands(SCALE)).toBe(true);
      expect(lands(1)).toBe(false);
    });
  });

  it('the swing telegraph reach equals the live hitbox reach', () => {
    const { enemy } = boss(SCALE);
    const player = playerAt(enemy, 40);
    enemy.beginPattern('combo', player);
    const reach = enemy.telegraph!.reach;
    enemy.step(TELEGRAPH_MS, player);
    expect(enemy.attackHitbox()!.reach).toBeCloseTo(reach, 12);
  });

  it('respawn restores the 20×20 body, scale 1 and the normal reach', () => {
    const { enemy } = boss(SCALE);
    enemy.respawn({ x: 300, y: 300 }, 'source_interrupted');
    expect(enemy.bodyScale).toBe(1);
    expect(enemy.bodySize).toEqual({ width: 20, height: 20 });
    expect(enemy.hurtbox()).toEqual({ x: 300, y: 300, width: 20, height: 20 });
    const player = playerAt(enemy, 40);
    enemy.beginPattern('combo', player);
    expect(enemy.telegraph!.reach).toBe(ATTACK_REACH + SIZE / 2);
  });

  it('clearBoss restores the 20×20 body and scale 1 around the same centre', () => {
    const { enemy } = boss(SCALE);
    const before = centreOf(enemy.hurtbox());
    enemy.clearBoss();
    expect(enemy.bodyScale).toBe(1);
    expect(enemy.bodySize).toEqual({ width: 20, height: 20 });
    const after = centreOf(enemy.hurtbox());
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    enemy.beginPattern('combo', playerAt(enemy, 40));
    expect(enemy.telegraph!.reach).toBe(ATTACK_REACH + SIZE / 2);
  });
});
