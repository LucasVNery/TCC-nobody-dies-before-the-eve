import { describe, it, expect } from 'vitest';
import { createPrng } from '../../core/prng';
import { ACTION_REGISTRY } from '../../combat/actionRegistry';
import { makeBotStack } from '../../telemetry/testing/scriptedBot';
import { DEFAULT_HUMANIZER, Humanizer } from './humanizer';
import { PerceptionBuffer, observe } from './perception';
import { AGENT_STYLES, type StyleId } from './styles';
import { AgentPolicy, PERCEPTION_LAG_MS } from './policy';

const STEP = 1000 / 60;
const INFO = { wall_clock_iso: '2026-10-19T00:00:00.000Z', game_version: 'test', schema_v: 2 };

/**
 * Drives the real engine with the documented intent order. Counts the charged
 * starts the policy itself wastes: rejected by the engine (not idle/recovery,
 * wrong weapon, locked) or released before minHoldMs with no defence on that
 * tick. Charges lost to an enemy hit mid-charge, a death or a deliberate
 * defence are game outcomes, reported but not policy errors.
 */
function play(id: StyleId, seed: number, ms: number) {
  const { stack } = makeBotStack({ sessionId: `engine-${id}` });
  const { encounter } = stack;
  let chargedFired = 0;
  encounter.bus.on('player.action', (e) => {
    if (e.actionType === 'charged') chargedFired++;
  });
  stack.startSession(INFO, null);
  const policy = new AgentPolicy(AGENT_STYLES[id], new Humanizer(DEFAULT_HUMANIZER, createPrng(seed).next), createPrng(seed + 1).next);
  const buffer = new PerceptionBuffer();
  let chargedStarts = 0;
  let rejected = 0;
  let earlyRelease = 0;
  let bothOnOneTick = 0;
  for (let i = 0; i < Math.round(ms / STEP); i++) {
    const t = i * STEP;
    const now = observe(encounter, t);
    buffer.push(now);
    const intent = policy.decide({ now, seen: buffer.at(t, PERCEPTION_LAG_MS), nowMs: t });
    const p = encounter.player;
    // Stamina-blind policy (it becomes stamina-aware in a later task): keep stamina out of this charge-handling test.
    p.stamina.refund(100);
    p.setMoveInput(intent.move.x, intent.move.y);
    p.setAimDirection(intent.aim);
    if (intent.switchTo) p.switchWeapon(intent.switchTo);
    if (intent.block === 'start') p.startBlock();
    if (intent.block === 'stop') p.stopBlock();
    if (intent.dodge) p.tryDodge();
    if (intent.startAction) {
      if (intent.release) bothOnOneTick++;
      if (ACTION_REGISTRY.get(intent.startAction)!.actionType === 'charged') {
        chargedStarts++;
        p.tryAction(intent.startAction);
        if (p.state !== 'acting' || p.currentActionDef?.id !== intent.startAction) rejected++;
      } else p.tryAction(intent.startAction);
    }
    if (intent.release) {
      const charging = p.state === 'acting' && p.currentActionDef?.actionType === 'charged' && !p.isInRecovery;
      const firedBefore = chargedFired;
      p.releaseAction();
      const cancelled = charging && chargedFired === firedBefore && p.state === 'idle';
      if (cancelled && !intent.dodge && intent.block !== 'start') earlyRelease++;
    }
    stack.step(STEP);
  }
  return { chargedStarts, chargedFired, rejected, earlyRelease, bothOnOneTick };
}

describe('AgentPolicy on the real engine', () => {
  it.each(['agressivo', 'aleatorio'] as StyleId[])('%s: the policy wastes no charged start in 3 min of play', (id) => {
    const r = play(id, 21, 180_000);
    expect(r.chargedStarts).toBeGreaterThan(5);
    expect(r.bothOnOneTick).toBe(0);
    expect(r.earlyRelease).toBe(0);
    expect(r.rejected / r.chargedStarts).toBeLessThanOrEqual(0.1);
  });
});
