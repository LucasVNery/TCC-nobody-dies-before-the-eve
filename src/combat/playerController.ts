// src/combat/playerController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { AABB, PlayerState, Vec2 } from './types';
import { LIGHT_ATTACK, DODGE, totalDurationMs } from './actionDefs';
import { PLAYER_MOVE_SPEED, DASH_DISTANCE, ARENA_BOUNDS, ATTACK_REACH } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena, directionalHitbox } from './movement';

export class PlayerController {
  state: PlayerState = 'idle';
  private phaseElapsedMs = 0;
  private dodgeCooldownRemainingMs = 0;
  private invulnerable = false;
  private _position: Vec2;
  private readonly width: number;
  private readonly height: number;
  private moveInput: Vec2 = { x: 0, y: 0 };
  private lastDirection: Vec2 = { x: 1, y: 0 };
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
    return { x: this.lastDirection.x, y: this.lastDirection.y };
  }

  hurtbox(): AABB {
    return { x: this._position.x, y: this._position.y, width: this.width, height: this.height };
  }

  attackHitbox(): AABB | null {
    if (this.state !== 'attacking') return null;
    const inActive =
      this.phaseElapsedMs >= LIGHT_ATTACK.startupMs &&
      this.phaseElapsedMs < LIGHT_ATTACK.startupMs + LIGHT_ATTACK.activeMs;
    if (!inActive) return null;
    return directionalHitbox(this._position, this.width, this.height, this.lastDirection, ATTACK_REACH);
  }

  setMoveInput(dx: number, dy: number): void {
    this.moveInput = { x: dx, y: dy };
  }

  tryLightAttack(): void {
    if (this.state !== 'idle') return;
    this.state = 'attacking';
    this.phaseElapsedMs = 0;
    this.bus.emit('player.action', { action: 'light_attack' });
  }

  tryDodge(): void {
    if (this.state !== 'idle' || this.dodgeCooldownRemainingMs > 0) return;
    this.state = 'dodging';
    this.phaseElapsedMs = 0;
    this.invulnerable = true;
    this.dashDirection = this.lastDirection;
    this.bus.emit('player.action', { action: 'dodge' });
  }

  step(stepMs: number): void {
    if (this.dodgeCooldownRemainingMs > 0) {
      this.dodgeCooldownRemainingMs = Math.max(0, this.dodgeCooldownRemainingMs - stepMs);
    }

    if (this.state === 'idle') {
      const direction = normalizeVelocity(this.moveInput.x, this.moveInput.y);
      if (direction.x !== 0 || direction.y !== 0) {
        this.lastDirection = direction;
        this._position = clampToArena(
          applyMovement(this._position, direction, PLAYER_MOVE_SPEED, stepMs),
          this.width,
          this.height,
          ARENA_BOUNDS,
        );
      }
      return;
    }

    this.phaseElapsedMs += stepMs;

    if (this.state === 'attacking') {
      if (this.phaseElapsedMs >= totalDurationMs(LIGHT_ATTACK)) {
        this.state = 'idle';
        this.phaseElapsedMs = 0;
      }
      return;
    }

    if (this.state === 'dodging') {
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
      return;
    }
  }
}
