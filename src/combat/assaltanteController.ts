// src/combat/assaltanteController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { OpportunitySystem } from '../opportunity/opportunitySystem';
import type { AABB, EnemyState, Vec2 } from './types';
import type { ActionId, InvalidReason } from '../opportunity/types';
import { ATTACK_RANGE, choosePatternRule, type Blackboard } from '../ai/rules/assaltanteRules';
import { createPrng, type Prng } from '../core/prng';
import { ASSALTANTE_CHASE_SPEED, ARENA_BOUNDS, ATTACK_REACH, ATTACK_HALF_ANGLE_RAD, ASSALTANTE_MAX_HP, LUNGE, LONG_LUNGE } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena } from './movement';
import { directionalSector, sectorOverlapsBox, type AttackSector } from './sector';
import { PARRY_BONUS_RECOVERY_MS } from './actionDefs';
import { ELITE, ELITE_TELEGRAPH_MS, type AttackKind } from './eliteDefs';
import { predictThreatMs, type ChaseTelegraphConfig, type ChaseTelegraphSnapshot } from './threatPrediction';
import type { ThreatAssessor } from './patience';

/** The plain swing's telegraph; the real value logged as windows_ms.telegraph_swing. */
export const TELEGRAPH_MS = ELITE_TELEGRAPH_MS.swing;
export const SWING_MS = 150;
const RECOVERY_MS = 500; // = punish window
/** Dodge window of a lunge: its telegraph plus the full travel (the window closes early if the charge ends sooner). */
const lungeWindowMs = (long: boolean): number =>
  long
    ? LONG_LUNGE.telegraphMs + (LONG_LUNGE.maxTravel / LUNGE.speed) * 1000
    : LUNGE.telegraphMs + (LUNGE.maxTravel / LUNGE.speed) * 1000;

/** Travel of a long charge toward a player `distance` away: past them by the overshoot, never below the short lunge's. */
const longTravelFor = (distance: number): number =>
  Math.min(LONG_LUNGE.maxTravel, Math.max(LUNGE.maxTravel, distance + LONG_LUNGE.overshoot));

/** Presentation view of the wind-up in progress; progress runs 0..1 across the current telegraph. */
export interface TelegraphView {
  kind: AttackKind;
  progress: number;
  /** Enemy centre. */
  origin: Vec2;
  direction: Vec2;
  /** Same reach as the logical hitbox (centre-based). */
  reach: number;
  halfAngleRad: number;
  /** Slam radius. */
  radius?: number;
  /** Lunge travel distance. */
  travel?: number;
  /** Lunge danger radius around the body's path (LUNGE.contactDistance). */
  contactDistance?: number;
  /** Combo strike (1 or 2). */
  hit?: 1 | 2;
}

export class AssaltanteController implements ThreatAssessor {
  state: EnemyState = 'idle';
  hp = ASSALTANTE_MAX_HP;
  private phaseElapsedMs = 0;
  private activeOppId: string | null = null;
  private _activeRuleId: string | null = null;
  private _position: Vec2;
  /** Hurtbox size: the base size times `_bodyScale` (the boss is drawn and hit as a bigger body). */
  private width: number;
  private height: number;
  private readonly baseWidth: number;
  private readonly baseHeight: number;
  /** Boss body scale (1 outside boss mode): scales the hurtbox, the strike reaches and the decision ranges. */
  private _bodyScale = 1;
  private _attackDirection: Vec2 = { x: -1, y: 0 };
  private playerWasInRangeDuringPunish = false;
  private lungeCooldownMs: number = Math.max(ELITE.firstAttackDelayMs, LUNGE.cooldownMs);
  /** Time since birth/respawn (first attack only after ELITE.firstAttackDelayMs). */
  private ageMs = 0;
  /** Time spent idle/chasing since the last pattern, stagger or parry recovery ended (mandatory pause). */
  private sincePatternMs = 0;
  /** Pattern draw; deterministic (seed 0) until RunDirector reseeds it per run. */
  private prng: Prng = createPrng(0);
  private chargeCooldownMs: number = Math.max(ELITE.firstAttackDelayMs, LONG_LUNGE.cooldownMs);
  /** The lunge in progress started beyond LUNGE.maxDistance (long charge): longer telegraph and travel. */
  private lungeLong = false;
  private lungeTelegraphMs: number = LUNGE.telegraphMs;
  private lungeMaxTravel: number = LUNGE.maxTravel;
  private lungeMoving = false;
  private lungeTravelled = 0;
  private lungeLandedThisTick = false;
  /** Player position when the telegraph locked: a sideways dash timed at the strike still counts as a dodge. */
  private lungeLockPlayerPosition: Vec2 = { x: 0, y: 0 };
  /** Lunge dodge window, kept so it can be closed if the lunge ends early (wall) while it is still open. */
  private lungeDodgeOppId: string | null = null;
  private recoveryDurationMs = RECOVERY_MS;
  private playerPosition: Vec2 = { x: 0, y: 0 };
  /** Kind of the pattern while `attacking`; the lunge has its own state. */
  private patternKind: 'swing' | 'combo' | 'slam' = 'swing';
  /** Which strike of the combo is in progress. */
  private comboStrike: 1 | 2 = 1;
  /** Boss mode: max hp (null = normal elite) and chase speed multiplier. */
  private bossMaxHp: number | null = null;
  private advanceMult = 1;
  /** Barrage: swings still to start, the pause between them, and whether a barrage swing is in progress. */
  private barrageRemaining = 0;
  private barragePauseMs = 0;
  private barrageStrikeActive = false;

  constructor(
    private bus: EventBus<GameEvents>,
    private opp: OpportunitySystem,
    initialHurtbox: AABB,
  ) {
    this._position = { x: initialHurtbox.x, y: initialHurtbox.y };
    this.width = initialHurtbox.width;
    this.height = initialHurtbox.height;
    this.baseWidth = initialHurtbox.width;
    this.baseHeight = initialHurtbox.height;
  }

  get position(): Vec2 {
    return { x: this._position.x, y: this._position.y };
  }

  /** 1 outside boss mode. */
  get bodyScale(): number {
    return this._bodyScale;
  }

  /** Current hurtbox size (the base size times bodyScale). */
  get bodySize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * Top-left a base-size body with the same centre would have. Every distance to the player is measured from
   * here (the player position is a base-size top-left too), so a grown body keeps measuring centre to centre.
   * Exactly `_position` at scale 1, so the plain elite's arithmetic is untouched.
   */
  private get anchor(): Vec2 {
    return {
      x: this._position.x + (this.width - this.baseWidth) / 2,
      y: this._position.y + (this.height - this.baseHeight) / 2,
    };
  }

  /** Plain swing / combo strike reach from the centre. */
  private get swingReach(): number {
    return ATTACK_REACH * this._bodyScale + this.width / 2;
  }

  /** Slam radius past the body (the telegraph's ring) and the slam reach from the centre. */
  private get slamRadius(): number {
    return ELITE.slamRadius * this._bodyScale;
  }

  private get slamReach(): number {
    return this.slamRadius + this.width / 2;
  }

  private get lungeContactDistance(): number {
    return LUNGE.contactDistance * this._bodyScale;
  }

  /** Resizes the body to `scale` × base around its current centre, kept inside the arena. */
  private setBodyScale(scale: number): void {
    const cx = this._position.x + this.width / 2;
    const cy = this._position.y + this.height / 2;
    this._bodyScale = scale;
    this.width = this.baseWidth * scale;
    this.height = this.baseHeight * scale;
    this._position = clampToArena(
      { x: cx - this.width / 2, y: cy - this.height / 2 },
      this.width,
      this.height,
      ARENA_BOUNDS,
    );
  }

  get maxHp(): number {
    return this.bossMaxHp ?? ASSALTANTE_MAX_HP;
  }

  /** A barrage is queued or one of its swings is in progress. */
  get isBarraging(): boolean {
    return this.barrageRemaining > 0 || this.barrageStrikeActive;
  }

  private get chaseSpeed(): number {
    return ASSALTANTE_CHASE_SPEED * this.advanceMult;
  }

  /**
   * Boss mode: a fresh enemy (as after respawn, position kept) with `maxHp` and the chase speed scaled
   * by `advanceMult`, its body grown to `bodyScale` × the base size around the same centre (then clamped
   * to the arena). Open windows are closed as source_interrupted, like respawn.
   */
  configureBoss(opts: { maxHp: number; advanceMult: number; bodyScale: number }): void {
    this.respawn(this._position, 'source_interrupted');
    this.bossMaxHp = opts.maxHp;
    this.advanceMult = opts.advanceMult;
    this.hp = opts.maxHp;
    this.setBodyScale(opts.bodyScale);
  }

  /** Back to the normal elite tuning and base body (same centre); hp untouched. */
  clearBoss(): void {
    this.bossMaxHp = null;
    this.advanceMult = 1;
    this.clearBarrage();
    if (this._bodyScale !== 1) this.setBodyScale(1);
  }

  /**
   * Queues `strikes` consecutive swings, `pauseMs` apart (instead of the pattern pause), chasing into range
   * as needed. Ignored unless idle/chasing and not already barraging. Stagger, parry, respawn and
   * configureBoss/clearBoss cancel it.
   */
  startBarrage(strikes: number, pauseMs: number): void {
    if (this.state !== 'idle' && this.state !== 'chasing') return;
    if (this.isBarraging || strikes < 1) return;
    this.barrageRemaining = Math.floor(strikes);
    this.barragePauseMs = pauseMs;
  }

  private clearBarrage(): void {
    this.barrageRemaining = 0;
    this.barrageStrikeActive = false;
  }

  get activeRuleId(): string | null {
    return this._activeRuleId;
  }

  get attackDirection(): Vec2 {
    return { x: this._attackDirection.x, y: this._attackDirection.y };
  }

  /** Lunge phase for presentation; null outside a lunge. */
  get lungePhase(): 'telegraph' | 'charge' | null {
    if (this.state !== 'lunging') return null;
    return this.lungeMoving ? 'charge' : 'telegraph';
  }

  /** Locked into an attack (swing or lunge): any other player action is a wrong answer. */
  get isCommitted(): boolean {
    return this.state === 'attacking' || this.state === 'lunging';
  }

  /** Kind of the attack in progress (the lunge included); null while not attacking. */
  get attackKind(): AttackKind | null {
    if (this.state === 'lunging') return 'lunge';
    if (this.state === 'attacking') return this.patternKind;
    return null;
  }

  /** The wind-up in progress (swing, combo strike, slam or lunge aim); null outside any telegraph. */
  get telegraph(): TelegraphView | null {
    const origin = { x: this._position.x + this.width / 2, y: this._position.y + this.height / 2 };
    const direction = { x: this._attackDirection.x, y: this._attackDirection.y };
    if (this.state === 'lunging') {
      if (this.lungeMoving) return null;
      return {
        kind: 'lunge',
        progress: Math.min(1, this.phaseElapsedMs / this.lungeTelegraphMs),
        origin,
        direction,
        reach: this.swingReach,
        halfAngleRad: ATTACK_HALF_ANGLE_RAD,
        travel: this.lungeMaxTravel,
        contactDistance: this.lungeContactDistance,
      };
    }
    if (this.state !== 'attacking') return null;
    const tele = this.strikeTelegraphMs;
    if (this.phaseElapsedMs >= tele) return null;
    const progress = this.phaseElapsedMs / tele;
    if (this.patternKind === 'slam') {
      return {
        kind: 'slam',
        progress,
        origin,
        direction,
        reach: this.slamReach,
        halfAngleRad: Math.PI,
        radius: this.slamRadius,
      };
    }
    const view: TelegraphView = {
      kind: this.patternKind,
      progress,
      origin,
      direction,
      reach: this.swingReach,
      halfAngleRad: ATTACK_HALF_ANGLE_RAD,
    };
    if (this.patternKind === 'combo') view.hit = this.comboStrike;
    return view;
  }

  /** HP damage of the strike in progress (the slam hits harder). */
  get currentStrikeDamage(): number {
    return this.state === 'attacking' && this.patternKind === 'slam' ? ELITE.slamDamage : ELITE.swingDamage;
  }

  /** Telegraph of the strike in progress, in ms. */
  private get strikeTelegraphMs(): number {
    if (this.patternKind === 'slam') return ELITE_TELEGRAPH_MS.slam;
    if (this.patternKind === 'combo' && this.comboStrike === 2) return ELITE_TELEGRAPH_MS.combo;
    return ELITE_TELEGRAPH_MS.swing;
  }

  private get strikeActiveMs(): number {
    return this.patternKind === 'slam' ? ELITE.slamActiveMs : SWING_MS;
  }

  /** New PRNG for the weighted pattern choice (RunDirector derives it from the run seed). */
  reseed(seed: number): void {
    this.prng = createPrng(seed);
  }

  /** The mandatory pause since the last pattern and the first-attack delay since birth are both over. */
  private get patternReady(): boolean {
    return this.ageMs >= ELITE.firstAttackDelayMs && this.sincePatternMs >= ELITE.patternPauseMs;
  }

  /**
   * Starts a combo or a ground slam now. Ignored unless the elite is idle or chasing
   * (the weighted choice of the pattern lives in the selector, not here).
   */
  beginPattern(kind: 'combo' | 'slam', playerPosition: Vec2): void {
    if (this.state !== 'idle' && this.state !== 'chasing') return;
    const anchor = this.anchor;
    const dx = playerPosition.x - anchor.x;
    const dy = playerPosition.y - anchor.y;
    this.playerPosition = { x: playerPosition.x, y: playerPosition.y };
    this.startPattern(kind, dx, dy, Math.hypot(dx, dy));
  }

  private startPattern(kind: 'swing' | 'combo' | 'slam', dx: number, dy: number, distanceToPlayer: number): void {
    this.state = 'attacking';
    this.patternKind = kind;
    this.comboStrike = 1;
    this.phaseElapsedMs = 0;
    this.aimAt(dx, dy, distanceToPlayer);
    // attack start first: it is the cause of the dodge window (log order = causal order)
    this.bus.emit('enemy.attack_start', kind === 'combo' ? { kind, hit: 1 } : { kind });
    this.activeOppId = this.opp.open(
      'dodge',
      kind === 'swing' ? 'assaltante.attack' : `assaltante.${kind}`,
      this.strikeTelegraphMs + this.strikeActiveMs,
    );
  }

  private aimAt(dx: number, dy: number, distance: number): void {
    if (distance > 0) this._attackDirection = normalizeVelocity(dx, dy);
  }

  /** End of combo strike 1: its window closes through the normal expiry path, then strike 2 opens its own. */
  private startSecondComboStrike(dx: number, dy: number, distance: number): void {
    if (this.activeOppId) this.opp.expire(this.activeOppId);
    this.comboStrike = 2;
    this.phaseElapsedMs = 0;
    this.aimAt(dx, dy, distance);
    this.bus.emit('enemy.attack_start', { kind: 'combo', hit: 2 });
    this.activeOppId = this.opp.open('dodge', 'assaltante.combo', this.strikeTelegraphMs + this.strikeActiveMs);
  }

  get isDead(): boolean {
    return this.hp <= 0;
  }

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
  }

  /**
   * Fresh Assaltante at `position`. Any window it still has open is closed as
   * `invalid` with `reason` so the opportunity denominator never leaks
   * (conservation law, doc §2.4): 'source_interrupted' when it died,
   * 'player_dead' when the run ended.
   */
  respawn(position: Vec2, reason: InvalidReason): void {
    this.closeOpenWindows(reason);
    this._position = { x: position.x, y: position.y };
    this._bodyScale = 1;
    this.width = this.baseWidth;
    this.height = this.baseHeight;
    this.hp = ASSALTANTE_MAX_HP;
    this.state = 'idle';
    this.phaseElapsedMs = 0;
    this._activeRuleId = null;
    this.playerWasInRangeDuringPunish = false;
    this.lungeCooldownMs = Math.max(ELITE.firstAttackDelayMs, LUNGE.cooldownMs);
    this.chargeCooldownMs = Math.max(ELITE.firstAttackDelayMs, LONG_LUNGE.cooldownMs);
    this.lungeLong = false;
    this.lungeTelegraphMs = LUNGE.telegraphMs;
    this.lungeMaxTravel = LUNGE.maxTravel;
    this.ageMs = 0;
    this.sincePatternMs = 0;
    this.lungeMoving = false;
    this.lungeTravelled = 0;
    this.lungeLandedThisTick = false;
    this.recoveryDurationMs = RECOVERY_MS;
    this.patternKind = 'swing';
    this.comboStrike = 1;
    this.bossMaxHp = null;
    this.advanceMult = 1;
    this.clearBarrage();
  }

  private closeOpenWindows(reason: InvalidReason): void {
    for (const id of [this.activeOppId, this.lungeDodgeOppId]) {
      if (id) this.opp.resolve(id, 'invalid', { reason });
    }
    this.activeOppId = null;
    this.lungeDodgeOppId = null;
  }

  /**
   * Interrupted from outside (the bomb): the open window is closed as
   * `invalid`/`source_interrupted` and the enemy recovers for `ms` with no
   * punish window.
   */
  stagger(ms: number): void {
    this.closeOpenWindows('source_interrupted');
    this.state = 'recovering';
    this.phaseElapsedMs = 0;
    this.lungeMoving = false;
    this.lungeLandedThisTick = false;
    this.playerWasInRangeDuringPunish = false;
    this.recoveryDurationMs = ms;
    this.patternKind = 'swing';
    this.comboStrike = 1;
    this.clearBarrage(); // a stagger cancels the barrage
  }

  hurtbox(): AABB {
    return { x: this._position.x, y: this._position.y, width: this.width, height: this.height };
  }

  attackHitbox(): AttackSector | null {
    const lungeStrike = this.state === 'lunging' && this.lungeMoving;
    if (!lungeStrike) {
      if (this.state !== 'attacking') return null;
      if (this.phaseElapsedMs < this.strikeTelegraphMs) return null;
    }
    const center = { x: this._position.x + this.width / 2, y: this._position.y + this.height / 2 };
    if (this.state === 'attacking' && this.patternKind === 'slam') {
      return directionalSector(center, this._attackDirection, this.slamReach, Math.PI);
    }
    return directionalSector(center, this._attackDirection, this.swingReach, ATTACK_HALF_ANGLE_RAD);
  }

  /**
   * True while a strike is in progress: the swing phase of an attack, or a
   * lunge body in motion within contact distance of the player (the tick on
   * which the lunge ends still counts).
   */
  strikeLanding(): boolean {
    return this.lungeLandedThisTick || (this.state === 'attacking' && this.attackHitbox() !== null);
  }

  msUntilThreatens(target: AABB, horizonMs: number): number | null {
    if (this.state === 'lunging') {
      const cx = this._position.x + this.width / 2 - (target.x + target.width / 2);
      const cy = this._position.y + this.height / 2 - (target.y + target.height / 2);
      if (Math.hypot(cx, cy) > this.lungeMaxTravel + this.lungeContactDistance) return null;
      if (this.lungeMoving) return 0;
      const remaining = Math.max(0, this.lungeTelegraphMs - this.phaseElapsedMs);
      return remaining <= horizonMs ? remaining : null;
    }
    const snapshot: ChaseTelegraphSnapshot = {
      state: this.state,
      phaseElapsedMs: this.phaseElapsedMs,
      position: this._position,
      width: this.width,
      height: this.height,
      ...(this._bodyScale !== 1
        ? { anchorOffset: { x: (this.width - this.baseWidth) / 2, y: (this.height - this.baseHeight) / 2 } }
        : {}),
      attackDirection: this._attackDirection,
      readyInMs:
        this.state === 'idle' || this.state === 'chasing'
          ? this.barrageRemaining > 0
            ? Math.max(0, this.barragePauseMs - this.sincePatternMs)
            : Math.max(0, ELITE.firstAttackDelayMs - this.ageMs, ELITE.patternPauseMs - this.sincePatternMs)
          : 0,
    };
    const config: ChaseTelegraphConfig = {
      attackRange: ATTACK_RANGE * this._bodyScale,
      chaseSpeedPxPerSec: this.chaseSpeed,
      telegraphMs: this.state === 'attacking' ? this.strikeTelegraphMs : TELEGRAPH_MS,
      swingMs: SWING_MS,
      recoveryMs: this.state === 'recovering' ? this.recoveryDurationMs : RECOVERY_MS,
      reach: this.swingReach,
      halfAngleRad: ATTACK_HALF_ANGLE_RAD,
      patternPauseMs: ELITE.patternPauseMs,
    };
    if (this.state === 'attacking' && this.patternKind !== 'swing') {
      return this.patternThreatMs(config, snapshot, target, horizonMs);
    }
    return predictThreatMs(config, snapshot, target, horizonMs);
  }

  /**
   * Combo or slam in progress. Conservative: a combo's second strike is re-aimed at an unknown
   * direction, so while strike 1 runs it threatens anyone inside the full reach circle.
   */
  private patternThreatMs(
    config: ChaseTelegraphConfig,
    snapshot: ChaseTelegraphSnapshot,
    target: AABB,
    horizonMs: number,
  ): number | null {
    const center = { x: this._position.x + this.width / 2, y: this._position.y + this.height / 2 };
    const tele = this.strikeTelegraphMs;
    const active = this.strikeActiveMs;
    const toActive = Math.max(0, tele - this.phaseElapsedMs);
    const strikeEnd = tele + active - this.phaseElapsedMs;
    const radius = this.patternKind === 'slam' ? this.slamReach : this.swingReach;
    const aimed =
      this.patternKind === 'slam'
        ? directionalSector(center, this._attackDirection, radius, Math.PI)
        : directionalSector(center, this._attackDirection, radius, ATTACK_HALF_ANGLE_RAD);
    if (toActive <= horizonMs && sectorOverlapsBox(aimed, target)) return toActive;

    let patternEnd = strikeEnd;
    if (this.patternKind === 'combo' && this.comboStrike === 1) {
      const second = strikeEnd + ELITE_TELEGRAPH_MS.combo;
      const circle = directionalSector(center, this._attackDirection, radius, Math.PI);
      if (second <= horizonMs && sectorOverlapsBox(circle, target)) return second;
      patternEnd = second + SWING_MS;
    }
    if (patternEnd > horizonMs) return null;
    const tail = predictThreatMs(
      this.patternKind === 'slam' ? { ...config, recoveryMs: ELITE.slamRecoveryMs } : config,
      { ...snapshot, state: 'recovering', phaseElapsedMs: 0 },
      target,
      horizonMs - patternEnd,
    );
    return tail === null ? null : patternEnd + tail;
  }

  step(stepMs: number, playerPosition: Vec2): void {
    const anchor = this.anchor;
    const dx = playerPosition.x - anchor.x;
    const dy = playerPosition.y - anchor.y;
    const distanceToPlayer = Math.hypot(dx, dy);
    this.playerPosition = { x: playerPosition.x, y: playerPosition.y };
    this.lungeLandedThisTick = false;
    this.lungeCooldownMs = Math.max(0, this.lungeCooldownMs - stepMs);
    this.chargeCooldownMs = Math.max(0, this.chargeCooldownMs - stepMs);
    this.ageMs += stepMs;
    // The pause clock only runs while the elite is free (idle/chasing): any pattern, stagger or parry restarts it.
    if (this.state === 'idle' || this.state === 'chasing') this.sincePatternMs += stepMs;
    else this.sincePatternMs = 0;

    // The lunge ended (full travel or wall) with its dodge window still open: close it through the normal expiry
    // path on the next step (after Encounter evaluated the final charge tick), so a retreat is inferred in time
    // and the stale window cannot outlive the recovery.
    if (this.state !== 'lunging' && this.lungeDodgeOppId) {
      this.opp.expire(this.lungeDodgeOppId);
      this.lungeDodgeOppId = null;
    }

    if ((this.state === 'idle' || this.state === 'chasing') && this.barrageRemaining > 0) {
      // Barrage: no pattern draw (the PRNG is not consumed), no first-attack delay, own pause.
      if (distanceToPlayer <= ATTACK_RANGE * this._bodyScale && this.sincePatternMs >= this.barragePauseMs) {
        this._activeRuleId = 'assaltante.attack';
        this.barrageRemaining--;
        this.barrageStrikeActive = true;
        this.startPattern('swing', dx, dy, distanceToPlayer);
      } else {
        this._activeRuleId = 'assaltante.chase';
        this.chase(stepMs, dx, dy, distanceToPlayer);
      }
    } else if (this.state === 'idle' || this.state === 'chasing') {
      const bb: Blackboard = {
        distanceToPlayer,
        state: this.state,
        lungeReady: this.lungeCooldownMs <= 0,
        chargeReady: this.chargeCooldownMs <= 0,
        patternReady: this.patternReady,
        ...(this._bodyScale !== 1 ? { reachScale: this._bodyScale } : {}),
      };
      const rule = choosePatternRule(bb, this.prng);
      this._activeRuleId = rule.id;
      if (rule.pattern === 'swing' || rule.pattern === 'combo' || rule.pattern === 'slam') {
        this.startPattern(rule.pattern, dx, dy, distanceToPlayer);
      } else if (rule.pattern === 'lunge') {
        this.state = 'lunging';
        this.phaseElapsedMs = 0;
        this.lungeMoving = false;
        this.lungeTravelled = 0;
        this.lungeLong = distanceToPlayer > LUNGE.maxDistance;
        this.lungeTelegraphMs = this.lungeLong ? LONG_LUNGE.telegraphMs : LUNGE.telegraphMs;
        this.lungeMaxTravel = this.lungeLong ? longTravelFor(distanceToPlayer) : LUNGE.maxTravel;
        if (this.lungeLong) this.chargeCooldownMs = LONG_LUNGE.cooldownMs;
        else this.lungeCooldownMs = LUNGE.cooldownMs;
        this._attackDirection = distanceToPlayer > 0 ? normalizeVelocity(dx, dy) : this._attackDirection;
        this.bus.emit('enemy.attack_start', { kind: 'lunge' });
        this.activeOppId = this.opp.open('dodge', 'assaltante.lunge', lungeWindowMs(this.lungeLong));
        this.lungeDodgeOppId = this.activeOppId;
      } else {
        this.chase(stepMs, dx, dy, distanceToPlayer);
      }
    }

    this.phaseElapsedMs += stepMs;

    if (this.state === 'lunging') {
      this.stepLunge(stepMs, dx, dy, distanceToPlayer);
      return;
    }

    if (this.state === 'attacking') {
      if (this.phaseElapsedMs >= this.strikeTelegraphMs + this.strikeActiveMs) {
        if (this.patternKind === 'combo' && this.comboStrike === 1) {
          this.startSecondComboStrike(dx, dy, distanceToPlayer);
          return;
        }
        if (this.barrageStrikeActive) {
          this.barrageStrikeActive = false;
          if (this.barrageRemaining > 0) {
            // Mid-barrage: straight back to idle (no recovery, no punish window); the swing's dodge
            // window expires on its own. The next swing waits only the barrage pause.
            this.state = 'idle';
            this.phaseElapsedMs = 0;
            this.activeOppId = null;
            return;
          }
        }
        const punishMs = this.patternKind === 'slam' ? ELITE.slamRecoveryMs : RECOVERY_MS;
        this.state = 'recovering';
        this.phaseElapsedMs = 0;
        this.recoveryDurationMs = punishMs;
        this.playerWasInRangeDuringPunish = false;
        this.activeOppId = this.opp.open('punish', 'assaltante.recover', punishMs, () =>
          this.playerWasInRangeDuringPunish
            ? { outcome: 'expired' }
            : { outcome: 'invalid', reason: 'out_of_range' },
        );
      }
      return;
    }

    if (this.state === 'recovering') {
      // The player's own reach to this body: a grown body is reached from further, by its extra half width.
      if (distanceToPlayer <= ATTACK_REACH + (this.width - this.baseWidth) / 2) {
        this.playerWasInRangeDuringPunish = true;
      }
      if (this.phaseElapsedMs >= this.recoveryDurationMs) {
        this.recoveryDurationMs = RECOVERY_MS;
        this.state = 'idle';
        this.phaseElapsedMs = 0;
        this.activeOppId = null;
      }
      return;
    }
  }

  private chase(stepMs: number, dx: number, dy: number, distanceToPlayer: number): void {
    this.state = 'chasing';
    const direction = distanceToPlayer > 0 ? normalizeVelocity(dx, dy) : { x: 0, y: 0 };
    if (distanceToPlayer > 0) this._attackDirection = direction;
    this._position = clampToArena(
      applyMovement(this._position, direction, this.chaseSpeed, stepMs),
      this.width,
      this.height,
      ARENA_BOUNDS,
    );
  }

  /** Lunge: telegraph standing still (aim follows the player), then a straight charge locked on the final aim. */
  private stepLunge(stepMs: number, dx: number, dy: number, distanceToPlayer: number): void {
    if (!this.lungeMoving) {
      if (distanceToPlayer > 0) this._attackDirection = normalizeVelocity(dx, dy);
      if (this.lungeLong) this.lungeMaxTravel = longTravelFor(distanceToPlayer);
      if (this.phaseElapsedMs >= this.lungeTelegraphMs) {
        this.lungeMoving = true;
        this.lungeLockPlayerPosition = { x: this.playerPosition.x, y: this.playerPosition.y };
        this.lungeTravelled = 0;
      }
      return;
    }

    const intended = Math.min((LUNGE.speed * stepMs) / 1000, this.lungeMaxTravel - this.lungeTravelled);
    const before = this._position;
    this._position = clampToArena(
      { x: before.x + this._attackDirection.x * intended, y: before.y + this._attackDirection.y * intended },
      this.width,
      this.height,
      ARENA_BOUNDS,
    );
    const moved = Math.hypot(this._position.x - before.x, this._position.y - before.y);
    this.lungeTravelled += moved;
    const anchor = this.anchor;
    const px = this.playerPosition.x - anchor.x;
    const py = this.playerPosition.y - anchor.y;
    const lx = this.lungeLockPlayerPosition.x - anchor.x;
    const ly = this.lungeLockPlayerPosition.y - anchor.y;
    const contact = this.lungeContactDistance;
    this.lungeLandedThisTick = Math.hypot(px, py) <= contact || Math.hypot(lx, ly) <= contact;

    const hitWall = moved < intended - 1e-6;
    if (hitWall || this.lungeTravelled >= this.lungeMaxTravel - 1e-6) {
      this.endLunge(LUNGE.recoveryMs);
    }
  }

  private endLunge(punishMs: number): void {
    this.state = 'recovering';
    this.phaseElapsedMs = 0;
    this.lungeMoving = false;
    this.playerWasInRangeDuringPunish = false;
    this.recoveryDurationMs = RECOVERY_MS;
    this.activeOppId = this.opp.open('punish', 'assaltante.recover', punishMs, () =>
      this.playerWasInRangeDuringPunish
        ? { outcome: 'expired' }
        : { outcome: 'invalid', reason: 'out_of_range' },
    );
  }

  onPlayerDodgeSuccess(): void {
    if (this.isCommitted && this.activeOppId) {
      this.opp.resolve(this.activeOppId, 'taken');
      if (this.activeOppId === this.lungeDodgeOppId) this.lungeDodgeOppId = null;
      this.activeOppId = null;
    }
  }

  onPlayerParrySuccess(): void {
    if (!this.isCommitted || !this.activeOppId) return;
    this.opp.resolve(this.activeOppId, 'taken');
    this.clearBarrage(); // a parry cancels the barrage
    this.lungeDodgeOppId = null;
    this.lungeMoving = false;
    this.lungeLandedThisTick = false;
    this.state = 'recovering';
    this.phaseElapsedMs = 0;
    this.playerWasInRangeDuringPunish = false;
    this.activeOppId = this.opp.open('punish', 'assaltante.recover', PARRY_BONUS_RECOVERY_MS, () =>
      this.playerWasInRangeDuringPunish
        ? { outcome: 'expired' }
        : { outcome: 'invalid', reason: 'out_of_range' },
    );
  }

  onPlayerHitLanded(): void {
    if (this.state === 'recovering' && this.activeOppId) {
      this.opp.resolve(this.activeOppId, 'taken');
      this.activeOppId = null;
    }
  }

  onPlayerWrongAction(attempt: ActionId): void {
    if (this.isCommitted && this.activeOppId) {
      this.opp.resolve(this.activeOppId, 'missed', { attempt });
      if (this.activeOppId === this.lungeDodgeOppId) this.lungeDodgeOppId = null;
      this.activeOppId = null;
    }
  }
}
