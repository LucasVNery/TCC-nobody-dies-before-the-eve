import { describe, it, expect } from 'vitest';
import { createPrng } from '../../core/prng';
import { ACTION_REGISTRY } from '../../combat/actionRegistry';
import { makeBotStack } from '../../telemetry/testing/scriptedBot';
import { Encounter } from '../../combat/encounter';
import { primeElite } from '../../combat/testing/eliteTestKit';
import { DEFAULT_HUMANIZER, Humanizer } from './humanizer';
import { PerceptionBuffer, observe } from './perception';
import { AGENT_STYLES, STYLE_IDS, type AgentStyle, type StyleId } from './styles';
import { applyIntent } from './agentRunner';
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
    // The policy runs on simulation time: hit-stop freezes it (recorder.nowMs) while the loop keeps counting.
    const t = stack.recorder.nowMs;
    // Hit-stop freezes the simulation: the agent's inputs during a frozen step
    // would hit a world that does not advance (and be rejected), so it waits.
    if (encounter.hitStop.active) {
      stack.step(STEP);
      continue;
    }
    const now = observe(encounter, t, stack.director.runIdx);
    buffer.push(now);
    const intent = policy.decide({ now, seen: buffer.at(t, PERCEPTION_LAG_MS), nowMs: t });
    const p = encounter.player;
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

/**
 * Pattern scenarios on the real Encounter (Task 2). The elite is primed past its opening delay; the lunge and
 * the long charge also get their cooldowns served (test-only, the same idea as primeElite). Each attempt runs
 * until the pattern is over (the elite is recovering) and records, per strike, whether the player took damage.
 */
type Pattern = 'swing' | 'lunge' | 'combo' | 'slam' | 'charge';
const SCENARIO_SEED = 4242;
const PLAYER_AT = { x: 800, y: 600 };
const ENEMY_OFFSET: Record<Pattern, number> = { swing: 40, combo: 40, slam: 40, lunge: 200, charge: 400 };
/** Dodge-only evasivo: the measure is the timing of the press, not the style's choice among defences. */
const DODGER: AgentStyle = { ...AGENT_STYLES.evasivo, defenseWeights: { dodge: 1, block: 0, parry: 0, none: 0 } };
const NO_LAPSE = { ...DEFAULT_HUMANIZER, lapseProb: 0 };

function freshEncounter(pattern: Pattern, eliteSeed: number): Encounter {
  const encounter = new Encounter(
    { x: PLAYER_AT.x, y: PLAYER_AT.y, width: 20, height: 20 },
    { x: PLAYER_AT.x + ENEMY_OFFSET[pattern], y: PLAYER_AT.y, width: 20, height: 20 },
  );
  const a = encounter.assaltante;
  primeElite(a);
  const cooldowns = a as unknown as { lungeCooldownMs: number; chargeCooldownMs: number };
  cooldowns.lungeCooldownMs = 0;
  cooldowns.chargeCooldownMs = 0;
  a.reseed(eliteSeed);
  return encounter;
}

/** Elite seeds whose first draw at melee range is a plain swing (the weighted draw is random). */
function swingSeeds(n: number): number[] {
  const out: number[] = [];
  for (let s = SCENARIO_SEED; out.length < n; s++) {
    const e = freshEncounter('swing', s);
    e.step(STEP);
    if (e.assaltante.attackKind === 'swing') out.push(s);
  }
  return out;
}

interface Attempt {
  /** One entry per strike (combo: two), true when that strike did no damage. */
  strikesClean: boolean[];
  /** Per strike: a dodge was credited by the engine (i-frames covered the strike). */
  strikesDodged: boolean[];
  dodgesPressed: number;
}

function attempt(pattern: Pattern, k: number, eliteSeed: number): Attempt {
  const encounter = freshEncounter(pattern, eliteSeed);
  const a = encounter.assaltante;
  if (pattern === 'combo' || pattern === 'slam') a.beginPattern(pattern, encounter.player.position);
  const seed = SCENARIO_SEED + k;
  const policy = new AgentPolicy(DODGER, new Humanizer(NO_LAPSE, createPrng(seed).next), createPrng(seed + 1).next);
  const buffer = new PerceptionBuffer();
  let strike = 0;
  const hurtByStrike = [false, false];
  let started = false;
  let dodgesPressed = 0;
  const dodgedByStrike = [false, false];
  encounter.bus.on('enemy.attack_start', (e) => {
    started = true;
    strike = e.hit === 2 ? 1 : 0;
  });
  encounter.bus.on('player.hurt', () => (hurtByStrike[strike] = true));
  encounter.bus.on('player.defense', (e) => {
    if (e.label === 'dodge') dodgedByStrike[strike] = true;
  });
  if (a.state === 'attacking') started = true;
  for (let i = 0; i < Math.round(4000 / STEP); i++) {
    const t = i * STEP;
    const now = observe(encounter, t, 0);
    buffer.push(now);
    const intent = policy.decide({ now, seen: buffer.at(t, PERCEPTION_LAG_MS), nowMs: t });
    const p = encounter.player;
    p.setMoveInput(intent.move.x, intent.move.y);
    p.setSprint(intent.sprint === true);
    p.setAimDirection(intent.aim);
    if (intent.switchTo) p.switchWeapon(intent.switchTo);
    if (intent.block === 'start') p.startBlock();
    if (intent.block === 'stop') p.stopBlock();
    if (intent.dodge) {
      dodgesPressed++;
      p.tryDodge();
    }
    if (intent.startAction) p.tryAction(intent.startAction);
    if (intent.release) p.releaseAction();
    encounter.step(STEP);
    if (started && a.state === 'recovering') break;
  }
  expect(started, `${pattern}#${k}`).toBe(true);
  const strikes = pattern === 'combo' ? 2 : 1;
  return {
    strikesClean: hurtByStrike.slice(0, strikes).map((h) => !h),
    strikesDodged: dodgedByStrike.slice(0, strikes),
    dodgesPressed,
  };
}

describe('AgentPolicy defends every elite pattern on the real engine (Task 2, seed 4242)', () => {
  const N = 20;
  const swings = swingSeeds(N);
  it.each(['swing', 'lunge', 'combo', 'slam', 'charge'] as Pattern[])('%s: a lapse-free dodger takes no damage in >= 60%% of 20 tries per strike', (pattern) => {
    const runs = Array.from({ length: N }, (_, k) => attempt(pattern, k, pattern === 'swing' ? swings[k] : SCENARIO_SEED + k));
    const strikes = pattern === 'combo' ? 2 : 1;
    const pressed = runs.reduce((n, r) => n + r.dodgesPressed, 0);
    for (let s = 0; s < strikes; s++) {
      const clean = runs.filter((r) => r.strikesClean[s]).length / N;
      const dodged = runs.filter((r) => r.strikesDodged[s]).length / N;
      console.log(`[task2] ${pattern}${strikes > 1 ? ` hit ${s + 1}` : ''}: no damage ${(clean * 100).toFixed(0)}%, dodge credited ${(dodged * 100).toFixed(0)}% (presses ${pressed})`);
      expect(clean, `${pattern} strike ${s + 1}`).toBeGreaterThanOrEqual(0.6);
      // the defence is the dodge (not only walking away): the engine credits it on most strikes
      expect(dodged, `${pattern} strike ${s + 1} dodged`).toBeGreaterThanOrEqual(0.6);
    }
  });
});

describe('AgentPolicy on the real engine', () => {
  it.each(['agressivo', 'aleatorio'] as StyleId[])('%s: the policy wastes no charged start in 3 min of play', (id) => {
    const r = play(id, 21, 180_000);
    expect(r.chargedStarts).toBeGreaterThan(5);
    expect(r.bothOnOneTick).toBe(0);
    expect(r.earlyRelease).toBe(0);
    expect(r.rejected / r.chargedStarts).toBeLessThanOrEqual(0.1);
  });
});

describe('sprint and stamina on the real engine (V0.1 Task 3)', () => {
  const run = (id: StyleId, seed: number, ms: number, style: AgentStyle = AGENT_STYLES[id]) => {
    const { stack } = makeBotStack({ sessionId: `sprint-${id}` });
    const { encounter } = stack;
    let denied = 0;
    let actions = 0;
    encounter.bus.on('player.stamina_denied', () => denied++);
    encounter.bus.on('player.action', () => actions++);
    stack.startSession(INFO, null);
    const policy = new AgentPolicy(style, new Humanizer(DEFAULT_HUMANIZER, createPrng(seed).next), createPrng(seed + 1).next);
    const buffer = new PerceptionBuffer();
    let approachMs = 0;
    let approachPx = 0;
    let sprintTicks = 0;
    for (let i = 0; i < Math.round(ms / STEP); i++) {
      const t = stack.recorder.nowMs;
      if (encounter.hitStop.active) {
        stack.step(STEP);
        continue;
      }
      const now = observe(encounter, t, stack.director.runIdx);
      buffer.push(now);
      const intent = policy.decide({ now, seen: buffer.at(t, PERCEPTION_LAG_MS), nowMs: t });
      const before = { ...now.playerPos };
      const far = Math.hypot(now.enemyPos.x - now.playerPos.x, now.enemyPos.y - now.playerPos.y) > 200;
      applyIntent(encounter, intent);
      stack.step(STEP);
      if (intent.sprint === true) sprintTicks++;
      if (far && (intent.move.x !== 0 || intent.move.y !== 0) && !encounter.hitStop.active) {
        const after = encounter.player.position;
        approachMs += STEP;
        approachPx += Math.hypot(after.x - before.x, after.y - before.y);
      }
    }
    return { denied, actions, sprintTicks, approachSpeed: approachMs > 0 ? approachPx / (approachMs / 1000) : 0 };
  };

  it('agressivo (sprintApproach 1) approaches faster than walking speed', () => {
    const r = run('agressivo', 4242, 30_000);
    expect(r.sprintTicks).toBeGreaterThan(0);
    expect(r.approachSpeed).toBeGreaterThan(175);
  });

  it('sprintApproach 0 never sprints on the engine', () => {
    expect(run('agressivo', 4242, 30_000, { ...AGENT_STYLES.agressivo, sprintApproach: 0 }).sprintTicks).toBe(0);
  });

  // spec 4.2(a): 600 simulated seconds per style without a denied press
  it.each(STYLE_IDS)('%s: 600 s with no player.stamina_denied', (id) => {
    const r = run(id, 4242, 600_000);
    expect(r.actions).toBeGreaterThan(50); // the agent really played
    expect(r.denied).toBe(0);
  }, 120_000);
});
