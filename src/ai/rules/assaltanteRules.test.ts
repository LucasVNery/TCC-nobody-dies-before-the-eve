import { describe, expect, it } from 'vitest';
import { createPrng } from '../../core/prng';
import { ELITE_PATTERN_WEIGHTS } from '../../combat/eliteDefs';
import { ASSALTANTE_RULES, choosePatternRule, type Blackboard } from './assaltanteRules';

const bb = (distanceToPlayer: number, lungeReady = false, patternReady = true): Blackboard => ({
  distanceToPlayer,
  state: 'idle',
  lungeReady,
  patternReady,
});

/** Ids of the rules whose precondition holds (the eligible patterns, then chase). */
const eligible = (b: Blackboard) => ASSALTANTE_RULES.filter((r) => r.precond(b)).map((r) => r.id);

describe('ASSALTANTE_RULES', () => {
  it('lists the patterns and chase, in that order', () => {
    expect(ASSALTANTE_RULES.map((r) => r.id)).toEqual([
      'assaltante.attack',
      'assaltante.combo',
      'assaltante.slam',
      'assaltante.lunge',
      'assaltante.chase',
    ]);
  });

  it('tags every attack pattern as a dodge opportunity and chase as none', () => {
    for (const r of ASSALTANTE_RULES) {
      expect(r.opportunity_tags).toEqual(r.id === 'assaltante.chase' ? {} : { dodge: 1 });
    }
  });

  it('swing and combo need d <= 60; the slam d <= 60 (melee only); the lunge a ready cooldown and d in [150, 260]', () => {
    expect(eligible(bb(60))).toEqual(['assaltante.attack', 'assaltante.combo', 'assaltante.slam', 'assaltante.chase']);
    expect(eligible(bb(61))).toEqual(['assaltante.chase']);
    expect(eligible(bb(140))).toEqual(['assaltante.chase']);
    expect(eligible(bb(149, true))).toEqual(['assaltante.chase']);
    expect(eligible(bb(150, true))).toEqual(['assaltante.lunge', 'assaltante.chase']);
    expect(eligible(bb(260, true))).toEqual(['assaltante.lunge', 'assaltante.chase']);
    expect(eligible(bb(261, true))).toEqual(['assaltante.chase']);
    expect(eligible(bb(200, false))).toEqual(['assaltante.chase']);
  });

  it('nothing but chase while the pause or the opening delay is running', () => {
    for (const d of [30, 100, 200]) expect(eligible(bb(d, true, false))).toEqual(['assaltante.chase']);
  });
});

describe('choosePatternRule', () => {
  it('chases when no pattern is eligible, without consuming the PRNG', () => {
    const prng = createPrng(1);
    const peek = createPrng(1).next();
    expect(choosePatternRule(bb(300, true), prng).id).toBe('assaltante.chase');
    expect(prng.next()).toBe(peek);
  });

  it('a single eligible pattern is always the one chosen', () => {
    const prng = createPrng(9);
    for (let i = 0; i < 50; i++) {
      expect(choosePatternRule(bb(100), prng).id).toBe('assaltante.chase');
      expect(choosePatternRule(bb(200, true), prng).id).toBe('assaltante.lunge');
    }
  });

  it('is deterministic by seed', () => {
    const draw = (seed: number) => {
      const prng = createPrng(seed);
      return Array.from({ length: 200 }, () => choosePatternRule(bb(50), prng).id);
    };
    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(43));
  });

  it('pins the literal pattern weights', () => {
    expect(ELITE_PATTERN_WEIGHTS).toEqual({ swing: 4, combo: 2, lunge: 2, slam: 1.5 });
  });

  it('at 50 u the swing, combo and slam follow 4 : 2 : 1.5 over 4000 draws (+-5% absolute, literal shares)', () => {
    const prng = createPrng(2026);
    const counts: Record<string, number> = {};
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const id = choosePatternRule(bb(50), prng).id;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['assaltante.attack', 'assaltante.combo', 'assaltante.slam']);
    expect(Math.abs(counts['assaltante.attack'] / N - 0.5333)).toBeLessThan(0.05); // 4 / 7.5
    expect(Math.abs(counts['assaltante.combo'] / N - 0.2667)).toBeLessThan(0.05); // 2 / 7.5
    expect(Math.abs(counts['assaltante.slam'] / N - 0.2)).toBeLessThan(0.05); // 1.5 / 7.5
  });
});
