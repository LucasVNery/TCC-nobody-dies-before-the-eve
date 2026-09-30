// src/combat/encounter.ts
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from '../opportunity/opportunitySystem';
import { PlayerController } from './playerController';
import { AssaltanteController } from './assaltanteController';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import type { ProfileSink } from '../profile/profileSink';
import { sectorOverlapsBox } from './sector';
import { ATTACK_REACH, ASSALTANTE_HIT_DAMAGE, PLAYER_DAMAGE_BY_ACTION_TYPE } from './movementDefs';
import type { AABB, Vec2 } from './types';
import type { InvalidReason } from '../opportunity/types';
import { resolveAction, totalCommitmentMs } from './actionRegistry';
import { isPatientAttack } from './patience';

export class Encounter<P extends ProfileSink = ProfileAccumulator> {
  readonly bus: EventBus<GameEvents>;
  readonly opportunities: OpportunitySystem;
  readonly player: PlayerController;
  readonly assaltante: AssaltanteController;
  /**
   * Write side of the profile. Defaults to a fresh `ProfileAccumulator` so
   * existing call sites (and tests that read `encounter.profile.domain(...)`)
   * keep working; `RunDirector`/telemetry inject a `RecordingProfile` so the
   * profile outlives encounters and runs.
   */
  readonly profile: P;
  // Guards dim 4: at most one recordDefense() (or unmitigated-hit event) per
  // attack window. Reset whenever the Assaltante opens a new 'dodge'
  // opportunity (i.e. starts a new attack).
  private defenseRecordedThisAttack = false;
  // At most one damage application per player action: the attack sector
  // overlaps the hurtbox on every tick of the active phase, so without this
  // one light attack would deal its damage ~6 times. Reset on every
  // player.action (for charged actions that event fires on release, before
  // the active phase starts).
  private hitAppliedThisAction = false;

  constructor(playerHurtbox: AABB, assaltanteHurtbox: AABB, profile?: P) {
    this.bus = new EventBus<GameEvents>();
    this.opportunities = new OpportunitySystem(this.bus);
    this.player = new PlayerController(this.bus, playerHurtbox);
    this.assaltante = new AssaltanteController(this.bus, this.opportunities, assaltanteHurtbox);
    this.profile = profile ?? (new ProfileAccumulator() as unknown as P);

    this.bus.on('player.action', (e) => {
      this.hitAppliedThisAction = false;
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
        this.bus.emit('player.defense', { label: 'dodge' });
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
        this.bus.emit('player.defense', { label: 'retreat' });
      }
    });
  }

  setPlayerMoveInput(dx: number, dy: number): void {
    this.player.setMoveInput(dx, dy);
  }

  /** Fresh Assaltante at `position`; see AssaltanteController.respawn for `reason`. */
  respawnEnemy(position: Vec2, reason: InvalidReason): void {
    this.assaltante.respawn(position, reason);
    this.defenseRecordedThisAttack = false;
  }

  /** Start-of-run player. */
  resetPlayer(position: Vec2): void {
    this.player.reset(position);
    this.hitAppliedThisAction = false;
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
        this.player.takeDamage(ASSALTANTE_HIT_DAMAGE);
        this.bus.emit('player.hurt', { dmg: ASSALTANTE_HIT_DAMAGE, hp_after: this.player.hp });
        this.defenseRecordedThisAttack = true; // no dim-4 label, but the window is "resolved"
      }
    }

    const playerAttack = this.player.attackHitbox();
    if (playerAttack && sectorOverlapsBox(playerAttack, this.assaltante.hurtbox())) {
      this.assaltante.onPlayerHitLanded();
      const action = this.player.currentActionDef;
      if (action && !this.hitAppliedThisAction) {
        this.hitAppliedThisAction = true;
        const dmg = PLAYER_DAMAGE_BY_ACTION_TYPE[action.actionType];
        this.assaltante.takeDamage(dmg);
        this.bus.emit('enemy.hurt', { dmg, hp_after: this.assaltante.hp, actionId: action.id });
      }
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
    this.bus.emit('player.defense', { label });
  }
}
