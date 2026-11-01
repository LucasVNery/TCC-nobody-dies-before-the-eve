import type { EnemyState, Vec2 } from '../../combat/types';
import { ACTION_REGISTRY, lockedMs, type ActionDef } from '../../combat/actionRegistry';
import { DODGE, PARRY_WINDOW_MS, STAGGER_MS, SWITCH_RECOVERY_MS } from '../../combat/actionDefs';
import type { AttackKind } from '../../combat/eliteDefs';
import { ARENA_BOUNDS, PLAYER_MAX_HP } from '../../combat/movementDefs';
import { STAMINA_COST } from '../../combat/stamina';
import { MIN_REACTION_MS, type Humanizer } from './humanizer';
import type { Observation } from './perception';
import type { AgentStyle, DefenseWeights } from './styles';
import { strikeDelayMs } from './threatTiming';

/**
 * Lag the runner should use for `seen` (buffer.at(nowMs, PERCEPTION_LAG_MS)).
 * Reactions are timed from the observation's own tMs, so with a lag no larger
 * than the shortest possible reaction the total delay from the world event to
 * the response is exactly the humanizer's sampled reaction.
 *
 * Two latencies, on purpose: continuous decisions (movement, distance/reach
 * checks, attack gating on the seen enemy state) use the fixed
 * PERCEPTION_LAG_MS view of the world, while discrete event reactions (a new
 * telegraph -> defence, a new recovery -> opening) fire after the humanizer's
 * sampled reaction (~250 ms) counted from the event's observation time.
 */
export const PERCEPTION_LAG_MS = MIN_REACTION_MS;

/** A press aims to land this long before the strike: inside the dodge i-frames, and in the middle of the parry window. */
export const PRESS_LEAD_MS = PARRY_WINDOW_MS / 2;
/** Dodge/parry timing error = (difference of two reaction draws) x this scale. */
export const PRESS_JITTER_SCALE = 0.75;
/** Guard is held at least this long once raised. */
const MIN_BLOCK_HOLD_MS = 100;
/** Slack added to an action's reach (about half an entity) when deciding it can hit. */
const REACH_SLACK_PX = 10;
/** At or beyond this distance an idle/chasing enemy cannot punish a short action. */
const SAFE_DISTANCE_PX = 120;
/** A plan not executed for this long is redrawn (the weapon only if it cannot reach from here). */
const PLAN_STALE_MS = 4000;
/** Extra wait after a seen stagger (two 60 Hz steps). */
const STAGGER_MARGIN_MS = 34;
/** Retreat stops pushing into a wall closer than this. */
const WALL_MARGIN_PX = 60;
/** Sprinting needs more stamina than this and an enemy farther than SPRINT_MIN_DIST_PX. */
const SPRINT_MIN_STAMINA = 75;
const SPRINT_MIN_DIST_PX = 200;
/** An attack this long after the previous one opens a sequence and ignores the stamina reserve. */
const OPENING_GAP_MS = 1000;
/** A ground item this close (and no item held) is considered for a detour. */
const ITEM_SEEK_RADIUS_PX = 250;
/** No detour for an item with HP at or below this fraction of the maximum. */
const ITEM_SEEK_MIN_HP_FRACTION = 0.3;
/** Items on the ground carry no id: kind + position rounded to this grid identifies one. */
const ITEM_KEY_GRID_PX = 10;
/** `itemUse.random`: per-tick chance of using the held item (about once every 3 s at 60 Hz). */
const RANDOM_USE_PER_TICK = 1 / 180;

export type DefenseKind = keyof DefenseWeights;

export interface PolicyInput {
  /** The agent's own body, current (enemy fields here are ignored). */
  now: Observation;
  /** The world as perceived with lag; null before anything was perceived. */
  seen: Observation | null;
  nowMs: number;
}

/**
 * Intents for the player surface; the runner applies them in this order:
 * setMoveInput(move), setSprint(sprint === true), setAimDirection(aim), switchTo,
 * block, dodge, startAction (tryAction), release (releaseAction), useItem.
 */
export interface AgentIntent {
  move: Vec2;
  aim: Vec2;
  switchTo?: string;
  startAction?: string;
  release?: boolean;
  dodge?: boolean;
  block?: 'start' | 'stop';
  sprint?: boolean;
  useItem?: boolean;
}

interface Plan {
  action: ActionDef;
  plannedAt: number;
}

/** One planned defence press (one per seen strike), due at `at` (ms, the policy's clock). */
interface PendingDefense {
  kind: Exclude<DefenseKind, 'none'>;
  at: number;
}

function pick<K extends string>(weights: Record<K, number>, keys: readonly K[], rng: () => number): K | null {
  let total = 0;
  for (const k of keys) total += Math.max(0, weights[k] ?? 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const k of keys) {
    const w = Math.max(0, weights[k] ?? 0);
    if (w <= 0) continue;
    r -= w;
    if (r < 0) return k;
  }
  // floating-point tail: last positive key
  for (let i = keys.length - 1; i >= 0; i--) if ((weights[keys[i]] ?? 0) > 0) return keys[i];
  return null;
}

const DEFENSE_KINDS: readonly DefenseKind[] = ['dodge', 'block', 'parry', 'none'];
const ACTIONS: readonly ActionDef[] = [...ACTION_REGISTRY.values()];

/**
 * A style turned into intents. Decides only from `now` (own body) and `seen`
 * (the lagged world) plus its own timers; all randomness comes from `rng`
 * (style choices) and the humanizer (reaction, lapses, aim noise).
 */
export class AgentPolicy {
  private readonly weaponKeys: readonly string[];
  private prevSeenState: EnemyState | null = null;
  /** Telegraph of the previous seen instant (kind and combo strike): a different one is a new threat. */
  private prevTelegraph: { kind: AttackKind; hit?: 1 | 2 } | null = null;
  /** tMs of the last seen instant whose events were read: a repeated instant (hit-stop) is not read twice. */
  private lastSeenTMs = -Infinity;
  private weaponId: string | null = null;
  private lastSwitchCheckAt = 0;
  private plan: Plan | null = null;
  private lastAttackAt = -Infinity;
  private chargeReleaseAt: number | null = null;
  private chargeAction: ActionDef | null = null;
  /** Own body is inside an action's non-cancelable part until then (own timer: lockedMs from the registry). */
  private lockedUntil = -Infinity;
  private lastHp: number | null = null;
  private lastRunIdx: number | null = null;
  private lastStamina: number | null = null;
  private lastBlocking = false;
  /** Planned presses, earliest first; a combo's two strikes each keep their own. */
  private pending: PendingDefense[] = [];
  private wantBlock = false;
  private blockSince = 0;
  private openingAt: number | null = null;
  private lastEquipped: string | null = null;
  private weaponReadyAt = 0;
  private aim: Vec2 = { x: 1, y: 0 };
  private _lastPlannedDefense: DefenseKind | null = null;
  /** Drawn once when an approach stretch begins (null between stretches): run it or walk it. */
  private approachSprint: boolean | null = null;
  /** Seek outcome (true = go) per ground item seen, keyed by kind + rounded position; cleared on a new run. */
  private seekDecisions = new Map<string, boolean>();
  /** When a held-item use condition first held, the time the agent will act on it (reaction delay). */
  private itemUseAt: number | null = null;

  constructor(
    private readonly style: AgentStyle,
    private readonly humanizer: Humanizer,
    private readonly rng: () => number,
  ) {
    this.weaponKeys = Object.keys(style.weaponWeights);
  }

  /** Defence chosen for the most recently seen attack (before any lapse); diagnostic only. */
  get lastPlannedDefense(): DefenseKind | null {
    return this._lastPlannedDefense;
  }

  decide({ now, seen, nowMs }: PolicyInput): AgentIntent {
    if (now.equippedWeaponId !== this.lastEquipped) {
      if (this.lastEquipped !== null) this.weaponReadyAt = nowMs + SWITCH_RECOVERY_MS;
      this.lastEquipped = now.equippedWeaponId;
    }
    this.readOwnBody(now, nowMs);
    const intent: AgentIntent = { move: { x: 0, y: 0 }, aim: this.aim };
    if (this.chargeReleaseAt !== null && nowMs >= this.chargeReleaseAt) this.releaseCharge(intent, nowMs);

    if (!seen || seen.enemyDead) {
      this.prevSeenState = null;
      this.prevTelegraph = null;
      this.pending = [];
      this.wantBlock = false;
      this.openingAt = null;
      this.approachSprint = null;
      if (now.isBlocking) intent.block = 'stop';
      this.useHeldItem(intent, now, null, nowMs, nowMs < this.lockedUntil || this.wantBlock || now.isBlocking);
      return intent;
    }

    const st = seen.enemyState;
    if (seen.tMs > this.lastSeenTMs) {
      // events are read once per seen instant: a frozen step that repeats an instant adds nothing
      this.lastSeenTMs = seen.tMs;
      const tg = seen.telegraph;
      const prev = this.prevTelegraph;
      if (tg !== null && (prev === null || prev.kind !== tg.kind || prev.hit !== tg.hit)) {
        // a new telegraph (or the combo's second strike): plan against the strike it announces
        const seenDist = Math.hypot(seen.enemyPos.x - seen.playerPos.x, seen.enemyPos.y - seen.playerPos.y);
        this.planDefense(seen.tMs, strikeDelayMs(tg, seenDist));
      }
      this.prevTelegraph = tg === null ? null : { kind: tg.kind, hit: tg.hit };
      // no telegraph and no attack under way (a charge that stopped at a wall): no strike is coming
      if (tg === null && st !== 'attacking' && st !== 'lunging') this.pending = [];
      if (st !== 'recovering') this.openingAt = null;
      else if (this.prevSeenState !== 'recovering' && this.style.waitForOpening) {
        this.openingAt = seen.tMs + this.humanizer.sampleReactionMs();
      }
      this.prevSeenState = st;
    }

    const dx = seen.enemyPos.x - now.playerPos.x;
    const dy = seen.enemyPos.y - now.playerPos.y;
    const dist = Math.hypot(dx, dy);
    const dir = dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 0, y: 0 };
    if (dist > 0) this.aim = dir;
    intent.aim = this.aim;

    let dodgeNow = false;
    const due = this.pending[0];
    if (due && nowMs >= due.at && this.chargeAction?.charge && nowMs - this.lastAttackAt >= this.chargeAction.charge.minHoldMs) {
      // a defence falls due mid-charge with the charge already valid: fire it, defend right after.
      // When a defence falls due while a valid charge (held >= minHoldMs) is in progress the charge
      // fires first and the defence runs after its locked phase, up to ~11 ticks (~183 ms) late for
      // heavy_weapon charges and ~9 ticks (~150 ms) for sword_shield — accepted as commitment to the
      // attack; the reaction-delay guarantee holds only when no valid charge is in progress.
      this.releaseCharge(intent, nowMs);
      due.at = this.lockedUntil;
    }
    if (due && nowMs >= due.at) {
      // A player sees the stamina bar: a defence the bar cannot pay for is not pressed (the engine would
      // deny it). A dodge falls back to the guard when there is any stamina, otherwise nothing.
      let kind: Exclude<DefenseKind, 'none'> | 'none' = due.kind;
      if (kind === 'dodge' && now.playerStamina < STAMINA_COST.dodge) kind = now.playerStamina > 0 ? 'block' : 'none';
      if ((kind === 'block' || kind === 'parry') && now.playerStamina <= 0) kind = 'none';
      if (kind === 'dodge') {
        dodgeNow = true;
        intent.dodge = true;
        this.chargeReleaseAt = null; // the dash cancels a charge
        this.chargeAction = null;
        // no attack can start mid-dash; a dash pressed inside an action's locked phase is refused by
        // the body, and that action's own lock must not be shortened by it
        this.lockedUntil = Math.max(this.lockedUntil, nowMs + DODGE.durationMs);
        this.wantBlock = false;
      } else if (kind !== 'none') {
        // let go of the charge to get the guard up sooner
        if (this.chargeReleaseAt !== null) this.releaseCharge(intent, nowMs);
        if (!this.wantBlock) this.blockSince = nowMs;
        this.wantBlock = true;
      }
      this.pending.shift();
    }
    // an empty bar cannot raise the guard; a guard already up is released by the min-hold rule below
    if (this.wantBlock && !now.isBlocking && now.playerStamina <= 0) this.wantBlock = false;
    if (this.wantBlock && st !== 'attacking' && st !== 'lunging' && nowMs - this.blockSince >= MIN_BLOCK_HOLD_MS) this.wantBlock = false;
    if (this.wantBlock && !now.isBlocking) intent.block = 'start';
    else if (!this.wantBlock && now.isBlocking) intent.block = 'stop';

    // offence
    const plan = this.currentPlan(nowMs, dist);
    // A release tick, and the released action's locked phase after it, are busy: a start
    // there would be dropped by the engine (charging/locked) or would cancel the old charge.
    const busy =
      intent.release === true ||
      this.chargeReleaseAt !== null ||
      nowMs < this.lockedUntil ||
      this.wantBlock ||
      now.isBlocking ||
      this.pending.length > 0 ||
      dodgeNow;
    const reachOk = dist <= plan.action.reach + REACH_SLACK_PX;
    const opening =
      !this.style.waitForOpening ||
      (st === 'recovering' && this.openingAt !== null && nowMs >= this.openingAt) ||
      (st !== 'attacking' && dist >= SAFE_DISTANCE_PX && reachOk);
    this.useHeldItem(intent, now, seen, nowMs, busy);
    let approach = false;
    if (!busy) {
      if (plan.action.weaponId !== now.equippedWeaponId) intent.switchTo = plan.action.weaponId;
      else if (nowMs >= this.weaponReadyAt && nowMs - this.lastAttackAt >= this.style.attackCooldownMs && opening) {
        if (!reachOk) approach = true;
        else if (now.playerStamina <= 0) {
          // exhausted: an attack press would be denied; wait for the bar to refill
        } else if (this.belowReserve(plan.action, now.playerStamina, nowMs)) {
          // keep the reserve for defence: only the opening attack of a sequence spends into it
        } else if (this.humanizer.lapses()) this.lastAttackAt = nowMs;
        else this.startAttack(intent, plan, nowMs, now.heldItem);
      }
    }

    // movement. A lunge on screen (aiming or charging) is not walked into: the press was timed on the
    // distance at which its corridor appeared, and closing in would bring the strike forward.
    const holdGround = st === 'lunging';
    let closing = false;
    if (dodgeNow) intent.move = this.retreat(now.playerPos, dir);
    else if (approach && !holdGround) {
      intent.move = dir;
      closing = true;
    } else if (!holdGround && dist > this.style.preferredDistance + this.style.distanceTolerance) {
      intent.move = dir;
      closing = true;
    } else if (dist < this.style.preferredDistance - this.style.distanceTolerance) intent.move = this.retreat(now.playerPos, dir);

    // a detour for a nearby item replaces the positioning above while the enemy is not attacking
    const itemDir = dodgeNow || this.wantBlock ? null : this.seekItem(now, seen);
    if (itemDir) {
      intent.move = itemDir;
      closing = false;
    }

    // sprint: the choice is made once per approach stretch (not per tick, so it does not flicker); inside a
    // run-chosen stretch it still needs stamina above the floor and an enemy still far away
    if (!closing) this.approachSprint = null;
    else {
      if (this.approachSprint === null) this.approachSprint = this.rng() < this.style.sprintApproach;
      if (this.approachSprint && now.playerStamina > SPRINT_MIN_STAMINA && dist > SPRINT_MIN_DIST_PX) intent.sprint = true;
    }
    return intent;
  }

  /**
   * Own HP/stamina bars are visible to a player: an HP drop (or stamina emptied while blocking)
   * means the body was staggered, which also ends any charge; a change of run index
   * means a fresh run (full reset), so every own-body timer is cleared. An HP rise is
   * a heal, not a restart.
   */
  private readOwnBody(now: Observation, nowMs: number): void {
    const restarted = this.lastRunIdx !== null && now.runIdx !== this.lastRunIdx;
    if (this.lastHp !== null && this.lastStamina !== null) {
      if (restarted) {
        this.chargeReleaseAt = null;
        this.chargeAction = null;
        this.lockedUntil = -Infinity;
        this.wantBlock = false;
        this.pending = [];
        this.lastSeenTMs = -Infinity;
        this.prevTelegraph = null;
        this.seekDecisions.clear();
        this.itemUseAt = null;
      } else if (now.playerHp < this.lastHp || (this.lastBlocking && now.playerStamina <= 0 && this.lastStamina > 0)) {
        this.chargeReleaseAt = null;
        this.chargeAction = null;
        // the hit lands after this tick's body step, so the stagger ends one step later than STAGGER_MS
        this.lockedUntil = Math.max(this.lockedUntil, nowMs + STAGGER_MS + STAGGER_MARGIN_MS);
      }
    }
    this.lastRunIdx = now.runIdx;
    this.lastHp = now.playerHp;
    this.lastStamina = now.playerStamina;
    this.lastBlocking = now.isBlocking;
  }

  /**
   * Uses the held item. With `itemUse.random` the item goes at a fixed per-tick chance whatever it is;
   * otherwise heal (HP under the fraction) and bomb (enemy within range) act once their condition has held
   * for a sampled reaction delay and the policy is not busy. Power goes out with an attack start instead.
   */
  private useHeldItem(intent: AgentIntent, now: Observation, seen: Observation | null, nowMs: number, busy: boolean): void {
    const held = now.heldItem;
    if (held === null) {
      this.itemUseAt = null;
      return;
    }
    const use = this.style.itemUse;
    if (use.random) {
      if (this.rng() < RANDOM_USE_PER_TICK) intent.useItem = true;
      return;
    }
    let cond = false;
    if (held === 'heal') cond = now.playerHp / PLAYER_MAX_HP < use.healBelowHpFraction;
    else if (held === 'bomb' && seen) {
      cond = Math.hypot(seen.enemyPos.x - now.playerPos.x, seen.enemyPos.y - now.playerPos.y) <= use.bombWithinPx;
    }
    if (!cond) {
      this.itemUseAt = null;
      return;
    }
    if (this.itemUseAt === null) this.itemUseAt = nowMs + this.humanizer.sampleReactionMs();
    if (nowMs >= this.itemUseAt && !busy) {
      intent.useItem = true;
      this.itemUseAt = null;
    }
  }

  /**
   * Direction to walk for a nearby ground item, or null. The go/skip draw is made once per item, the first
   * tick it is within range with the slot empty. Walking stops the moment the enemy attacks (telegraph or
   * attacking/lunging seen) or HP is low, and may resume when that passes.
   */
  private seekItem(now: Observation, seen: Observation): Vec2 | null {
    if (now.heldItem !== null) return null;
    let best: { dist: number; dir: Vec2 } | null = null;
    for (const g of now.groundItems) {
      const dx = g.pos.x - now.playerPos.x;
      const dy = g.pos.y - now.playerPos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > ITEM_SEEK_RADIUS_PX) continue;
      const key = `${g.kind}:${Math.round(g.pos.x / ITEM_KEY_GRID_PX) * ITEM_KEY_GRID_PX}:${Math.round(g.pos.y / ITEM_KEY_GRID_PX) * ITEM_KEY_GRID_PX}`;
      let go = this.seekDecisions.get(key);
      if (go === undefined) {
        go = this.rng() < this.style.itemSeeking;
        this.seekDecisions.set(key, go);
      }
      if (go && dist > 0 && (best === null || dist < best.dist)) best = { dist, dir: { x: dx / dist, y: dy / dist } };
    }
    if (!best) return null;
    const enemyActing = seen.telegraph !== null || seen.enemyState === 'attacking' || seen.enemyState === 'lunging';
    if (enemyActing || now.playerHp / PLAYER_MAX_HP <= ITEM_SEEK_MIN_HP_FRACTION) return null;
    return best.dir;
  }

  private releaseCharge(intent: AgentIntent, nowMs: number): void {
    intent.release = true;
    if (this.chargeAction) this.lockedUntil = nowMs + lockedMs(this.chargeAction);
    this.chargeReleaseAt = null;
    this.chargeAction = null;
  }

  /**
   * Plans the defence against a strike landing `delayMs` after its telegraph became visible at
   * `threatSeenAtMs`. Dodge and parry aim the press PRESS_LEAD_MS before the strike (+- noise), never sooner
   * than the reaction delay; the plain guard goes up as soon as the agent reacts. Each strike gets its own
   * press: an earlier one still pending (combo strike 1) is kept, not replaced.
   */
  private planDefense(threatSeenAtMs: number, delayMs: number): void {
    const kind = pick(this.style.defenseWeights, DEFENSE_KINDS, this.rng) ?? 'none';
    this._lastPlannedDefense = kind;
    if (kind === 'none' || this.humanizer.lapses()) return;
    const reaction = this.humanizer.sampleReactionMs();
    let at = threatSeenAtMs + reaction;
    if (kind === 'parry' || kind === 'dodge') {
      const jitter = (this.humanizer.sampleReactionMs() - this.humanizer.sampleReactionMs()) * PRESS_JITTER_SCALE;
      at = threatSeenAtMs + Math.max(reaction, delayMs - PRESS_LEAD_MS + jitter);
    }
    this.pending.push({ kind, at });
    this.pending.sort((a, b) => a.at - b.at);
  }

  /** True when a non-opening attack would leave the bar under the style's reserve. */
  private belowReserve(action: ActionDef, stamina: number, nowMs: number): boolean {
    if (nowMs - this.lastAttackAt >= OPENING_GAP_MS) return false;
    return stamina - STAMINA_COST[action.actionType] < this.style.staminaReserve;
  }

  private startAttack(intent: AgentIntent, plan: Plan, nowMs: number, held: Observation['heldItem']): void {
    intent.startAction = plan.action.id;
    intent.aim = this.humanizer.noisyAim(this.aim);
    if (held === 'power' && this.style.itemUse.powerOnAttackStart) intent.useItem = true;
    this.lastAttackAt = nowMs;
    const charge = plan.action.charge;
    if (charge) {
      this.chargeReleaseAt = nowMs + charge.minHoldMs + this.rng() * (charge.maxHoldMs - charge.minHoldMs);
      this.chargeAction = plan.action;
    } else {
      this.lockedUntil = nowMs + lockedMs(plan.action);
    }
    this.plan = this.makePlan(nowMs, false);
  }

  /**
   * A stale plan (unused for PLAN_STALE_MS) redraws the action; the weapon is
   * forced to a redraw only when no weighted action of the current weapon
   * reaches the enemy from here (e.g. paciente holding a melee plan at range).
   * Otherwise the weapon changes only at the style's weaponSwitchPerMin rate,
   * so a stale plan never adds weapon switches the style did not ask for.
   */
  private currentPlan(nowMs: number, dist: number): Plan {
    if (!this.plan) this.plan = this.makePlan(nowMs, true);
    else if (nowMs - this.plan.plannedAt > PLAN_STALE_MS) this.plan = this.makePlan(nowMs, !this.weaponReaches(dist));
    return this.plan;
  }

  private weaponReaches(dist: number): boolean {
    return ACTIONS.some(
      (a) => a.weaponId === this.weaponId && (this.style.actionWeights[a.id] ?? 0) > 0 && dist <= a.reach + REACH_SLACK_PX,
    );
  }

  private makePlan(nowMs: number, forceRedraw: boolean): Plan {
    // Poisson redraws at weaponSwitchPerMin: each check covers only the time since the previous check
    // (counting from the last redraw instead would make the hazard grow with every check and redraw
    // far more often than the style's rate).
    const rate = this.style.weaponSwitchPerMin;
    const elapsedMin = (nowMs - this.lastSwitchCheckAt) / 60000;
    this.lastSwitchCheckAt = nowMs;
    const redraw =
      forceRedraw || this.weaponId === null || (rate > 0 && this.rng() < 1 - Math.exp(-rate * Math.max(0, elapsedMin)));
    if (redraw) {
      this.weaponId = pick(this.style.weaponWeights, this.weaponKeys, this.rng) ?? this.weaponId;
    }
    const candidates = ACTIONS.filter((a) => a.weaponId === this.weaponId && (this.style.actionWeights[a.id] ?? 0) > 0);
    const pool = candidates.length > 0 ? candidates : ACTIONS.filter((a) => (this.style.actionWeights[a.id] ?? 0) > 0);
    const ids = pool.map((a) => a.id);
    const id = pick(this.style.actionWeights, ids, this.rng) ?? ids[0];
    return { action: ACTION_REGISTRY.get(id)!, plannedAt: nowMs };
  }

  /** Away from the enemy, sliding along a wall instead of pushing into it. */
  private retreat(pos: Vec2, dir: Vec2): Vec2 {
    let ax = -dir.x;
    let ay = -dir.y;
    const minX = ARENA_BOUNDS.x + WALL_MARGIN_PX;
    const maxX = ARENA_BOUNDS.x + ARENA_BOUNDS.width - WALL_MARGIN_PX;
    const minY = ARENA_BOUNDS.y + WALL_MARGIN_PX;
    const maxY = ARENA_BOUNDS.y + ARENA_BOUNDS.height - WALL_MARGIN_PX;
    if ((pos.x < minX && ax < 0) || (pos.x > maxX && ax > 0)) ax = 0;
    if ((pos.y < minY && ay < 0) || (pos.y > maxY && ay > 0)) ay = 0;
    if (Math.hypot(ax, ay) < 1e-6) {
      // cornered: slide perpendicular to the enemy direction, toward the arena centre
      const cx = ARENA_BOUNDS.x + ARENA_BOUNDS.width / 2 - pos.x;
      const cy = ARENA_BOUNDS.y + ARENA_BOUNDS.height / 2 - pos.y;
      const px = -dir.y;
      const py = dir.x;
      const s = px * cx + py * cy >= 0 ? 1 : -1;
      ax = px * s;
      ay = py * s;
    }
    const n = Math.hypot(ax, ay);
    return n > 0 ? { x: ax / n, y: ay / n } : { x: 0, y: 0 };
  }
}
