// src/combat/playerController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { AABB, PlayerState, Vec2 } from './types';
import {
  DODGE,
  SWITCH_RECOVERY_MS,
  STAGGER_MS,
  PARRY_WINDOW_MS,
  INPUT_BUFFER_MS,
} from './actionDefs';
import { resolveAction, totalCommitmentMs, lockedMs, type ActionDef } from './actionRegistry';
import {
  PLAYER_WALK_SPEED,
  PLAYER_RUN_SPEED,
  BLOCK_MOVE_SPEED_FACTOR,
  DASH_DISTANCE,
  ARENA_BOUNDS,
  ATTACK_HALF_ANGLE_RAD,
  PLAYER_MAX_HP,
} from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena } from './movement';
import { directionalSector, type AttackSector } from './sector';
import { Stamina, STAMINA_COST } from './stamina';
import { InputBuffer, type BufferedInput } from './inputBuffer';
import type { ProjectileLaunch } from './projectile';

export class PlayerController {
  state: PlayerState = 'idle';
  private phaseElapsedMs = 0;
  private currentAction: ActionDef | null = null;
  private chargeHeldMs = 0;
  private chargeTriggered = false;
  equippedWeaponId: string = 'sword_shield';
  private attackLockedMs = 0;
  private dodgeCooldownRemainingMs = 0;
  private invulnerable = false;
  private _position: Vec2;
  private readonly width: number;
  private readonly height: number;
  private moveInput: Vec2 = { x: 0, y: 0 };
  private aimDirection: Vec2 = { x: 1, y: 0 };
  private committedDirection: Vec2 = { x: 1, y: 0 };
  private dashDirection: Vec2 = { x: 1, y: 0 };
  readonly stamina = new Stamina();
  private sprintRequested = false;
  hp = PLAYER_MAX_HP;
  private launched = false;
  private pendingLaunch: ProjectileLaunch | null = null;
  private blockHeldMs = 0;
  private staggerRemainingMs = 0;
  private clockMs = 0;
  private readonly inputBuffer = new InputBuffer(INPUT_BUFFER_MS);

  constructor(
    private bus: EventBus<GameEvents>,
    initialHurtbox: AABB,
  ) {
    this._position = { x: initialHurtbox.x, y: initialHurtbox.y };
    this.width = initialHurtbox.width;
    this.height = initialHurtbox.height;
  }

  get isInvulnerable(): boolean {
    return this.invulnerable;
  }

  get position(): Vec2 {
    return { x: this._position.x, y: this._position.y };
  }

  get facing(): Vec2 {
    return { x: this.aimDirection.x, y: this.aimDirection.y };
  }

  /** Sprint requested, moving, free to move (idle) and with stamina left. */
  get isSprinting(): boolean {
    return (
      this.sprintRequested &&
      this.state === 'idle' &&
      this.stamina.value > 0 &&
      (this.moveInput.x !== 0 || this.moveInput.y !== 0)
    );
  }

  /** Ms since the dash began; null outside `dodging`. */
  get dashAgeMs(): number | null {
    return this.state === 'dodging' ? this.phaseElapsedMs : null;
  }

  /** Perfect-dodge reward: gives the dodge cost back. Returns the amount. */
  refundDodge(): number {
    this.stamina.refund(STAMINA_COST.dodge);
    return STAMINA_COST.dodge;
  }

  setSprint(on: boolean): void {
    this.sprintRequested = on;
  }

  get isBlocking(): boolean {
    return this.state === 'blocking';
  }

  get isParryTiming(): boolean {
    return this.state === 'blocking' && this.blockHeldMs < PARRY_WINDOW_MS;
  }

  /** Past the non-cancelable part of an action: any input ends it. */
  get isInRecovery(): boolean {
    return (
      this.state === 'acting' &&
      this.currentAction !== null &&
      this.chargeTriggered &&
      this.phaseElapsedMs >= lockedMs(this.currentAction)
    );
  }

  private get isCharging(): boolean {
    return this.state === 'acting' && this.currentAction?.actionType === 'charged' && !this.chargeTriggered;
  }

  get isDead(): boolean {
    return this.hp <= 0;
  }

  /** The action currently being performed (null when not acting). Read-only view for Encounter's damage step. */
  get currentActionDef(): ActionDef | null {
    return this.currentAction;
  }

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
  }

  /**
   * Start-of-run state: full hp and stamina, idle, default weapon, no cooldowns,
   * any in-progress (including charging) action discarded. Death itself does
   * not gate behavior — RunDirector calls this in the same tick the player dies.
   */
  reset(position: Vec2): void {
    this._position = { x: position.x, y: position.y };
    this.hp = PLAYER_MAX_HP;
    this.stamina.reset();
    this.sprintRequested = false;
    this.state = 'idle';
    this.phaseElapsedMs = 0;
    this.currentAction = null;
    this.chargeHeldMs = 0;
    this.chargeTriggered = false;
    this.launched = false;
    this.pendingLaunch = null;
    this.equippedWeaponId = 'sword_shield';
    this.attackLockedMs = 0;
    this.dodgeCooldownRemainingMs = 0;
    this.invulnerable = false;
    this.blockHeldMs = 0;
    this.staggerRemainingMs = 0;
    this.moveInput = { x: 0, y: 0 };
    this.clockMs = 0;
    this.inputBuffer.clear();
  }

  hurtbox(): AABB {
    return { x: this._position.x, y: this._position.y, width: this.width, height: this.height };
  }

  /** The projectile the current `throw` action releases, once, when its startup elapses; null otherwise. */
  takeLaunch(): ProjectileLaunch | null {
    const launch = this.pendingLaunch;
    this.pendingLaunch = null;
    return launch;
  }

  attackHitbox(): AttackSector | null {
    if (this.state !== 'acting' || !this.currentAction) return null;
    if (this.currentAction.actionType === 'throw') return null; // the shot is a projectile, not a sector

    const center = { x: this._position.x + this.width / 2, y: this._position.y + this.height / 2 };

    if (this.currentAction.actionType === 'charged') {
      if (!this.chargeTriggered) return null;
      if (this.phaseElapsedMs >= this.currentAction.timing.activeMs) return null;
      return directionalSector(
        center,
        this.committedDirection,
        this.chargedReach() + this.width / 2,
        ATTACK_HALF_ANGLE_RAD,
      );
    }

    const { startupMs, activeMs } = this.currentAction.timing;
    const inActive = this.phaseElapsedMs >= startupMs && this.phaseElapsedMs < startupMs + activeMs;
    if (!inActive) return null;
    return directionalSector(
      center,
      this.committedDirection,
      this.currentAction.reach + this.width / 2,
      ATTACK_HALF_ANGLE_RAD,
    );
  }

  setMoveInput(dx: number, dy: number): void {
    this.moveInput = { x: dx, y: dy };
  }

  setAimDirection(direction: Vec2): void {
    const normalized = normalizeVelocity(direction.x, direction.y);
    if (normalized.x === 0 && normalized.y === 0) return; // mouse exactly over the player — keep the previous aim
    this.aimDirection = normalized;
  }

  switchWeapon(weaponId: string): void {
    if (this.state !== 'idle' || weaponId === this.equippedWeaponId) return;
    this.equippedWeaponId = weaponId;
    this.attackLockedMs = SWITCH_RECOVERY_MS;
  }

  tryAction(actionId: string): void {
    const action = resolveAction(actionId); // throws for unknown ids, before any state mutation
    if (action.weaponId !== this.equippedWeaponId) return;
    if (this.canStartAttack()) {
      if (this.stamina.exhausted) {
        this.bus.emit('player.stamina_denied', { action: action.id });
        return;
      }
      this.startAction(action);
    } else if (this.isBufferable() && action.actionType !== 'charged') {
      // the charged attack (Q) is never buffered: it needs a held press
      this.inputBuffer.push({ kind: 'attack', actionId }, this.clockMs);
    }
  }

  releaseAction(): void {
    if (this.state !== 'acting' || !this.currentAction) return;
    if (this.currentAction.actionType !== 'charged' || this.chargeTriggered) return;

    if (this.chargeHeldMs >= this.currentAction.charge!.minHoldMs) {
      this.triggerCharge(this.currentAction);
    } else {
      this.cancelAction();
    }
  }

  private triggerCharge(action: ActionDef): void {
    this.chargeTriggered = true;
    this.phaseElapsedMs = 0;
    this.stamina.spend(STAMINA_COST.charged, 'attack'); // the charged cost is paid on release
    this.emitActionEvent(action);
  }

  private emitActionEvent(action: ActionDef): void {
    this.bus.emit('player.action', {
      actionId: action.id,
      actionType: action.actionType,
      weaponId: action.weaponId,
    });
  }

  tryDodge(): void {
    if (this.stamina.value < STAMINA_COST.dodge) {
      // short on stamina: denied at press, never buffered (whatever the current state)
      this.bus.emit('player.stamina_denied', { action: 'dodge' });
      return;
    }
    if (this.canDash()) {
      this.startDash();
    } else if (this.isBufferable() || this.dodgeCooldownRemainingMs > 0) {
      // a dash blocked by the cooldown is buffered even from blocking/charging; the cooldown clears on its own
      this.inputBuffer.push({ kind: 'dash' }, this.clockMs);
    }
  }

  private canStartAttack(): boolean {
    return this.isInRecovery || (this.state === 'idle' && this.attackLockedMs <= 0);
  }

  private canDash(): boolean {
    return this.canDashState() && this.stamina.value >= STAMINA_COST.dodge;
  }

  private canDashState(): boolean {
    if (this.dodgeCooldownRemainingMs > 0) return false;
    return this.isCharging || this.isInRecovery || this.state === 'blocking' || this.state === 'idle';
  }

  /** Inputs that cannot run now but will become runnable on their own (locked, stagger, dash, cooldowns). */
  private isBufferable(): boolean {
    return this.state !== 'blocking' && !this.isCharging;
  }

  private startAction(action: ActionDef): void {
    this.inputBuffer.clear();
    if (this.isInRecovery) {
      this.bus.emit('player.cancel', { by: 'attack', actionId: this.currentAction!.id });
    }
    this.state = 'acting';
    this.phaseElapsedMs = 0;
    this.currentAction = action;
    this.launched = false;
    this.pendingLaunch = null;
    this.committedDirection = { x: this.aimDirection.x, y: this.aimDirection.y };
    this.chargeHeldMs = 0;
    this.chargeTriggered = action.actionType !== 'charged';
    if (action.actionType !== 'charged') {
      this.stamina.spend(STAMINA_COST[action.actionType], 'attack');
      this.emitActionEvent(action);
    }
  }

  private startDash(): void {
    this.inputBuffer.clear();
    if (this.isInRecovery) {
      this.bus.emit('player.cancel', { by: 'dash', actionId: this.currentAction!.id });
    }
    if (this.state === 'acting') this.cancelAction(); // recovery, or a charge in progress (silent)
    this.blockHeldMs = 0;
    const direction = normalizeVelocity(this.moveInput.x, this.moveInput.y);
    this.dashDirection = direction.x !== 0 || direction.y !== 0 ? direction : this.aimDirection;
    this.state = 'dodging';
    this.phaseElapsedMs = 0;
    this.invulnerable = true;
    this.attackLockedMs = 0;
    this.stamina.spend(STAMINA_COST.dodge, 'dodge');
    this.bus.emit('player.dodge', { cost: STAMINA_COST.dodge });
  }

  startBlock(): void {
    if (this.state !== 'idle') return;
    if (this.stamina.exhausted) {
      this.bus.emit('player.stamina_denied', { action: 'block' });
      return;
    }
    this.state = 'blocking';
    this.blockHeldMs = 0;
  }

  stopBlock(): void {
    if (this.state !== 'blocking') return;
    this.state = 'idle';
    this.blockHeldMs = 0;
  }

  absorbBlockHit(): void {
    const canAbsorb = this.stamina.value >= STAMINA_COST.blockHit;
    this.stamina.spend(STAMINA_COST.blockHit, 'block');
    if (!canAbsorb) {
      // not enough stamina to absorb the hit: guard break
      this.bus.emit('player.guard_break', {});
      this.enterStagger();
    }
  }

  enterStagger(): void {
    this.state = 'staggered';
    this.staggerRemainingMs = STAGGER_MS;
    this.blockHeldMs = 0;
  }

  step(stepMs: number): void {
    this.clockMs += stepMs;
    if (this.isInRecovery && (this.moveInput.x !== 0 || this.moveInput.y !== 0)) {
      this.bus.emit('player.cancel', { by: 'move', actionId: this.currentAction!.id });
      this.cancelAction();
    }
    // Move-cancel is evaluated before advance(); the buffer is taken after it, so an input
    // buffered earlier fires on the tick the state becomes executable.
    this.advance(stepMs);
    const input = this.inputBuffer.take((i) => this.canExecute(i), this.clockMs);
    if (input?.kind === 'attack') this.startAction(resolveAction(input.actionId));
    else if (input?.kind === 'dash') this.startDash();
  }

  private canExecute(input: BufferedInput): boolean {
    if (input.kind === 'dash') return this.canDash();
    return (
      resolveAction(input.actionId).weaponId === this.equippedWeaponId &&
      this.canStartAttack() &&
      !this.stamina.exhausted // buffered without stamina: waits out the buffer window, silently dropped
    );
  }

  private advance(stepMs: number): void {
    this.stamina.step(stepMs, this.state === 'idle' && !this.isSprinting);
    if (this.dodgeCooldownRemainingMs > 0) {
      this.dodgeCooldownRemainingMs = Math.max(0, this.dodgeCooldownRemainingMs - stepMs);
    }
    if (this.attackLockedMs > 0) {
      this.attackLockedMs = Math.max(0, this.attackLockedMs - stepMs);
    }

    if (this.state === 'idle') {
      const direction = normalizeVelocity(this.moveInput.x, this.moveInput.y);
      if (direction.x !== 0 || direction.y !== 0) {
        const sprinting = this.isSprinting;
        this._position = clampToArena(
          applyMovement(this._position, direction, sprinting ? PLAYER_RUN_SPEED : PLAYER_WALK_SPEED, stepMs),
          this.width,
          this.height,
          ARENA_BOUNDS,
        );
        if (sprinting) this.stamina.spend((STAMINA_COST.sprintPerSecond * stepMs) / 1000, 'sprint');
      }
      return;
    }

    if (this.state === 'acting') {
      this.stepActing(stepMs);
      return;
    }

    if (this.state === 'blocking') {
      this.blockHeldMs += stepMs;
      const direction = normalizeVelocity(this.moveInput.x, this.moveInput.y);
      if (direction.x !== 0 || direction.y !== 0) {
        this._position = clampToArena(
          applyMovement(this._position, direction, PLAYER_WALK_SPEED * BLOCK_MOVE_SPEED_FACTOR, stepMs),
          this.width,
          this.height,
          ARENA_BOUNDS,
        );
      }
      return;
    }

    if (this.state === 'staggered') {
      this.staggerRemainingMs -= stepMs;
      if (this.staggerRemainingMs <= 0) {
        this.state = 'idle';
        this.staggerRemainingMs = 0;
      }
      return;
    }

    // dodging
    this.phaseElapsedMs += stepMs;
    const dashSpeed = DASH_DISTANCE / (DODGE.durationMs / 1000);
    this._position = clampToArena(
      applyMovement(this._position, this.dashDirection, dashSpeed, stepMs),
      this.width,
      this.height,
      ARENA_BOUNDS,
    );

    if (this.phaseElapsedMs >= DODGE.iframesMs) {
      this.invulnerable = false;
    }
    if (this.phaseElapsedMs >= DODGE.durationMs) {
      this.state = 'idle';
      this.phaseElapsedMs = 0;
      this.dodgeCooldownRemainingMs = DODGE.cooldownMs;
    }
  }

  private stepActing(stepMs: number): void {
    const action = this.currentAction!;

    if (action.actionType === 'charged' && !this.chargeTriggered) {
      const charge = action.charge!;
      this.chargeHeldMs = Math.min(this.chargeHeldMs + stepMs, charge.maxHoldMs);
      if (this.chargeHeldMs >= charge.maxHoldMs) {
        this.triggerCharge(action);
      }
      return;
    }

    this.phaseElapsedMs += stepMs;
    if (action.actionType === 'throw' && !this.launched && this.phaseElapsedMs >= action.timing.startupMs) {
      this.launched = true;
      const dir = { x: this.committedDirection.x, y: this.committedDirection.y };
      this.pendingLaunch = {
        origin: {
          x: this._position.x + this.width / 2 + dir.x * (this.width / 2),
          y: this._position.y + this.height / 2 + dir.y * (this.width / 2),
        },
        dir,
        actionId: action.id,
      };
    }
    if (this.phaseElapsedMs >= totalCommitmentMs(action)) {
      this.cancelAction();
    }
  }

  private cancelAction(): void {
    this.state = 'idle';
    this.phaseElapsedMs = 0;
    this.currentAction = null;
    this.chargeHeldMs = 0;
    this.chargeTriggered = false;
  }

  private chargedReach(): number {
    const action = this.currentAction!;
    const charge = action.charge!;
    const ratio = (this.chargeHeldMs - charge.minHoldMs) / (charge.maxHoldMs - charge.minHoldMs);
    const clamped = Math.max(0, Math.min(1, ratio));
    return action.reach + (charge.reachMax - action.reach) * clamped;
  }
}
