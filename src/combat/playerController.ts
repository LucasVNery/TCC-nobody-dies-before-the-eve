// src/combat/playerController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { AABB, PlayerState, Vec2 } from './types';
import { DODGE } from './actionDefs';
import { resolveAction, type ActionDef } from './actionRegistry';
import { PLAYER_MOVE_SPEED, DASH_DISTANCE, ARENA_BOUNDS } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena, directionalHitbox } from './movement';

export class PlayerController {
  state: PlayerState = 'idle';
  private phaseElapsedMs = 0;
  private currentAction: ActionDef | null = null;
  private chargeHeldMs = 0;
  private chargeTriggered = false;
  private dodgeCooldownRemainingMs = 0;
  private invulnerable = false;
  private _position: Vec2;
  private readonly width: number;
  private readonly height: number;
  private moveInput: Vec2 = { x: 0, y: 0 };
  private lastMoveDirection: Vec2 = { x: 1, y: 0 };
  private aimDirection: Vec2 = { x: 1, y: 0 };
  private dashDirection: Vec2 = { x: 1, y: 0 };

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

  hurtbox(): AABB {
    return { x: this._position.x, y: this._position.y, width: this.width, height: this.height };
  }

  attackHitbox(): AABB | null {
    if (this.state !== 'acting' || !this.currentAction) return null;

    if (this.currentAction.actionType === 'charged') {
      if (!this.chargeTriggered) return null;
      if (this.phaseElapsedMs >= this.currentAction.timing.activeMs) return null;
      return directionalHitbox(this._position, this.width, this.height, this.aimDirection, this.chargedReach());
    }

    const { startupMs, activeMs } = this.currentAction.timing;
    const inActive = this.phaseElapsedMs >= startupMs && this.phaseElapsedMs < startupMs + activeMs;
    if (!inActive) return null;
    return directionalHitbox(this._position, this.width, this.height, this.aimDirection, this.currentAction.reach);
  }

  setMoveInput(dx: number, dy: number): void {
    this.moveInput = { x: dx, y: dy };
  }

  setAimDirection(direction: Vec2): void {
    const normalized = normalizeVelocity(direction.x, direction.y);
    if (normalized.x === 0 && normalized.y === 0) return; // mouse exactly over the player — keep the previous aim
    this.aimDirection = normalized;
  }

  tryAction(actionId: string): void {
    if (this.state !== 'idle') return;
    const action = resolveAction(actionId); // throws for unknown ids, before any state mutation

    this.state = 'acting';
    this.phaseElapsedMs = 0;
    this.currentAction = action;
    this.chargeHeldMs = 0;
    this.chargeTriggered = action.actionType !== 'charged';
    if (action.actionType !== 'charged') {
      this.emitActionEvent(action);
    }
  }

  releaseAction(): void {
    if (this.state !== 'acting' || !this.currentAction) return;
    if (this.currentAction.actionType !== 'charged' || this.chargeTriggered) return;

    if (this.chargeHeldMs >= this.currentAction.charge!.minHoldMs) {
      this.chargeTriggered = true;
      this.phaseElapsedMs = 0;
      this.emitActionEvent(this.currentAction);
    } else {
      this.cancelAction();
    }
  }

  private emitActionEvent(action: ActionDef): void {
    this.bus.emit('player.action', {
      actionId: action.id,
      actionType: action.actionType,
      weaponId: action.weaponId,
    });
  }

  tryDodge(): void {
    if (this.state !== 'idle' || this.dodgeCooldownRemainingMs > 0) return;
    this.state = 'dodging';
    this.phaseElapsedMs = 0;
    this.invulnerable = true;
    this.dashDirection = this.lastMoveDirection;
    this.bus.emit('player.dodge', {});
  }

  step(stepMs: number): void {
    if (this.dodgeCooldownRemainingMs > 0) {
      this.dodgeCooldownRemainingMs = Math.max(0, this.dodgeCooldownRemainingMs - stepMs);
    }

    if (this.state === 'idle') {
      const direction = normalizeVelocity(this.moveInput.x, this.moveInput.y);
      if (direction.x !== 0 || direction.y !== 0) {
        this.lastMoveDirection = direction;
        this._position = clampToArena(
          applyMovement(this._position, direction, PLAYER_MOVE_SPEED, stepMs),
          this.width,
          this.height,
          ARENA_BOUNDS,
        );
      }
      return;
    }

    if (this.state === 'acting') {
      this.stepActing(stepMs);
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
        this.chargeTriggered = true;
        this.phaseElapsedMs = 0;
        this.emitActionEvent(action);
      }
      return;
    }

    this.phaseElapsedMs += stepMs;
    const totalMs =
      action.actionType === 'charged'
        ? action.timing.activeMs + action.timing.recoveryMs
        : action.timing.startupMs + action.timing.activeMs + action.timing.recoveryMs;

    if (this.phaseElapsedMs >= totalMs) {
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
