// src/combat/assaltanteController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { OpportunitySystem } from '../opportunity/opportunitySystem';
import type { AABB, EnemyState, Vec2 } from './types';
import { ASSALTANTE_RULES, type Blackboard } from '../ai/rules/assaltanteRules';
import { ASSALTANTE_CHASE_SPEED, ARENA_BOUNDS } from './movementDefs';
import { normalizeVelocity, applyMovement, clampToArena } from './movement';

const TELEGRAPH_MS = 400; // = dodge window
const SWING_MS = 150;
const RECOVERY_MS = 500; // = punish window
const ATTACK_REACH = 20;

export class AssaltanteController {
  state: EnemyState = 'idle';
  private phaseElapsedMs = 0;
  private activeOppId: string | null = null;
  private _position: Vec2;
  private readonly width: number;
  private readonly height: number;
  private attackDirection: Vec2 = { x: -1, y: 0 };

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

  hurtbox(): AABB {
    return { x: this._position.x, y: this._position.y, width: this.width, height: this.height };
  }

  attackHitbox(): AABB | null {
    if (this.state !== 'attacking') return null;
    if (this.phaseElapsedMs < TELEGRAPH_MS) return null;
    if (Math.abs(this.attackDirection.x) >= Math.abs(this.attackDirection.y)) {
      const x =
        this.attackDirection.x < 0
          ? this._position.x - ATTACK_REACH
          : this._position.x + this.width;
      return { x, y: this._position.y, width: ATTACK_REACH, height: this.height };
    }
    const y =
      this.attackDirection.y < 0
        ? this._position.y - ATTACK_REACH
        : this._position.y + this.height;
    return { x: this._position.x, y, width: this.width, height: ATTACK_REACH };
  }

  step(stepMs: number, playerPosition: Vec2): void {
    const dx = playerPosition.x - this._position.x;
    const dy = playerPosition.y - this._position.y;
    const distanceToPlayer = Math.hypot(dx, dy);

    if (this.state === 'idle' || this.state === 'chasing') {
      const bb: Blackboard = { distanceToPlayer, state: this.state };
      const rule = ASSALTANTE_RULES.find((r) => r.precond(bb));
      if (rule?.id === 'assaltante.attack') {
        this.state = 'attacking';
        this.phaseElapsedMs = 0;
        this.attackDirection = distanceToPlayer > 0 ? normalizeVelocity(dx, dy) : this.attackDirection;
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
        this.activeOppId = this.opp.open('punish', 'assaltante.recover', RECOVERY_MS);
      }
      return;
    }

    if (this.state === 'recovering') {
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

  onPlayerHitLanded(): void {
    if (this.state === 'recovering' && this.activeOppId) {
      this.opp.resolve(this.activeOppId, 'taken');
      this.activeOppId = null;
    }
  }
}
