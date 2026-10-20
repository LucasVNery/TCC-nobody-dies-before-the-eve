import type { EnemyState, Vec2 } from '../../combat/types';
import { ACTION_REGISTRY, lockedMs, type ActionDef } from '../../combat/actionRegistry';
import { DODGE, PARRY_WINDOW_MS, STAGGER_MS, SWITCH_RECOVERY_MS } from '../../combat/actionDefs';
import { ARENA_BOUNDS } from '../../combat/movementDefs';
import { MIN_REACTION_MS, type Humanizer } from './humanizer';
import type { Observation } from './perception';
import type { AgentStyle, DefenseWeights } from './styles';

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

/**
 * What a player learns by playing (not read from the enemy's code): the swing
 * lands about this long after the telegraph becomes visible. It is a copy of
 * the Assaltante's TELEGRAPH_MS (assaltanteController.ts, private there):
 * if combat balance changes that value, update this one too (drift risk).
 */
const SEEN_TELEGRAPH_MS = 400;
/** Parry plans aim the press at the middle of the parry window before the hit. */
const PARRY_PRESS_MS = SEEN_TELEGRAPH_MS - PARRY_WINDOW_MS / 2;
/** Parry timing error = (difference of two reaction draws) x this scale. */
const PARRY_JITTER_SCALE = 0.75;
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
 * setMoveInput(move), setAimDirection(aim), switchTo, block, dodge,
 * startAction (tryAction), release (releaseAction).
 */
export interface AgentIntent {
  move: Vec2;
  aim: Vec2;
  switchTo?: string;
  startAction?: string;
  release?: boolean;
  dodge?: boolean;
  block?: 'start' | 'stop';
}

interface Plan {
  action: ActionDef;
  plannedAt: number;
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
  private weaponId: string | null = null;
  private lastSwitchCheckAt = 0;
  private plan: Plan | null = null;
  private lastAttackAt = -Infinity;
  private chargeReleaseAt: number | null = null;
  private chargeAction: ActionDef | null = null;
  /** Own body is inside an action's non-cancelable part until then (own timer: lockedMs from the registry). */
  private lockedUntil = -Infinity;
  private lastHp: number | null = null;
  private lastPoise: number | null = null;
  private pending: { kind: Exclude<DefenseKind, 'none'>; at: number } | null = null;
  private wantBlock = false;
  private blockSince = 0;
  private openingAt: number | null = null;
  private lastEquipped: string | null = null;
  private weaponReadyAt = 0;
  private aim: Vec2 = { x: 1, y: 0 };
  private _lastPlannedDefense: DefenseKind | null = null;

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
      this.pending = null;
      this.wantBlock = false;
      this.openingAt = null;
      if (now.isBlocking) intent.block = 'stop';
      return intent;
    }

    const st = seen.enemyState;
    if (st === 'attacking' && this.prevSeenState !== 'attacking') this.planDefense(seen.tMs);
    if (st !== 'recovering') this.openingAt = null;
    else if (this.prevSeenState !== 'recovering' && this.style.waitForOpening) {
      this.openingAt = seen.tMs + this.humanizer.sampleReactionMs();
    }
    this.prevSeenState = st;

    const dx = seen.enemyPos.x - now.playerPos.x;
    const dy = seen.enemyPos.y - now.playerPos.y;
    const dist = Math.hypot(dx, dy);
    const dir = dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 0, y: 0 };
    if (dist > 0) this.aim = dir;
    intent.aim = this.aim;

    let dodgeNow = false;
    if (this.pending && nowMs >= this.pending.at && this.chargeAction?.charge && nowMs - this.lastAttackAt >= this.chargeAction.charge.minHoldMs) {
      // a defence falls due mid-charge with the charge already valid: fire it, defend right after.
      // When a defence falls due while a valid charge (held >= minHoldMs) is in progress the charge
      // fires first and the defence runs after its locked phase, up to ~11 ticks (~183 ms) late for
      // heavy_weapon charges and ~9 ticks (~150 ms) for sword_shield — accepted as commitment to the
      // attack; the reaction-delay guarantee holds only when no valid charge is in progress.
      this.releaseCharge(intent, nowMs);
      this.pending.at = this.lockedUntil;
    }
    if (this.pending && nowMs >= this.pending.at) {
      if (this.pending.kind === 'dodge') {
        dodgeNow = true;
        intent.dodge = true;
        this.chargeReleaseAt = null; // the dash cancels a charge
        this.chargeAction = null;
        // no attack can start mid-dash; a dash pressed inside an action's locked phase is refused by
        // the body, and that action's own lock must not be shortened by it
        this.lockedUntil = Math.max(this.lockedUntil, nowMs + DODGE.durationMs);
        this.wantBlock = false;
      } else {
        // let go of the charge to get the guard up sooner
        if (this.chargeReleaseAt !== null) this.releaseCharge(intent, nowMs);
        if (!this.wantBlock) this.blockSince = nowMs;
        this.wantBlock = true;
      }
      this.pending = null;
    }
    if (this.wantBlock && st !== 'attacking' && nowMs - this.blockSince >= MIN_BLOCK_HOLD_MS) this.wantBlock = false;
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
      this.pending !== null ||
      dodgeNow;
    const reachOk = dist <= plan.action.reach + REACH_SLACK_PX;
    const opening =
      !this.style.waitForOpening ||
      (st === 'recovering' && this.openingAt !== null && nowMs >= this.openingAt) ||
      (st !== 'attacking' && dist >= SAFE_DISTANCE_PX && reachOk);
    let approach = false;
    if (!busy) {
      if (plan.action.weaponId !== now.equippedWeaponId) intent.switchTo = plan.action.weaponId;
      else if (nowMs >= this.weaponReadyAt && nowMs - this.lastAttackAt >= this.style.attackCooldownMs && opening) {
        if (!reachOk) approach = true;
        else if (this.humanizer.lapses()) this.lastAttackAt = nowMs;
        else this.startAttack(intent, plan, nowMs);
      }
    }

    // movement
    if (dodgeNow) intent.move = this.retreat(now.playerPos, dir);
    else if (approach) intent.move = dir;
    else if (dist > this.style.preferredDistance + this.style.distanceTolerance) intent.move = dir;
    else if (dist < this.style.preferredDistance - this.style.distanceTolerance) intent.move = this.retreat(now.playerPos, dir);
    return intent;
  }

  /**
   * Own HP/poise bars are visible to a player: an HP drop (or poise broken)
   * means the body was staggered, which also ends any charge; an HP rise means
   * a fresh run (full reset), so every own-body timer is cleared.
   */
  private readOwnBody(now: Observation, nowMs: number): void {
    if (this.lastHp !== null && this.lastPoise !== null) {
      if (now.playerHp > this.lastHp) {
        this.chargeReleaseAt = null;
        this.chargeAction = null;
        this.lockedUntil = -Infinity;
        this.wantBlock = false;
        this.pending = null;
      } else if (now.playerHp < this.lastHp || (now.playerPoise <= 0 && this.lastPoise > 0)) {
        this.chargeReleaseAt = null;
        this.chargeAction = null;
        // the hit lands after this tick's body step, so the stagger ends one step later than STAGGER_MS
        this.lockedUntil = Math.max(this.lockedUntil, nowMs + STAGGER_MS + STAGGER_MARGIN_MS);
      }
    }
    this.lastHp = now.playerHp;
    this.lastPoise = now.playerPoise;
  }

  private releaseCharge(intent: AgentIntent, nowMs: number): void {
    intent.release = true;
    if (this.chargeAction) this.lockedUntil = nowMs + lockedMs(this.chargeAction);
    this.chargeReleaseAt = null;
    this.chargeAction = null;
  }

  private planDefense(threatSeenAtMs: number): void {
    const kind = pick(this.style.defenseWeights, DEFENSE_KINDS, this.rng) ?? 'none';
    this._lastPlannedDefense = kind;
    this.pending = null;
    if (kind === 'none' || this.humanizer.lapses()) return;
    const reaction = this.humanizer.sampleReactionMs();
    let at = threatSeenAtMs + reaction;
    if (kind === 'parry') {
      const jitter = (this.humanizer.sampleReactionMs() - this.humanizer.sampleReactionMs()) * PARRY_JITTER_SCALE;
      at = threatSeenAtMs + Math.max(reaction, PARRY_PRESS_MS + jitter);
    }
    this.pending = { kind, at };
  }

  private startAttack(intent: AgentIntent, plan: Plan, nowMs: number): void {
    intent.startAction = plan.action.id;
    intent.aim = this.humanizer.noisyAim(this.aim);
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
