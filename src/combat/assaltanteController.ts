// src/combat/assaltanteController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { OpportunitySystem } from '../opportunity/opportunitySystem';
import type { AABB, EnemyState, Vec2 } from './types';
import type { ActionId } from '../opportunity/types';
import { ASSALTANTE_RULES, ATTACK_RANGE, type Blackboard } from '../ai/rules/assaltanteRules';
import { ASSALTANTE_CHASE_SPEED, ARENA_BOUNDS, ATTACK_REACH, ATTACK_HALF_ANGLE_RAD } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena } from './movement';
import { directionalSector, type AttackSector } from './sector';
import { PARRY_BONUS_RECOVERY_MS } from './actionDefs';
import { predictThreatMs, type ChaseTelegraphConfig, type ChaseTelegraphSnapshot } from './threatPrediction';
import type { ThreatAssessor } from './patience';

const TELEGRAPH_MS = 400; // = dodge window
const SWING_MS = 150;
const RECOVERY_MS = 500; // = punish window

export class AssaltanteController implements ThreatAssessor {
  state: EnemyState = 'idle';
  private phaseElapsedMs = 0;
  private activeOppId: string | null = null;
  private _activeRuleId: string | null = null;
  private _position: Vec2;
  private readonly width: number;
  private readonly height: number;
  private _attackDirection: Vec2 = { x: -1, y: 0 };
  private playerWasInRangeDuringPunish = false;

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

  hurtbox(): AABB {
    return { x: this._position.x, y: this._position.y, width: this.width, height: this.height };
  }

  attackHitbox(): AttackSector | null {
    if (this.state !== 'attacking') return null;
    if (this.phaseElapsedMs < TELEGRAPH_MS) return null;
    const center = { x: this._position.x + this.width / 2, y: this._position.y + this.height / 2 };
    return directionalSector(center, this._attackDirection, ATTACK_REACH + this.width / 2, ATTACK_HALF_ANGLE_RAD);
  }

  msUntilThreatens(target: AABB, horizonMs: number): number | null {
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

    if (this.state === 'idle' || this.state === 'chasing') {
      const bb: Blackboard = { distanceToPlayer, state: this.state };
      const rule = ASSALTANTE_RULES.find((r) => r.precond(bb));
      this._activeRuleId = rule?.id ?? null;
      if (rule?.id === 'assaltante.attack') {
        this.state = 'attacking';
        this.phaseElapsedMs = 0;
        this._attackDirection = distanceToPlayer > 0 ? normalizeVelocity(dx, dy) : this._attackDirection;
        this.activeOppId = this.opp.open('dodge', 'assaltante.attack', TELEGRAPH_MS + SWING_MS);
      } else {
        this.state = 'chasing';
        const direction = distanceToPlayer > 0 ? normalizeVelocity(dx, dy) : { x: 0, y: 0 };
        this._position = clampToArena(
          applyMovement(this._position, direction, ASSALTANTE_CHASE_SPEED, stepMs),
          this.width,
          this.height,
          ARENA_BOUNDS,
        );
      }
    }

    this.phaseElapsedMs += stepMs;

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
      if (this.phaseElapsedMs >= RECOVERY_MS) {
        this.state = 'idle';
        this.phaseElapsedMs = 0;
        this.activeOppId = null;
      }
      return;
    }
  }

  onPlayerDodgeSuccess(): void {
    if (this.state === 'attacking' && this.activeOppId) {
      this.opp.resolve(this.activeOppId, 'taken');
      this.activeOppId = null;
    }
  }

  onPlayerParrySuccess(): void {
    if (this.state !== 'attacking' || !this.activeOppId) return;
    this.opp.resolve(this.activeOppId, 'taken');
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
    if (this.state === 'attacking' && this.activeOppId) {
      this.opp.resolve(this.activeOppId, 'missed', { attempt });
      this.activeOppId = null;
    }
  }
}
