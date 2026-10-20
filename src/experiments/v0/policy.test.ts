/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { createPrng } from '../../core/prng';
import { ACTION_REGISTRY, WEAPON_IDS } from '../../combat/actionRegistry';
import type { EnemyState, Vec2 } from '../../combat/types';
import { DEFAULT_HUMANIZER, Humanizer, type HumanizerConfig } from './humanizer';
import type { Observation } from './perception';
import { AGENT_STYLES, STYLE_IDS, type AgentStyle, type StyleId } from './styles';
import { AgentPolicy, PERCEPTION_LAG_MS, type AgentIntent } from './policy';

const STEP = 1000 / 60;
const NO_LAPSE: HumanizerConfig = { ...DEFAULT_HUMANIZER, lapseProb: 0 };
const ALL_ACTIONS = [...ACTION_REGISTRY.keys()];

function makePolicy(id: StyleId, seed = 1, cfg: HumanizerConfig = NO_LAPSE, style?: AgentStyle): AgentPolicy {
  return new AgentPolicy(style ?? AGENT_STYLES[id], new Humanizer(cfg, createPrng(seed * 2 + 1).next), createPrng(seed * 2 + 2).next);
}

interface World {
  enemyState: EnemyState;
  /** enemy offset from the player */
  offset: Vec2;
}

const PLAYER_POS = { x: 800, y: 600 };

function obsOf(tMs: number, w: World, body: { weapon: string; blocking: boolean }): Observation {
  return {
    tMs,
    enemyState: w.enemyState,
    enemyPos: { x: PLAYER_POS.x + w.offset.x, y: PLAYER_POS.y + w.offset.y },
    playerPos: { x: PLAYER_POS.x, y: PLAYER_POS.y },
    playerHp: 100,
    playerPoise: 100,
    isBlocking: body.blocking,
    equippedWeaponId: body.weapon,
    enemyDead: false,
  };
}

interface Step {
  t: number;
  seenState: EnemyState | null;
  intent: AgentIntent;
}

/**
 * Drives a policy against a scripted world with a minimal body: switchTo
 * equips the weapon, block start/stop toggles isBlocking. `seen` lags by
 * PERCEPTION_LAG_MS, as the runner will deliver it.
 */
function drive(
  policy: AgentPolicy,
  steps: number,
  world: (tMs: number) => World,
  startWeapon = 'sword_shield',
  until?: (log: Step[]) => boolean,
): Step[] {
  const body = { weapon: startWeapon, blocking: false };
  const log: Step[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i * STEP;
    const seenT = t - PERCEPTION_LAG_MS;
    const seen = seenT >= 0 ? obsOf(seenT, world(seenT), body) : null;
    const now = obsOf(t, world(t), body);
    const intent = policy.decide({ now, seen, nowMs: t });
    if (intent.switchTo) body.weapon = intent.switchTo;
    if (intent.block === 'start') body.blocking = true;
    if (intent.block === 'stop') body.blocking = false;
    log.push({ t, seenState: seen ? seen.enemyState : null, intent });
    if (until && until(log)) break;
  }
  return log;
}

/** chasing 300 ms, attacking 550 ms (telegraph 400 + swing 150), recovering 500 ms, repeat. */
const CYCLE_MS = 1350;
function cycleWorld(dist: number): (t: number) => World {
  return (t) => {
    const p = ((t % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
    const enemyState: EnemyState = p < 300 ? 'chasing' : p < 850 ? 'attacking' : 'recovering';
    return { enemyState, offset: { x: dist, y: 0 } };
  };
}
const still = (enemyState: EnemyState, dist: number) => (): World => ({ enemyState, offset: { x: dist, y: 0 } });

const starts = (log: Step[]) => log.filter((s) => s.intent.startAction).map((s) => s.intent.startAction!);
const isDefense = (i: AgentIntent) => i.dodge === true || i.block === 'start';

describe('AGENT_STYLES', () => {
  it('lists the seven styles in order, referencing only registered weapons and actions', () => {
    expect(STYLE_IDS).toEqual(['agressivo', 'evasivo', 'bloqueador', 'paciente', 'variado', 'repetitivo', 'aleatorio']);
    for (const id of STYLE_IDS) {
      const s = AGENT_STYLES[id];
      expect(s.id).toBe(id);
      for (const w of Object.keys(s.weaponWeights)) expect(WEAPON_IDS).toContain(w);
      for (const a of Object.keys(s.actionWeights)) expect(ALL_ACTIONS).toContain(a);
      // every weapon the style may pick has at least one weighted action
      for (const [w, ww] of Object.entries(s.weaponWeights)) {
        if (ww <= 0) continue;
        const usable = ALL_ACTIONS.filter((a) => ACTION_REGISTRY.get(a)!.weaponId === w && (s.actionWeights[a] ?? 0) > 0);
        expect(usable.length, `${id}/${w}`).toBeGreaterThan(0);
      }
    }
  });

  it('style parameters keep the qualities their names promise', () => {
    const S = AGENT_STYLES;
    for (const id of STYLE_IDS) if (id !== 'agressivo') expect(S.agressivo.attackCooldownMs).toBeLessThan(S[id].attackCooldownMs);
    expect(S.evasivo.preferredDistance).toBeGreaterThan(S.agressivo.preferredDistance);
    expect(S.evasivo.weaponWeights.bow).toBeGreaterThan(S.evasivo.weaponWeights.sword_shield ?? 0);
    const d = S.bloqueador.defenseWeights;
    expect(d.block + d.parry).toBeGreaterThan(d.dodge + d.none);
    expect(S.paciente.waitForOpening).toBe(true);
    expect(S.agressivo.waitForOpening).toBe(false);
    expect(S.agressivo.defenseWeights.none).toBeGreaterThan(0.5);
    expect(S.variado.weaponSwitchPerMin).toBeGreaterThan(S.agressivo.weaponSwitchPerMin);
    expect(S.repetitivo.weaponSwitchPerMin).toBe(0);
    const ad = S.aleatorio.defenseWeights;
    expect(new Set([ad.dodge, ad.block, ad.parry, ad.none]).size).toBe(1);
  });
});

describe('AgentPolicy styles', () => {
  it('repetitivo only ever starts sword_shield.light and never switches', () => {
    const rnd = createPrng(99).next;
    const states: EnemyState[] = ['idle', 'chasing', 'attacking', 'recovering'];
    const worlds: World[] = Array.from({ length: 200 }, () => ({
      enemyState: states[Math.floor(rnd() * 4)],
      offset: { x: rnd() * 200 - 100, y: rnd() * 200 - 100 },
    }));
    // each scripted world lasts 10 decisions: 2000 varied decisions
    const log = drive(makePolicy('repetitivo', 5), 2000, (t) => worlds[Math.min(199, Math.floor(t / (10 * STEP)))]);
    const s = starts(log);
    expect(s.length).toBeGreaterThan(0);
    expect(new Set(s)).toEqual(new Set(['sword_shield.light']));
    expect(log.some((l) => l.intent.switchTo !== undefined)).toBe(false);
  });

  it('variado uses all three weapons and every registered action over many decisions', () => {
    const log = drive(makePolicy('variado', 3), Math.round(240_000 / STEP), still('idle', 30));
    expect(new Set(starts(log))).toEqual(new Set(ALL_ACTIONS));
    const switches = new Set(log.map((l) => l.intent.switchTo).filter((x) => x !== undefined));
    expect(switches).toEqual(new Set(WEAPON_IDS));
  });

  it('aleatorio picks the 7 registered actions with roughly uniform frequency', () => {
    const N = 5000;
    let n = 0;
    const log = drive(makePolicy('aleatorio', 11), 2_000_000, still('idle', 30), 'sword_shield', (l) => {
      if (l[l.length - 1].intent.startAction) n++;
      return n >= N;
    });
    const s = starts(log);
    expect(s.length).toBe(N);
    for (const a of ALL_ACTIONS) {
      const f = s.filter((x) => x === a).length / N;
      expect(f, a).toBeGreaterThanOrEqual(0.1);
      expect(f, a).toBeLessThanOrEqual(0.18);
    }
  });

  it('evasivo keeps preferredDistance larger than agressivo', () => {
    const toEnemy = { x: 1, y: 0 };
    for (let seed = 1; seed <= 10; seed++) {
      const body = (weapon: string) => ({ weapon, blocking: false });
      const w: World = { enemyState: 'chasing', offset: { x: 100, y: 0 } };
      const ag = makePolicy('agressivo', seed).decide({ now: obsOf(100, w, body('sword_shield')), seen: obsOf(20, w, body('sword_shield')), nowMs: 100 });
      const ev = makePolicy('evasivo', seed).decide({ now: obsOf(100, w, body('bow')), seen: obsOf(20, w, body('bow')), nowMs: 100 });
      expect(100).toBeLessThan(AGENT_STYLES.evasivo.preferredDistance);
      expect(ag.move.x * toEnemy.x + ag.move.y * toEnemy.y).toBeGreaterThan(0);
      expect(ev.move.x * toEnemy.x + ev.move.y * toEnemy.y).toBeLessThan(0);
    }
  });

  it('bloqueador reacts to a seen telegraph with block (and sometimes parry timing) and never dodges more than its weight', () => {
    const policy = makePolicy('bloqueador', 7);
    const kinds: Record<string, number> = { dodge: 0, block: 0, parry: 0, none: 0 };
    let threats = 0;
    let dodges = 0;
    let blocks = 0;
    let prev: EnemyState | null = null;
    const body = { weapon: 'sword_shield', blocking: false };
    const world = cycleWorld(40);
    for (let i = 0; i < Math.round(400_000 / STEP); i++) {
      const t = i * STEP;
      const seenT = t - PERCEPTION_LAG_MS;
      const seen = seenT >= 0 ? obsOf(seenT, world(seenT), body) : null;
      const intent = policy.decide({ now: obsOf(t, world(t), body), seen, nowMs: t });
      if (intent.block === 'start') body.blocking = true;
      if (intent.block === 'stop') body.blocking = false;
      if (intent.dodge) dodges++;
      if (intent.block === 'start') blocks++;
      if (seen?.enemyState === 'attacking' && prev !== 'attacking') {
        threats++;
        kinds[policy.lastPlannedDefense ?? 'none']++;
      }
      prev = seen ? seen.enemyState : null;
    }
    expect(threats).toBeGreaterThan(200);
    expect(blocks).toBeGreaterThan(threats / 2);
    expect(kinds.block).toBeGreaterThan(0);
    expect(kinds.parry).toBeGreaterThan(0);
    expect(dodges / threats).toBeLessThanOrEqual(AGENT_STYLES.bloqueador.defenseWeights.dodge + 0.05);
  });

  it('paciente does not start an attack while the enemy is attacking, only while recovering or far', () => {
    const close = drive(makePolicy('paciente', 4), Math.round(120_000 / STEP), cycleWorld(40));
    const closeStarts = close.filter((l) => l.intent.startAction);
    expect(closeStarts.length).toBeGreaterThan(10);
    for (const l of closeStarts) expect(l.seenState).toBe('recovering');

    const far = drive(makePolicy('paciente', 4), Math.round(60_000 / STEP), still('chasing', 180));
    const farStarts = starts(far);
    expect(farStarts.length).toBeGreaterThan(5);
    for (const a of farStarts) expect(ACTION_REGISTRY.get(a)!.reach).toBeGreaterThanOrEqual(180);
  });

  it('agressivo attacks in cooldown cadence even while the enemy attacks', () => {
    const T = 60_000;
    const log = drive(makePolicy('agressivo', 2), Math.round(T / STEP), cycleWorld(30));
    const st = log.filter((l) => l.intent.startAction);
    expect(st.filter((l) => l.seenState === 'attacking').length).toBeGreaterThan(10);
    expect(st.length).toBeGreaterThan((0.5 * T) / AGENT_STYLES.agressivo.attackCooldownMs);
    for (let i = 1; i < st.length; i++) {
      expect(st[i].t - st[i - 1].t).toBeGreaterThanOrEqual(AGENT_STYLES.agressivo.attackCooldownMs - 1e-9);
    }
    // more attacks than any other style in the same world
    for (const id of STYLE_IDS) {
      if (id === 'agressivo') continue;
      const other = starts(drive(makePolicy(id, 2), Math.round(T / STEP), cycleWorld(30)));
      expect(st.length, id).toBeGreaterThan(other.length);
    }
  });
});

describe('AgentPolicy perception and humanizer (Review Focus 2)', () => {
  it('no style reacts to a threat it has not seen (seen = null)', () => {
    for (const id of STYLE_IDS) {
      const p = makePolicy(id, 3);
      const body = { weapon: 'sword_shield', blocking: false };
      for (let i = 0; i < 600; i++) {
        const t = i * STEP;
        const intent = p.decide({ now: obsOf(t, { enemyState: 'attacking', offset: { x: 30, y: 0 } }, body), seen: null, nowMs: t });
        expect(isDefense(intent), id).toBe(false);
        expect(intent.startAction, id).toBeUndefined();
      }
    }
  });

  it('a seen telegraph is acted on only after the sampled reaction delay', () => {
    const cfg: HumanizerConfig = { reactionMeanMs: 300, reactionSdMs: 1, lapseProb: 0, aimNoiseRad: 0 };
    let reacted = 0;
    for (const id of ['evasivo', 'bloqueador', 'aleatorio'] as StyleId[]) {
      for (let seed = 1; seed <= 30; seed++) {
        // no charged actions: a valid charge would (by design) fire first and postpone the defence
        const base = AGENT_STYLES[id];
        const actionWeights = Object.fromEntries(Object.entries(base.actionWeights).filter(([k]) => !k.endsWith('.charged')));
        const p = makePolicy(id, seed, cfg, { ...base, actionWeights });
        const body = { weapon: 'sword_shield', blocking: false };
        const threatAt = 1000;
        let firstSeenThreat: number | null = null;
        for (let i = 0; i < 120; i++) {
          const t = 900 + i * STEP;
          const seenT = t - PERCEPTION_LAG_MS;
          const seenState: EnemyState = seenT >= threatAt ? 'attacking' : 'chasing';
          const seen = obsOf(seenT, { enemyState: seenState, offset: { x: 30, y: 0 } }, body);
          const now = obsOf(t, { enemyState: t >= threatAt ? 'attacking' : 'chasing', offset: { x: 30, y: 0 } }, body);
          const intent = p.decide({ now, seen, nowMs: t });
          if (firstSeenThreat === null && seenState === 'attacking') firstSeenThreat = seenT;
          if (isDefense(intent)) {
            // first sight of the threat is at seen.tMs >= threatAt; reaction ~300 ms from there
            expect(t, `${id}#${seed}`).toBeGreaterThanOrEqual(threatAt + 299);
            // ...and no extra delay: within one tick of seen.tMs + sampled delay (parry aims at 325 ms)
            const planned = p.lastPlannedDefense === 'parry' ? 325 : 300;
            expect(t, `${id}#${seed}`).toBeLessThanOrEqual(firstSeenThreat! + planned + 5 + STEP);
            reacted++;
            break;
          }
        }
      }
    }
    expect(reacted).toBeGreaterThan(30);
  });

  it('lapses (lapseProb 1) cancel every planned action', () => {
    const cfg: HumanizerConfig = { ...DEFAULT_HUMANIZER, lapseProb: 1 };
    for (const id of STYLE_IDS) {
      const log = drive(makePolicy(id, 2, cfg), Math.round(30_000 / STEP), cycleWorld(35));
      expect(log.some((l) => isDefense(l.intent) || l.intent.startAction !== undefined), id).toBe(false);
    }
  });

  it('is deterministic: same seeds give the same intent sequence', () => {
    for (const id of STYLE_IDS) {
      const a = drive(makePolicy(id, 8, DEFAULT_HUMANIZER), 3000, cycleWorld(40));
      const b = drive(makePolicy(id, 8, DEFAULT_HUMANIZER), 3000, cycleWorld(40));
      expect(a).toEqual(b);
    }
  });

  it('policy files do not read internals', () => {
    const files = import.meta.glob(['./perception.ts', './styles.ts', './policy.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    expect(Object.keys(files).sort()).toEqual(['./perception.ts', './policy.ts', './styles.ts']);
    const forbidden = ['phaseElapsedMs', 'activeRuleId', 'predictThreatMs', 'threatPrediction', 'blackboard', 'accumulator', 'ProfileView', 'ProfileAccumulator'];
    for (const [f, src] of Object.entries(files)) {
      for (const word of forbidden) expect(src.includes(word), `${f} contains ${word}`).toBe(false);
    }
  });
});

/**
 * Stateful stand-in for PlayerController's input rules that matter for
 * executability: a charge blocks new tryAction (never buffered), the locked
 * part of an action blocks it, recovery accepts it, switching needs idle and
 * locks attacks for 150 ms, a dash lasts 180 ms. Intents are applied in the
 * documented order: move, aim, switchTo, block, dodge, startAction, release.
 */
class FakeBody {
  weapon = 'sword_shield';
  state: 'idle' | 'charging' | 'acting' | 'blocking' | 'dodging' = 'idle';
  private action: { id: string; locked: number; total: number; min: number; max: number; charged: boolean } | null = null;
  private elapsed = 0;
  private held = 0;
  private attackLock = 0;
  private move = { x: 0, y: 0 };
  dropped: string[] = [];
  executed: string[] = [];
  chargedStarts = 0;

  get blocking(): boolean {
    return this.state === 'blocking';
  }
  private get inRecovery(): boolean {
    return this.state === 'acting' && this.action !== null && this.elapsed >= this.action.locked;
  }

  apply(i: AgentIntent): void {
    this.move = i.move;
    if (i.switchTo && this.state === 'idle' && i.switchTo !== this.weapon) {
      this.weapon = i.switchTo;
      this.attackLock = 150;
    }
    if (i.block === 'start' && this.state === 'idle') this.state = 'blocking';
    if (i.block === 'stop' && this.state === 'blocking') this.state = 'idle';
    if (i.dodge && (this.state !== 'acting' || this.inRecovery)) {
      this.state = 'dodging';
      this.action = null;
      this.elapsed = 0;
    }
    if (i.startAction) {
      const a = ACTION_REGISTRY.get(i.startAction)!;
      const charged = a.actionType === 'charged';
      if (charged) this.chargedStarts++;
      const can = a.weaponId === this.weapon && (this.inRecovery || (this.state === 'idle' && this.attackLock <= 0));
      if (!can) this.dropped.push(i.startAction);
      else {
        this.action = {
          id: a.id,
          locked: charged ? a.timing.activeMs : a.timing.startupMs + a.timing.activeMs,
          total: charged ? a.timing.activeMs + a.timing.recoveryMs : a.timing.startupMs + a.timing.activeMs + a.timing.recoveryMs,
          min: a.charge?.minHoldMs ?? 0,
          max: a.charge?.maxHoldMs ?? 0,
          charged,
        };
        this.elapsed = 0;
        this.held = 0;
        this.state = charged ? 'charging' : 'acting';
        if (!charged) this.executed.push(a.id);
      }
    }
    if (i.release && this.state === 'charging') {
      if (this.held >= this.action!.min) this.fire();
      else {
        this.state = 'idle';
        this.action = null;
      }
    }
  }

  private fire(): void {
    this.state = 'acting';
    this.elapsed = 0;
    this.executed.push(this.action!.id);
  }

  step(dt: number): void {
    this.attackLock = Math.max(0, this.attackLock - dt);
    if (this.inRecovery && (this.move.x !== 0 || this.move.y !== 0)) {
      this.state = 'idle';
      this.action = null;
    }
    if (this.state === 'charging') {
      this.held = Math.min(this.held + dt, this.action!.max);
      if (this.held >= this.action!.max) this.fire();
      return;
    }
    if (this.state === 'acting') {
      this.elapsed += dt;
      if (this.elapsed >= this.action!.total) {
        this.state = 'idle';
        this.action = null;
      }
      return;
    }
    if (this.state === 'dodging') {
      this.elapsed += dt;
      if (this.elapsed >= 180) this.state = 'idle';
    }
  }
}

function driveBody(policy: AgentPolicy, ms: number, world: (t: number) => World): { body: FakeBody; intents: AgentIntent[] } {
  const body = new FakeBody();
  const intents: AgentIntent[] = [];
  for (let i = 0; i < Math.round(ms / STEP); i++) {
    const t = i * STEP;
    const b = { weapon: body.weapon, blocking: body.blocking };
    const seenT = t - PERCEPTION_LAG_MS;
    const seen = seenT >= 0 ? obsOf(seenT, world(seenT), b) : null;
    const intent = policy.decide({ now: obsOf(t, world(t), b), seen, nowMs: t });
    intents.push(intent);
    body.apply(intent);
    body.step(STEP);
  }
  return { body, intents };
}

describe('AgentPolicy action lifecycle (fix round 1)', () => {
  it('no intent ever carries both startAction and release, for every style', () => {
    for (const id of STYLE_IDS) {
      for (const world of [cycleWorld(30), still('idle', 30), still('chasing', 180)]) {
        const { intents } = driveBody(makePolicy(id, 6, DEFAULT_HUMANIZER), 60_000, world);
        expect(intents.length).toBeGreaterThan(3000);
        expect(intents.some((i) => i.startAction !== undefined && i.release === true), id).toBe(false);
      }
    }
  });

  it('every start the policy emits is executable by a body where charging blocks tryAction (5 min)', () => {
    for (const id of ['agressivo', 'aleatorio'] as StyleId[]) {
      for (const world of [still('idle', 30), cycleWorld(30)]) {
        const { body } = driveBody(makePolicy(id, 9), 300_000, world);
        expect(body.executed.length, id).toBeGreaterThan(200);
        expect(body.dropped, id).toEqual([]);
      }
    }
  });

  it('weapon switches stay within the style rate (stale plans and repeated checks add none) (Task 6)', () => {
    // A redraw may keep the same weapon, so executed switches <= redraws ~ Poisson(rate x minutes).
    const MIN = 30;
    for (const id of STYLE_IDS) {
      const rate = AGENT_STYLES[id].weaponSwitchPerMin;
      if (rate > 10) continue; // aleatorio redraws for every attack by design
      for (const world of [still('idle', 30), cycleWorld(40)]) {
        const log = drive(makePolicy(id, 12, DEFAULT_HUMANIZER), Math.round((MIN * 60_000) / STEP), world);
        const switches = log.filter((l) => l.intent.switchTo !== undefined).length;
        expect(switches, id).toBeLessThanOrEqual(1 + rate * MIN * 1.5 + 3);
      }
    }
  });

  it('a dash refused inside an action locked phase does not shorten that lock (Task 6)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      for (const id of ['agressivo', 'aleatorio', 'variado'] as StyleId[]) {
        const { body } = driveBody(makePolicy(id, seed), 120_000, cycleWorld(30));
        expect(body.dropped, `${id}#${seed}`).toEqual([]);
      }
    }
  });

  it('aleatorio executes each of the 7 actions with roughly uniform frequency', () => {
    const { body } = driveBody(makePolicy('aleatorio', 13), 20 * 60_000, still('idle', 30));
    const n = body.executed.length;
    expect(n).toBeGreaterThan(1000);
    for (const a of ALL_ACTIONS) {
      const f = body.executed.filter((x) => x === a).length / n;
      expect(f, a).toBeGreaterThanOrEqual(0.1);
      expect(f, a).toBeLessThanOrEqual(0.18);
    }
  });
});
