// src/combat/assaltanteController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { OpportunitySystem } from '../opportunity/opportunitySystem';
import type { AABB, EnemyState, Vec2 } from './types';
import type { ActionId, InvalidReason } from '../opportunity/types';
import { ASSALTANTE_RULES, ATTACK_RANGE, type Blackboard } from '../ai/rules/assaltanteRules';
import { ASSALTANTE_CHASE_SPEED, ARENA_BOUNDS, ATTACK_REACH, ATTACK_HALF_ANGLE_RAD, ASSALTANTE_MAX_HP, LUNGE } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena } from './movement';
import { directionalSector, type AttackSector } from './sector';
import { PARRY_BONUS_RECOVERY_MS } from './actionDefs';
import { predictThreatMs, type ChaseTelegraphConfig, type ChaseTelegraphSnapshot } from './threatPrediction';
import type { ThreatAssessor } from './patience';

export const TELEGRAPH_MS = 400; // = dodge window
const SWING_MS = 150;
const RECOVERY_MS = 500; // = punish window
const LUNGE_DODGE_WINDOW_MS = LUNGE.telegraphMs + (LUNGE.maxTravel / LUNGE.speed) * 1000;

export class AssaltanteController implements ThreatAssessor {
  state: EnemyState = 'idle';
  hp = ASSALTANTE_MAX_HP;
  private phaseElapsedMs = 0;
  private activeOppId: string | null = null;
  private _activeRuleId: string | null = null;
  private _position: Vec2;
  private readonly width: number;
  private readonly height: number;
  private _attackDirection: Vec2 = { x: -1, y: 0 };
  private playerWasInRangeDuringPunish = false;
  private lungeCooldownMs: number = LUNGE.cooldownMs;
  private lungeMoving = false;
  private lungeTravelled = 0;
  private lungeLandedThisTick = false;
  /** Player position when the telegraph locked: a sideways dash timed at the strike still counts as a dodge. */
  private lungeLockPlayerPosition: Vec2 = { x: 0, y: 0 };
  /** Lunge dodge window, kept so it can be closed if the lunge ends early (wall) while it is still open. */
  private lungeDodgeOppId: string | null = null;
  private recoveryDurationMs = RECOVERY_MS;
  private playerPosition: Vec2 = { x: 0, y: 0 };

  constructor(
    private bus: EventBus<GameEvents>,
    private opp: OpportunitySystem,
    initialHurtbox: AABB,
  ) {
    this._position = { x: initialHurtbox.x, y: initialHurtbox.y };
    this.width = initialHurtbox.width;
    this.height = initialHurtbox.height;
  }

  get position(): Vec2 {
    return { x: this._position.x, y: this._position.y };
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
    this.hp = ASSALTANTE_MAX_HP;
    this.state = 'idle';
    this.phaseElapsedMs = 0;
    this._activeRuleId = null;
    this.playerWasInRangeDuringPunish = false;
    this.lungeCooldownMs = LUNGE.cooldownMs;
    this.lungeMoving = false;
    this.lungeTravelled = 0;
    this.lungeLandedThisTick = false;
    this.recoveryDurationMs = RECOVERY_MS;
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
  }

  hurtbox(): AABB {
    return { x: this._position.x, y: this._position.y, width: this.width, height: this.height };
  }

  attackHitbox(): AttackSector | null {
    const lungeStrike = this.state === 'lunging' && this.lungeMoving;
    if (!lungeStrike) {
      if (this.state !== 'attacking') return null;
      if (this.phaseElapsedMs < TELEGRAPH_MS) return null;
    }
    const center = { x: this._position.x + this.width / 2, y: this._position.y + this.height / 2 };
    return directionalSector(center, this._attackDirection, ATTACK_REACH + this.width / 2, ATTACK_HALF_ANGLE_RAD);
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
      if (this.lungeMoving) return 0;
      const remaining = Math.max(0, LUNGE.telegraphMs - this.phaseElapsedMs);
      return remaining <= horizonMs ? remaining : null;
    }
    const snapshot: ChaseTelegraphSnapshot = {
      state: this.state,
      phaseElapsedMs: this.phaseElapsedMs,
      position: this._position,
      width: this.width,
      height: this.height,
      attackDirection: this._attackDirection,
    };
    const config: ChaseTelegraphConfig = {
      attackRange: ATTACK_RANGE,
      chaseSpeedPxPerSec: ASSALTANTE_CHASE_SPEED,
      telegraphMs: TELEGRAPH_MS,
      swingMs: SWING_MS,
      recoveryMs: RECOVERY_MS,
      reach: ATTACK_REACH + this.width / 2,
      halfAngleRad: ATTACK_HALF_ANGLE_RAD,
    };
    return predictThreatMs(config, snapshot, target, horizonMs);
  }

  step(stepMs: number, playerPosition: Vec2): void {
    const dx = playerPosition.x - this._position.x;
    const dy = playerPosition.y - this._position.y;
    const distanceToPlayer = Math.hypot(dx, dy);
    this.playerPosition = { x: playerPosition.x, y: playerPosition.y };
    this.lungeLandedThisTick = false;
    this.lungeCooldownMs = Math.max(0, this.lungeCooldownMs - stepMs);

    if (this.state === 'idle' || this.state === 'chasing') {
      const bb: Blackboard = { distanceToPlayer, state: this.state, lungeReady: this.lungeCooldownMs <= 0 };
      const rule = ASSALTANTE_RULES.find((r) => r.precond(bb));
      this._activeRuleId = rule?.id ?? null;
      if (rule?.id === 'assaltante.attack') {
        this.state = 'attacking';
        this.phaseElapsedMs = 0;
        this._attackDirection = distanceToPlayer > 0 ? normalizeVelocity(dx, dy) : this._attackDirection;
        // attack start first: it is the cause of the dodge window (log order = causal order)
        this.bus.emit('enemy.attack_start', { kind: 'swing' });
        this.activeOppId = this.opp.open('dodge', 'assaltante.attack', TELEGRAPH_MS + SWING_MS);
      } else if (rule?.id === 'assaltante.lunge') {
        this.state = 'lunging';
        this.phaseElapsedMs = 0;
        this.lungeMoving = false;
        this.lungeTravelled = 0;
        this.lungeCooldownMs = LUNGE.cooldownMs;
        this._attackDirection = distanceToPlayer > 0 ? normalizeVelocity(dx, dy) : this._attackDirection;
        this.bus.emit('enemy.attack_start', { kind: 'lunge' });
        this.activeOppId = this.opp.open('dodge', 'assaltante.lunge', LUNGE_DODGE_WINDOW_MS);
        this.lungeDodgeOppId = this.activeOppId;
      } else {
        this.state = 'chasing';
        const direction = distanceToPlayer > 0 ? normalizeVelocity(dx, dy) : { x: 0, y: 0 };
        if (distanceToPlayer > 0) this._attackDirection = direction;
        this._position = clampToArena(
          applyMovement(this._position, direction, ASSALTANTE_CHASE_SPEED, stepMs),
          this.width,
          this.height,
          ARENA_BOUNDS,
        );
      }
    }

    this.phaseElapsedMs += stepMs;

    if (this.state === 'lunging') {
      this.stepLunge(stepMs, dx, dy, distanceToPlayer);
      return;
    }

    if (this.state === 'attacking') {
      if (this.phaseElapsedMs >= TELEGRAPH_MS + SWING_MS) {
        this.state = 'recovering';
        this.phaseElapsedMs = 0;
        this.playerWasInRangeDuringPunish = false;
        this.activeOppId = this.opp.open('punish', 'assaltante.recover', RECOVERY_MS, () =>
          this.playerWasInRangeDuringPunish
            ? { outcome: 'expired' }
            : { outcome: 'invalid', reason: 'out_of_range' },
        );
      }
      return;
    }

    if (this.state === 'recovering') {
      if (distanceToPlayer <= ATTACK_REACH) {
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

  /** Lunge: telegraph standing still (aim follows the player), then a straight charge locked on the final aim. */
  private stepLunge(stepMs: number, dx: number, dy: number, distanceToPlayer: number): void {
    if (!this.lungeMoving) {
      if (distanceToPlayer > 0) this._attackDirection = normalizeVelocity(dx, dy);
      if (this.phaseElapsedMs >= LUNGE.telegraphMs) {
        this.lungeMoving = true;
        this.lungeLockPlayerPosition = { x: this.playerPosition.x, y: this.playerPosition.y };
        this.lungeTravelled = 0;
      }
      return;
    }

    const intended = Math.min((LUNGE.speed * stepMs) / 1000, LUNGE.maxTravel - this.lungeTravelled);
    const before = this._position;
    this._position = clampToArena(
      { x: before.x + this._attackDirection.x * intended, y: before.y + this._attackDirection.y * intended },
      this.width,
      this.height,
      ARENA_BOUNDS,
    );
    const moved = Math.hypot(this._position.x - before.x, this._position.y - before.y);
    this.lungeTravelled += moved;
    const px = this.playerPosition.x - this._position.x;
    const py = this.playerPosition.y - this._position.y;
    const lx = this.lungeLockPlayerPosition.x - this._position.x;
    const ly = this.lungeLockPlayerPosition.y - this._position.y;
    this.lungeLandedThisTick =
      Math.hypot(px, py) <= LUNGE.contactDistance || Math.hypot(lx, ly) <= LUNGE.contactDistance;

    const hitWall = moved < intended - 1e-6;
    if (hitWall || this.lungeTravelled >= LUNGE.maxTravel - 1e-6) {
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
