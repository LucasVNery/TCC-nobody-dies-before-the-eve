import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { AABB, PlayerState } from './types';
import { LIGHT_ATTACK, DODGE, totalDurationMs } from './actionDefs';

export class PlayerController {
  state: PlayerState = 'idle';
  private phaseElapsedMs = 0;
  private dodgeCooldownRemainingMs = 0;
  private invulnerable = false;

  constructor(
    private bus: EventBus<GameEvents>,
    private hurtboxBase: AABB,
  ) {}

  get isInvulnerable(): boolean {
    return this.invulnerable;
  }

  hurtbox(): AABB {
    return this.hurtboxBase;
  }

  attackHitbox(): AABB | null {
    if (this.state !== 'attacking') return null;
    const inActive =
      this.phaseElapsedMs >= LIGHT_ATTACK.startupMs &&
      this.phaseElapsedMs < LIGHT_ATTACK.startupMs + LIGHT_ATTACK.activeMs;
    if (!inActive) return null;
    return {
      x: this.hurtboxBase.x + this.hurtboxBase.width,
      y: this.hurtboxBase.y,
      width: 20,
      height: this.hurtboxBase.height,
    };
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
    this.bus.emit('player.action', { action: 'dodge' });
  }

  step(stepMs: number): void {
    if (this.dodgeCooldownRemainingMs > 0) {
      this.dodgeCooldownRemainingMs = Math.max(0, this.dodgeCooldownRemainingMs - stepMs);
    }

    if (this.state === 'idle') return;

    this.phaseElapsedMs += stepMs;

    if (this.state === 'attacking') {
      if (this.phaseElapsedMs >= totalDurationMs(LIGHT_ATTACK)) {
        this.state = 'idle';
        this.phaseElapsedMs = 0;
      }
      return;
    }

    if (this.state === 'dodging') {
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
