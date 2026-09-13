// src/combat/encounter.ts
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from '../opportunity/opportunitySystem';
import { PlayerController } from './playerController';
import { AssaltanteController } from './assaltanteController';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import { sectorOverlapsBox } from './sector';
import { ATTACK_REACH } from './movementDefs';
import type { AABB } from './types';
import { resolveAction, totalCommitmentMs } from './actionRegistry';
import { isPatientAttack } from './patience';

export class Encounter {
  readonly bus: EventBus<GameEvents>;
  readonly opportunities: OpportunitySystem;
  readonly player: PlayerController;
  readonly assaltante: AssaltanteController;
  readonly profile: ProfileAccumulator;
  // Guards dim 4: at most one recordDefense() (or unmitigated-hit event) per
  // attack window. Reset whenever the Assaltante opens a new 'dodge'
  // opportunity (i.e. starts a new attack).
  private defenseRecordedThisAttack = false;

  constructor(playerHurtbox: AABB, assaltanteHurtbox: AABB) {
    this.bus = new EventBus<GameEvents>();
    this.opportunities = new OpportunitySystem(this.bus);
    this.player = new PlayerController(this.bus, playerHurtbox);
    this.assaltante = new AssaltanteController(this.bus, this.opportunities, assaltanteHurtbox);
    this.profile = new ProfileAccumulator();

    this.bus.on('player.action', (e) => {
      this.profile.recordAction(e.actionType, e.weaponId);
      if (this.assaltante.state === 'attacking') {
        this.assaltante.onPlayerWrongAction(e.actionId);
      }

      const commitmentMs = totalCommitmentMs(resolveAction(e.actionId));
      const isPatient = isPatientAttack(commitmentMs, [this.assaltante], this.player.hurtbox());
      // Dim 6's denominator is meant to be "total attacks initiated." Every
      // ActionType in today's registry is an attack, so this is safe as-is;
      // if a non-attack action type (e.g. a future 'utility' heal/guard-stance)
      // is ever added, this handler needs a guard on e.actionType to avoid
      // polluting the denominator with non-attack actions.
      this.profile.record('patience', isPatient ? 1 : 0, 1);
    });

    this.bus.on('player.dodge', () => {
      if (this.assaltante.state === 'attacking' && !this.defenseRecordedThisAttack) {
        this.defenseRecordedThisAttack = true;
        this.profile.recordDefense('dodge');
      }
    });

    this.bus.on('opp.open', (e) => {
      if (e.type === 'dodge') this.defenseRecordedThisAttack = false;
    });

    this.bus.on('opp.close', (e) => {
      if (e.type === 'punish' && e.outcome !== 'invalid') {
        this.profile.recordOutcome('punish', e.outcome);
      }
      if (e.type === 'dodge' && e.outcome === 'expired' && !this.defenseRecordedThisAttack) {
        this.defenseRecordedThisAttack = true;
        this.profile.recordDefense('retreat');
      }
    });
  }

  setPlayerMoveInput(dx: number, dy: number): void {
    this.player.setMoveInput(dx, dy);
  }

  step(stepMs: number): void {
    this.assaltante.step(stepMs, this.player.position);
    this.player.step(stepMs);

    // Dodge is self-terminating (i-frame timing means onPlayerDodgeSuccess()
    // simply becomes a no-op once already resolved) — safe to leave ungated.
    // Parry, block, and the unmitigated-hit case are NOT self-terminating on
    // their own: the hitbox keeps overlapping every tick for the rest of the
    // ~150ms swing, so all three are explicitly gated by
    // defenseRecordedThisAttack — otherwise a parry could refire after a
    // block already resolved the window (re-pressing E mid-swing), and
    // absorbBlockHit()/enterStagger() would refire every tick (poise would
    // vanish in ~3 ticks; stagger would never end while overlap holds).
    const enemyAttack = this.assaltante.attackHitbox();
    if (enemyAttack && sectorOverlapsBox(enemyAttack, this.player.hurtbox())) {
      if (this.player.isInvulnerable) {
        this.assaltante.onPlayerDodgeSuccess();
      } else if (!this.defenseRecordedThisAttack && this.player.isParryTiming) {
        this.assaltante.onPlayerParrySuccess();
        this.recordDefenseOnce('parry');
      } else if (!this.defenseRecordedThisAttack && this.player.isBlocking) {
        this.player.absorbBlockHit();
        this.recordDefenseOnce('block');
      } else if (!this.defenseRecordedThisAttack) {
        this.player.enterStagger();
        this.bus.emit('player.hit_unmitigated', {});
        this.defenseRecordedThisAttack = true; // no dim-4 label, but the window is "resolved"
      }
    }

    const playerAttack = this.player.attackHitbox();
    if (playerAttack && sectorOverlapsBox(playerAttack, this.assaltante.hurtbox())) {
      this.assaltante.onPlayerHitLanded();
    }

    // Must run last: if a hit/dodge was resolved above this tick, the opportunity
    // needs to be removed before its own expiry check fires here — otherwise a
    // same-call race would close it as 'expired' one tick early.
    this.opportunities.step(stepMs);

    const dx = this.assaltante.position.x - this.player.position.x;
    const dy = this.assaltante.position.y - this.player.position.y;
    const distance = Math.hypot(dx, dy);
    const stepSeconds = stepMs / 1000;
    this.profile.record('distance', distance <= ATTACK_REACH ? stepSeconds : 0, stepSeconds);
  }

  private recordDefenseOnce(label: 'block' | 'parry'): void {
    if (this.defenseRecordedThisAttack) return;
    this.defenseRecordedThisAttack = true;
    this.profile.recordDefense(label);
  }
}
