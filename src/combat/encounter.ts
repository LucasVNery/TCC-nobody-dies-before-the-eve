// src/combat/encounter.ts
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { OpportunitySystem } from '../opportunity/opportunitySystem';
import { PlayerController } from './playerController';
import { AssaltanteController } from './assaltanteController';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import type { ProfileSink } from '../profile/profileSink';
import { sectorOverlapsBox } from './sector';
import { PERFECT_DODGE_MS } from './actionDefs';
import { STAMINA_COST } from './stamina';
import { ATTACK_REACH, ASSALTANTE_HIT_DAMAGE, PLAYER_DAMAGE_BY_ACTION_TYPE, PLAYER_MAX_HP } from './movementDefs';
import type { AABB, Vec2 } from './types';
import type { InvalidReason } from '../opportunity/types';
import { resolveAction, lockedMs } from './actionRegistry';
import { isPatientAttack } from './patience';
import { ProjectileSystem } from './projectile';
import { ItemSystem, ITEM } from '../game/items';

export class Encounter<P extends ProfileSink = ProfileAccumulator> {
  readonly bus: EventBus<GameEvents>;
  readonly opportunities: OpportunitySystem;
  readonly player: PlayerController;
  readonly assaltante: AssaltanteController;
  readonly projectiles = new ProjectileSystem();
  readonly items: ItemSystem;
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
  // Whether the first landing tick of the current attack was already processed
  // (reset with defenseRecordedThisAttack when a 'dodge' opp opens).
  private firstLandingProcessed = false;
  // The dodge opp of the CURRENT attack: a close of an older dodge opp must not touch the flag or record a retreat.
  private currentDodgeOppId: string | null = null;
  // At most one damage application per player action: the attack sector
  // overlaps the hurtbox on every tick of the active phase, so without this
  // one light attack would deal its damage ~6 times. Reset on every
  // player.action (for charged actions that event fires on release, before
  // the active phase starts).
  private hitAppliedThisAction = false;

  constructor(playerHurtbox: AABB, assaltanteHurtbox: AABB, profile?: P) {
    this.bus = new EventBus<GameEvents>();
    this.opportunities = new OpportunitySystem(this.bus);
    this.items = new ItemSystem(this.bus);
    this.player = new PlayerController(this.bus, playerHurtbox);
    this.assaltante = new AssaltanteController(this.bus, this.opportunities, assaltanteHurtbox);
    this.profile = profile ?? (new ProfileAccumulator() as unknown as P);

    this.bus.on('player.action', (e) => {
      this.hitAppliedThisAction = false;
      this.profile.recordAction(e.actionType, e.weaponId);
      if (this.assaltante.isCommitted) {
        this.assaltante.onPlayerWrongAction(e.actionId);
      }

      const exposureMs = lockedMs(resolveAction(e.actionId));
      const isPatient = isPatientAttack(exposureMs, [this.assaltante], this.player.hurtbox());
      // Dim 6's denominator is meant to be "total attacks initiated." Every
      // ActionType in today's registry is an attack, so this is safe as-is;
      // if a non-attack action type (e.g. a future 'utility' heal/guard-stance)
      // is ever added, this handler needs a guard on e.actionType to avoid
      // polluting the denominator with non-attack actions.
      this.profile.record('patience', isPatient ? 1 : 0, 1);
    });

    this.bus.on('opp.open', (e) => {
      if (e.type === 'dodge') {
        this.currentDodgeOppId = e.opp_id;
        this.defenseRecordedThisAttack = false;
        this.firstLandingProcessed = false;
      }
    });

    this.bus.on('opp.close', (e) => {
      if (e.type === 'punish' && e.outcome !== 'invalid') {
        this.profile.recordOutcome('punish', e.outcome);
      }
      if (
        e.type === 'dodge' &&
        e.outcome === 'expired' &&
        e.opp_id === this.currentDodgeOppId &&
        !this.defenseRecordedThisAttack
      ) {
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
    this.projectiles.clear();
    this.defenseRecordedThisAttack = false;
    this.firstLandingProcessed = false;
  }

  /** Start-of-run player. */
  resetPlayer(position: Vec2): void {
    this.player.reset(position);
    this.projectiles.clear();
    this.hitAppliedThisAction = false;
  }

  /**
   * Uses the held item. Ignored (no event) with an empty slot or when the
   * player could not start an attack right now (same gate). Records a
   * weaponless 'utility' action; weapon repertoire and patience are untouched.
   */
  useItem(): void {
    if (!this.items.held || !this.player.canAct) return;
    const enemyPos = this.assaltante.position;
    const result = this.items.use({ playerHp: this.player.hp, enemyPos, playerPos: this.player.position });
    if (!result) return;
    this.profile.recordAction('utility');
    this.player.lockAttack(ITEM.useLockMs);
    if (result.kind === 'heal') {
      this.player.hp = Math.min(PLAYER_MAX_HP, this.player.hp + (result.heal ?? 0));
    } else if (result.kind === 'bomb' && result.bombHit) {
      this.assaltante.takeDamage(ITEM.bombDamage);
      this.assaltante.stagger(ITEM.bombStaggerMs);
      this.bus.emit('enemy.hurt', { dmg: ITEM.bombDamage, hp_after: this.assaltante.hp, actionId: 'item.bomb' });
    }
  }

  step(stepMs: number): void {
    this.assaltante.step(stepMs, this.player.position);
    this.player.step(stepMs);
    const launch = this.player.takeLaunch();
    if (launch) this.projectiles.spawn(launch);

    // Parry, block, the unmitigated hit and the dodge credit are all gated by
    // defenseRecordedThisAttack: the hitbox keeps overlapping every tick for
    // the rest of the ~150ms swing, so without it a parry could refire after a
    // block already resolved the window, absorbBlockHit()/enterStagger() would
    // refire every tick and the dodge would be credited (and refunded) again.
    // The dodge is credited at the STRIKE, not at the button press. On the
    // first landing tick of an attack, being invulnerable is enough (a dash may
    // carry the player out of the sector and still counts). On later landing
    // ticks it only counts if the sector overlaps the player, so a dash pressed
    // after the strike cannot rescue a player who was never in it.
    // Otherwise the parry/block/hit logic runs on overlap.
    const enemyAttack = this.assaltante.attackHitbox();
    const landing = this.assaltante.strikeLanding();
    const firstLandingTick = landing && !this.firstLandingProcessed;
    if (landing) this.firstLandingProcessed = true;
    const overlaps = enemyAttack !== null && sectorOverlapsBox(enemyAttack, this.player.hurtbox());
    if (
      landing &&
      !this.defenseRecordedThisAttack &&
      this.player.isInvulnerable &&
      (firstLandingTick || overlaps)
    ) {
      const age = this.player.dashAgeMs;
      const perfect = age !== null && age <= PERFECT_DODGE_MS;
      this.assaltante.onPlayerDodgeSuccess();
      this.defenseRecordedThisAttack = true;
      this.profile.recordDefense('dodge');
      if (perfect) {
        // Logged before the refund so the context stamina is the pre-refund value.
        this.bus.emit('player.defense', { label: 'dodge', perfect: true, refund: STAMINA_COST.dodge });
        this.player.refundDodge();
      } else {
        this.bus.emit('player.defense', { label: 'dodge' });
      }
    } else if (overlaps) {
      if (!this.defenseRecordedThisAttack && this.player.isParryTiming) {
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
        const dmg = PLAYER_DAMAGE_BY_ACTION_TYPE[action.actionType] * this.items.damageMultiplier;
        this.assaltante.takeDamage(dmg);
        this.bus.emit('enemy.hurt', { dmg, hp_after: this.assaltante.hp, actionId: action.id });
      }
    }

    // Projectiles: swept against the enemy's hurtbox after its own step. A hit
    // lands once (the projectile is removed by the system), and the enemy dying
    // on it leaves nothing in flight.
    if (this.assaltante.isDead) {
      this.projectiles.clear();
    } else {
      const { hits, expired } = this.projectiles.step(stepMs, this.assaltante.hurtbox());
      for (const id of expired) this.bus.emit('projectile.expire', { id });
      for (const id of hits) {
        if (this.assaltante.isDead) break;
        const dmg = PLAYER_DAMAGE_BY_ACTION_TYPE.throw * this.items.damageMultiplier;
        this.assaltante.onPlayerHitLanded();
        this.assaltante.takeDamage(dmg);
        this.bus.emit('projectile.hit', { id, dmg });
        this.bus.emit('enemy.hurt', { dmg, hp_after: this.assaltante.hp, actionId: 'bow.shot' });
      }
      if (this.assaltante.isDead) this.projectiles.clear();
    }

    this.items.step(stepMs, this.player.hurtbox(), this.assaltante.position);

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
