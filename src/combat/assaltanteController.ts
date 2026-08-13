// src/combat/assaltanteController.ts
import type { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import type { OpportunitySystem } from '../opportunity/opportunitySystem';
import type { AABB, EnemyState } from './types';
import { ASSALTANTE_RULES, type Blackboard } from '../ai/rules/assaltanteRules';

const TELEGRAPH_MS = 400; // = dodge window
const SWING_MS = 150;
const RECOVERY_MS = 500; // = punish window

export class AssaltanteController {
  state: EnemyState = 'idle';
  private phaseElapsedMs = 0;
  private activeOppId: string | null = null;

  constructor(
    private bus: EventBus<GameEvents>,
    private opp: OpportunitySystem,
    private hurtboxBase: AABB,
  ) {}

  hurtbox(): AABB {
    return this.hurtboxBase;
  }

  attackHitbox(): AABB | null {
    if (this.state !== 'attacking') return null;
    if (this.phaseElapsedMs < TELEGRAPH_MS) return null;
    return {
      x: this.hurtboxBase.x - 20,
      y: this.hurtboxBase.y,
      width: 20,
      height: this.hurtboxBase.height,
    };
  }

  step(stepMs: number, distanceToPlayer: number): void {
    if (this.state === 'idle' || this.state === 'chasing') {
      const bb: Blackboard = { distanceToPlayer, state: this.state };
      const rule = ASSALTANTE_RULES.find((r) => r.precond(bb));
      if (rule?.id === 'assaltante.attack') {
        this.state = 'attacking';
        this.phaseElapsedMs = 0;
        this.activeOppId = this.opp.open('dodge', 'assaltante.attack', TELEGRAPH_MS);
      } else {
        this.state = 'chasing';
      }
      return;
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
