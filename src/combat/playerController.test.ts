// src/combat/playerController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/events';
import { PlayerController } from './playerController';
import {
  DODGE,
  SWITCH_RECOVERY_MS,
  PARRY_WINDOW_MS,
  STAGGER_MS,
  INPUT_BUFFER_MS,
} from './actionDefs';
import { SWORD_SHIELD_ACTIONS, lockedMs, totalCommitmentMs } from './actionRegistry';
import { STAMINA_MAX, STAMINA_COST, STAMINA_REGEN } from './stamina';
import { PLAYER_WALK_SPEED, PLAYER_RUN_SPEED, ARENA_BOUNDS, PLAYER_MAX_HP, BLOCK_MOVE_SPEED_FACTOR } from './movementDefs';
import { sectorOverlapsBox } from './sector';

const LIGHT = SWORD_SHIELD_ACTIONS.find((a) => a.actionType === 'light')!;
const HEAVY = SWORD_SHIELD_ACTIONS.find((a) => a.actionType === 'heavy')!;
const CHARGED = SWORD_SHIELD_ACTIONS.find((a) => a.actionType === 'charged')!;

function makePlayer() {
  const bus = new EventBus<GameEvents>();
  const player = new PlayerController(bus, { x: 0, y: 0, width: 20, height: 20 });
  return { bus, player };
}

describe('PlayerController', () => {
  it('starts idle', () => {
    const { player } = makePlayer();
    expect(player.state).toBe('idle');
  });

  it('tryAction() resolves via the registry, transitions to acting, and emits player.action', () => {
    const { bus, player } = makePlayer();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryAction(LIGHT.id);
    expect(player.state).toBe('acting');
    expect(handler).toHaveBeenCalledWith({
      actionId: LIGHT.id,
      actionType: 'light',
      weaponId: LIGHT.weaponId,
    });
  });

  it('tryAction() with an unknown id throws and does not change state', () => {
    const { player } = makePlayer();
    expect(() => player.tryAction('nope')).toThrow();
    expect(player.state).toBe('idle');
  });

  it('ignores tryAction while not idle', () => {
    const { bus, player } = makePlayer();
    player.tryDodge();
    const handler = vi.fn();
    bus.on('player.action', handler);
    expect(() => player.tryAction(LIGHT.id)).not.toThrow();
    expect(player.state).toBe('dodging');
    expect(handler).not.toHaveBeenCalled();
  });

  it('light attack: hitbox is null during startup, present during active, and back to idle after full duration', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs - 10);
    expect(player.attackHitbox()).toBeNull();

    player.step(20);
    expect(player.attackHitbox()).not.toBeNull();

    player.step(LIGHT.timing.activeMs + LIGHT.timing.recoveryMs);
    expect(player.state).toBe('idle');
    expect(player.attackHitbox()).toBeNull();
  });

  it('heavy attack follows its own startup/active/recovery timing and reach', () => {
    const { player } = makePlayer();
    player.tryAction(HEAVY.id);
    player.step(HEAVY.timing.startupMs - 10);
    expect(player.attackHitbox()).toBeNull();

    player.step(20);
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.reach).toBeCloseTo(HEAVY.reach + 10); // +10 = metade da largura do hurtbox de teste (20)

    player.step(HEAVY.timing.activeMs + HEAVY.timing.recoveryMs);
    expect(player.state).toBe('idle');
  });

  it('charged: released before minHoldMs cancels back to idle without ever producing a hitbox', () => {
    const { bus, player } = makePlayer();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryAction(CHARGED.id);
    player.step(CHARGED.charge!.minHoldMs - 20);
    player.releaseAction();
    expect(player.state).toBe('idle');
    expect(player.attackHitbox()).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it('charged: held past maxHoldMs auto-triggers with reach clamped to the max', () => {
    const { player } = makePlayer();
    player.tryAction(CHARGED.id);
    player.step(CHARGED.charge!.maxHoldMs + 500); // way past max — must clamp, not overshoot
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.reach).toBeCloseTo(CHARGED.charge!.reachMax + 10);
  });

  it('charged: held past maxHoldMs auto-triggers and emits player.action exactly once, at trigger time', () => {
    const { bus, player } = makePlayer();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryAction(CHARGED.id);
    expect(handler).not.toHaveBeenCalled();
    player.step(CHARGED.charge!.maxHoldMs + 500);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      actionId: CHARGED.id,
      actionType: 'charged',
      weaponId: CHARGED.weaponId,
    });
  });

  it('charged: released between minHoldMs and maxHoldMs fires with a linearly interpolated reach', () => {
    const { player } = makePlayer();
    player.tryAction(CHARGED.id);
    const holdMs = (CHARGED.charge!.minHoldMs + CHARGED.charge!.maxHoldMs) / 2;
    player.step(holdMs);
    player.releaseAction();
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    const midpointReach = (CHARGED.reach + CHARGED.charge!.reachMax) / 2 + 10;
    expect(hitbox!.reach).toBeCloseTo(midpointReach);
  });

  it('charged: released between minHoldMs and maxHoldMs emits player.action exactly once, at release time', () => {
    const { bus, player } = makePlayer();
    const handler = vi.fn();
    bus.on('player.action', handler);
    player.tryAction(CHARGED.id);
    const holdMs = (CHARGED.charge!.minHoldMs + CHARGED.charge!.maxHoldMs) / 2;
    player.step(holdMs);
    expect(handler).not.toHaveBeenCalled();
    player.releaseAction();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      actionId: CHARGED.id,
      actionType: 'charged',
      weaponId: CHARGED.weaponId,
    });
  });

  it('tryDodge() grants invulnerability that ends after iframesMs', () => {
    const { player } = makePlayer();
    player.tryDodge();
    expect(player.isInvulnerable).toBe(true);
    player.step(DODGE.iframesMs + 10);
    expect(player.isInvulnerable).toBe(false);
  });

  it('dodge ends after durationMs and starts a cooldown that blocks re-dodging', () => {
    const { player } = makePlayer();
    player.tryDodge();
    player.step(DODGE.durationMs);
    expect(player.state).toBe('idle');
    player.tryDodge();
    expect(player.state).toBe('idle');
  });

  it('dodge is available again once the cooldown elapses', () => {
    const { player } = makePlayer();
    player.tryDodge();
    player.step(DODGE.durationMs);
    player.step(DODGE.cooldownMs);
    player.tryDodge();
    expect(player.state).toBe('dodging');
  });

  it('emits player.dodge, not player.action, on dodge', () => {
    const { bus, player } = makePlayer();
    const actionHandler = vi.fn();
    const dodgeHandler = vi.fn();
    bus.on('player.action', actionHandler);
    bus.on('player.dodge', dodgeHandler);
    player.tryDodge();
    expect(dodgeHandler).toHaveBeenCalledWith({ cost: 30 });
    expect(actionHandler).not.toHaveBeenCalled();
  });

  it('moves in the direction of moveInput', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 0);
    player.step(1000);
    expect(player.position.x).toBeCloseTo(PLAYER_WALK_SPEED);
    expect(player.position.y).toBeCloseTo(0);
  });

  it('normalizes diagonal movement so it is not faster than a cardinal direction', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 1);
    player.step(1000);
    const distance = Math.hypot(player.position.x, player.position.y);
    expect(distance).toBeCloseTo(PLAYER_WALK_SPEED);
  });

  it('does not move when moveInput is zero', () => {
    const { player } = makePlayer();
    player.step(1000);
    expect(player.position).toEqual({ x: 0, y: 0 });
  });

  it('movement is clamped to ARENA_BOUNDS', () => {
    const { player } = makePlayer();
    player.setMoveInput(-1, 0);
    player.step(100000);
    expect(player.position.x).toBe(ARENA_BOUNDS.x);
  });

  it('ignores moveInput during the locked phase', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.setMoveInput(1, 0);
    player.step(lockedMs(LIGHT) - 1);
    expect(player.position).toEqual({ x: 0, y: 0 });
  });

  it('dash defaults to facing right if the player never moved', () => {
    const { player } = makePlayer();
    player.tryDodge();
    player.step(DODGE.durationMs);
    expect(player.position.x).toBeGreaterThan(0);
  });

  it('facing defaults to aiming right before any setAimDirection call', () => {
    const { player } = makePlayer();
    expect(player.facing).toEqual({ x: 1, y: 0 });
  });

  it('setAimDirection normalizes the vector and updates facing', () => {
    const { player } = makePlayer();
    player.setAimDirection({ x: 0, y: 5 });
    expect(player.facing).toEqual({ x: 0, y: 1 });
  });

  it('setAimDirection with a zero vector leaves the previous aim unchanged', () => {
    const { player } = makePlayer();
    player.setAimDirection({ x: 0, y: 1 });
    player.setAimDirection({ x: 0, y: 0 });
    expect(player.facing).toEqual({ x: 0, y: 1 });
  });

  it('attackHitbox() follows aimDirection, independent of the last movement direction', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 0);
    player.step(16); // moving right
    player.setAimDirection({ x: 0, y: -1 }); // aiming up
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs + 10);
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.direction).toEqual({ x: 0, y: -1 }); // aiming up
  });

  it('attackHitbox() direction is committed at tryAction() time, not updated live during the swing', () => {
    const { player } = makePlayer();
    player.setAimDirection({ x: 0, y: -1 }); // aim up
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs + 10); // now in the active window
    player.setAimDirection({ x: 1, y: 0 }); // player spins the mouse to aim right, mid-swing
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    expect(hitbox!.direction).toEqual({ x: 0, y: -1 }); // still using the "aim up" direction committed at tryAction() time
  });

  it('takeDamage lowers hp, clamps at 0 and flips isDead', () => {
    const { player } = makePlayer();
    expect(player.hp).toBe(PLAYER_MAX_HP);
    player.takeDamage(30);
    expect(player.hp).toBe(PLAYER_MAX_HP - 30);
    expect(player.isDead).toBe(false);
    player.takeDamage(999);
    expect(player.hp).toBe(0);
    expect(player.isDead).toBe(true);
  });

  it('reset() restores hp/stamina/state/weapon and moves the player', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.takeDamage(50);
    player.startBlock();
    player.absorbBlockHit();
    player.reset({ x: 300, y: 200 });
    expect(player.hp).toBe(PLAYER_MAX_HP);
    expect(player.stamina.value).toBe(STAMINA_MAX);
    expect(player.state).toBe('idle');
    expect(player.equippedWeaponId).toBe('sword_shield');
    expect(player.position).toEqual({ x: 300, y: 200 });
    expect(player.isInvulnerable).toBe(false);
  });

  it('reset() mid-charge discards the charge: releasing afterwards emits no player.action', () => {
    const { bus, player } = makePlayer();
    const actions = vi.fn();
    bus.on('player.action', actions);
    player.tryAction(CHARGED.id);
    player.step(CHARGED.charge!.minHoldMs + 50);
    player.reset({ x: 0, y: 0 });
    player.releaseAction();
    player.step(16);
    expect(actions).not.toHaveBeenCalled();
    expect(player.currentActionDef).toBeNull();
  });

  it('currentActionDef exposes the action being performed', () => {
    const { player } = makePlayer();
    expect(player.currentActionDef).toBeNull();
    player.tryAction(LIGHT.id);
    expect(player.currentActionDef?.id).toBe(LIGHT.id);
  });
});

describe('PlayerController — weapon switching', () => {
  it('defaults to sword_shield equipped', () => {
    const { player } = makePlayer();
    expect(player.equippedWeaponId).toBe('sword_shield');
  });

  it('switchWeapon changes the equipped weapon and locks attacks for SWITCH_RECOVERY_MS', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    expect(player.equippedWeaponId).toBe('bow');
    expect(() => player.tryAction('bow.shot')).not.toThrow();
    expect(player.state).toBe('idle'); // rejected: still locked
  });

  it('the attack lock clears on its own after SWITCH_RECOVERY_MS', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.step(SWITCH_RECOVERY_MS);
    player.tryAction('bow.shot');
    expect(player.state).toBe('acting');
  });

  it('switching to the already-equipped weapon is a no-op and does not lock attacks', () => {
    const { player } = makePlayer();
    player.switchWeapon('sword_shield'); // already equipped
    player.tryAction('sword_shield.light');
    expect(player.state).toBe('acting');
  });

  it('tryDodge cancels the switch lock immediately', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.tryDodge();
    player.step(DODGE.durationMs); // return to idle
    player.tryAction('bow.shot');
    expect(player.state).toBe('acting');
  });

  it('switching again before the previous lock elapses resets the lock to a full SWITCH_RECOVERY_MS', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.step(SWITCH_RECOVERY_MS - 20); // 20ms left on the first lock
    player.switchWeapon('heavy_weapon'); // resets to a fresh SWITCH_RECOVERY_MS
    player.step(30); // would have cleared the *first* lock, not a fresh one
    expect(() => player.tryAction('heavy_weapon.light')).not.toThrow();
    expect(player.state).toBe('idle'); // still locked
  });

  it('tryAction rejects an action belonging to a non-equipped weapon, without throwing or changing state', () => {
    const { player } = makePlayer();
    expect(() => player.tryAction('bow.shot')).not.toThrow(); // sword_shield still equipped by default
    expect(player.state).toBe('idle');
  });
});

describe('PlayerController — defensive kit (blocking/parry/stagger/stamina)', () => {
  it('starts with full stamina', () => {
    const { player } = makePlayer();
    expect(player.stamina.value).toBe(STAMINA_MAX);
  });

  it('startBlock() transitions to blocking, only from idle', () => {
    const { player } = makePlayer();
    player.startBlock();
    expect(player.state).toBe('blocking');
    expect(player.isBlocking).toBe(true);
  });

  it('startBlock() is a no-op outside idle', () => {
    const { player } = makePlayer();
    player.tryDodge();
    expect(player.state).toBe('dodging');
    player.startBlock();
    expect(player.state).toBe('dodging'); // unchanged
  });

  it('stopBlock() returns to idle', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.stopBlock();
    expect(player.state).toBe('idle');
  });

  it('isParryTiming is true just after starting the block, false once past PARRY_WINDOW_MS', () => {
    const { player } = makePlayer();
    player.startBlock();
    expect(player.isParryTiming).toBe(true);
    player.step(PARRY_WINDOW_MS + 10);
    expect(player.isParryTiming).toBe(false);
    expect(player.isBlocking).toBe(true); // still blocking, just past the parry window
  });

  it('absorbBlockHit() spends blockHit stamina and does not stagger', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.absorbBlockHit();
    expect(player.stamina.value).toBe(STAMINA_MAX - STAMINA_COST.blockHit);
    expect(player.state).toBe('blocking');
  });

  it('absorbBlockHit() with less stamina than the cost empties it, emits player.guard_break and staggers', () => {
    const { bus, player } = makePlayer();
    const guardBreak = vi.fn();
    bus.on('player.guard_break', guardBreak);
    player.startBlock();
    player.stamina.spend(90, 'attack'); // 10 left
    player.absorbBlockHit();
    expect(player.stamina.value).toBe(0);
    expect(guardBreak).toHaveBeenCalledTimes(1);
    expect(player.state).toBe('staggered');
  });

  it('holding the guard and a parry cost no stamina', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.step(PARRY_WINDOW_MS + 500);
    expect(player.stamina.value).toBe(STAMINA_MAX);
  });

  it('startBlock() with zero stamina is denied and emits player.stamina_denied once', () => {
    const { bus, player } = makePlayer();
    const denied = vi.fn();
    bus.on('player.stamina_denied', denied);
    player.stamina.spend(200, 'attack');
    player.startBlock();
    expect(player.state).toBe('idle');
    expect(denied).toHaveBeenCalledTimes(1);
    expect(denied).toHaveBeenCalledWith({ action: 'block' });
  });

  it('enterStagger() blocks all input until STAGGER_MS elapses, then returns to idle', () => {
    const { player } = makePlayer();
    player.enterStagger();
    expect(player.state).toBe('staggered');
    player.tryDodge();
    expect(player.state).toBe('staggered'); // still locked out
    player.step(STAGGER_MS - 1);
    expect(player.state).toBe('staggered');
    player.step(2);
    expect(player.state).toBe('idle');
  });

  it('stamina regenerates after the wait while idle, even across a single large step()', () => {
    const { player } = makePlayer();
    player.stamina.spend(65, 'attack'); // 35 left, wait armed at 600 ms
    player.step(STAMINA_REGEN.delayMs + 1000); // 600 ms of wait + 1000 ms of regen
    expect(player.stamina.value).toBeCloseTo(35 + 35, 5);
  });

  it('stamina never regenerates above STAMINA_MAX', () => {
    const { player } = makePlayer();
    player.step(STAMINA_REGEN.delayMs + 5000);
    expect(player.stamina.value).toBe(STAMINA_MAX);
  });

  it('stamina does not regenerate while blocking', () => {
    const { player } = makePlayer();
    player.stamina.spend(50, 'attack');
    player.startBlock();
    player.step(5000);
    expect(player.stamina.value).toBe(50);
  });
});

describe('PlayerController — stamina costs', () => {
  it('a light attack spends 12, a heavy 22, at the start', () => {
    const a = makePlayer().player;
    a.tryAction(LIGHT.id);
    expect(a.stamina.value).toBe(STAMINA_MAX - 12);
    const b = makePlayer().player;
    b.tryAction(HEAVY.id);
    expect(b.stamina.value).toBe(STAMINA_MAX - 22);
  });

  it('a bow shot spends 8 at the start', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.step(SWITCH_RECOVERY_MS);
    player.tryAction('bow.shot');
    expect(player.stamina.value).toBe(STAMINA_MAX - 8);
  });

  it('a charged attack spends 28 on release, not while charging', () => {
    const { player } = makePlayer();
    player.tryAction(CHARGED.id);
    player.step(CHARGED.charge!.minHoldMs + 50);
    expect(player.stamina.value).toBe(STAMINA_MAX);
    player.releaseAction();
    expect(player.stamina.value).toBe(STAMINA_MAX - 28);
  });

  it('a charged release with only 10 stamina still fires and leaves 0', () => {
    const { bus, player } = makePlayer();
    const actions = vi.fn();
    bus.on('player.action', actions);
    player.stamina.spend(90, 'attack');
    player.tryAction(CHARGED.id);
    player.step(CHARGED.charge!.minHoldMs + 50);
    player.releaseAction();
    expect(actions).toHaveBeenCalledWith(expect.objectContaining({ actionId: CHARGED.id }));
    expect(player.stamina.value).toBe(0);
  });

  it('tryAction() with zero stamina does not start and emits player.stamina_denied once', () => {
    const { bus, player } = makePlayer();
    const denied = vi.fn();
    bus.on('player.stamina_denied', denied);
    player.stamina.spend(200, 'attack');
    player.tryAction(LIGHT.id);
    expect(player.state).toBe('idle');
    expect(denied).toHaveBeenCalledTimes(1);
    expect(denied).toHaveBeenCalledWith({ action: 'sword_shield.light' });
  });

  it('a buffered attack that becomes executable without stamina is dropped silently', () => {
    const { bus, player } = makePlayer();
    const denied = vi.fn();
    bus.on('player.stamina_denied', denied);
    player.switchWeapon('bow');
    player.switchWeapon('sword_shield'); // each switch arms the 150 ms attack lock
    player.tryAction(LIGHT.id); // locked -> buffered
    player.stamina.spend(200, 'attack');
    player.step(SWITCH_RECOVERY_MS + INPUT_BUFFER_MS + 50);
    expect(player.state).toBe('idle');
    expect(denied).not.toHaveBeenCalled();
  });

  it('tryDodge() with 29 stamina is denied, emits once and is not buffered', () => {
    const { bus, player } = makePlayer();
    const denied = vi.fn();
    const dodged = vi.fn();
    bus.on('player.stamina_denied', denied);
    bus.on('player.dodge', dodged);
    player.stamina.spend(71, 'attack'); // 29 left
    player.tryDodge();
    expect(player.state).toBe('idle');
    expect(denied).toHaveBeenCalledTimes(1);
    expect(denied).toHaveBeenCalledWith({ action: 'dodge' });
    player.stamina.refund(10); // 39 now: a buffered dodge would fire on the next step
    player.step(16);
    expect(dodged).not.toHaveBeenCalled();
    expect(player.state).toBe('idle');
  });

  it('tryDodge() with exactly 30 dodges, emits cost 30 and leaves 0 with the long wait', () => {
    const { bus, player } = makePlayer();
    const dodged = vi.fn();
    bus.on('player.dodge', dodged);
    player.stamina.spend(70, 'attack'); // 30 left
    player.tryDodge();
    expect(player.state).toBe('dodging');
    expect(dodged).toHaveBeenCalledWith({ cost: 30 });
    expect(player.stamina.value).toBe(0);
    player.step(DODGE.durationMs);
    player.step(STAMINA_REGEN.exhaustedDelayMs - DODGE.durationMs - 1);
    expect(player.stamina.value).toBe(0);
    player.step(STAMINA_REGEN.exhaustedDelayMs);
    expect(player.stamina.value).toBeGreaterThan(0);
  });

  it('dashAgeMs is null outside dodging and counts the dash age; refundDodge gives 30 back', () => {
    const { player } = makePlayer();
    expect(player.dashAgeMs).toBeNull();
    player.tryDodge();
    player.step(50);
    expect(player.dashAgeMs).toBe(50);
    expect(player.refundDodge()).toBe(30);
    expect(player.stamina.value).toBe(STAMINA_MAX);
    player.step(DODGE.durationMs);
    expect(player.dashAgeMs).toBeNull();
  });
});

describe('PlayerController — dodge denial while the dash is blocked', () => {
  function inCooldown() {
    const made = makePlayer();
    made.player.tryDodge();
    made.player.step(DODGE.durationMs); // dash ends, cooldown armed
    return made;
  }

  it('denies once and never buffers a dodge pressed in cooldown with 29 stamina', () => {
    const { bus, player } = inCooldown();
    const denied = vi.fn();
    const dodged = vi.fn();
    bus.on('player.stamina_denied', denied);
    bus.on('player.dodge', dodged);
    player.stamina.spend(player.stamina.value - 29, 'attack'); // leaves exactly 29
    expect(player.stamina.value).toBe(29);
    player.tryDodge();
    expect(denied).toHaveBeenCalledTimes(1);
    expect(denied).toHaveBeenCalledWith({ action: 'dodge' });
    player.stamina.refund(100); // back to full within the buffer window
    player.step(DODGE.cooldownMs + 10);
    expect(dodged).toHaveBeenCalledTimes(0);
    expect(player.state).toBe('idle');
  });

  it('still buffers a dodge pressed in cooldown with 30+ stamina and fires it when the cooldown ends', () => {
    const { bus, player } = inCooldown();
    const dodged = vi.fn();
    const denied = vi.fn();
    bus.on('player.dodge', dodged);
    bus.on('player.stamina_denied', denied);
    player.stamina.refund(100);
    player.step(DODGE.cooldownMs - 100);
    player.tryDodge(); // 100 ms of cooldown left, inside the 120 ms buffer window
    expect(denied).not.toHaveBeenCalled();
    player.step(110);
    expect(dodged).toHaveBeenCalledTimes(1);
    expect(player.state).toBe('dodging');
  });
});

describe('PlayerController — sprint', () => {
  it('walks at 175 u/s and sprints at 220 u/s spending 10 per second', () => {
    const a = makePlayer().player;
    a.setMoveInput(1, 0);
    a.step(1000);
    expect(a.position.x).toBeCloseTo(175);
    expect(a.isSprinting).toBe(false);

    const b = makePlayer().player;
    b.setSprint(true);
    b.setMoveInput(1, 0);
    expect(b.isSprinting).toBe(true);
    b.step(1000);
    expect(b.position.x).toBeCloseTo(PLAYER_RUN_SPEED);
    expect(b.stamina.value).toBeCloseTo(STAMINA_MAX - STAMINA_COST.sprintPerSecond, 5);
  });

  it('does not regenerate stamina while sprinting', () => {
    const { player } = makePlayer();
    player.stamina.spend(50, 'attack');
    player.setSprint(true);
    player.setMoveInput(1, 0);
    player.step(3000);
    expect(player.stamina.value).toBeLessThan(50);
  });

  it('sprint without movement is not sprinting and does not spend', () => {
    const { player } = makePlayer();
    player.setSprint(true);
    expect(player.isSprinting).toBe(false);
    player.step(1000);
    expect(player.stamina.value).toBe(STAMINA_MAX);
  });

  it('sprint with zero stamina walks at 175', () => {
    const { player } = makePlayer();
    player.stamina.spend(200, 'attack');
    player.setSprint(true);
    player.setMoveInput(1, 0);
    expect(player.isSprinting).toBe(false);
    player.step(1000);
    expect(player.position.x).toBeCloseTo(PLAYER_WALK_SPEED);
  });

  it('blocking moves at half the walk speed (87.5 u/s)', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.setMoveInput(1, 0);
    player.step(1000);
    expect(player.position.x).toBeCloseTo(87.5);
  });
});

describe('PlayerController — diagonal attacks', () => {
  it('a diagonal attack reaches a target positioned on that diagonal (regression: old 4-quadrant hitbox could miss this)', () => {
    const { player } = makePlayer();
    player.setAimDirection({ x: 1, y: 1 });
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs + 10);
    const hitbox = player.attackHitbox();
    expect(hitbox).not.toBeNull();
    const targetBox = { x: 30, y: 30, width: 20, height: 20 }; // on the same diagonal, within reach (LIGHT.reach=45 + 10)
    expect(sectorOverlapsBox(hitbox!, targetBox)).toBe(true);
  });
});

const LIGHT_LOCKED = lockedMs(LIGHT); // 200
const LIGHT_TOTAL = totalCommitmentMs(LIGHT); // 350

function collect(bus: EventBus<GameEvents>) {
  const log: Array<{ type: string; payload: unknown }> = [];
  bus.on('player.cancel', (p) => log.push({ type: 'player.cancel', payload: p }));
  bus.on('player.action', (p) => log.push({ type: 'player.action', payload: p }));
  bus.on('player.dodge', (p) => log.push({ type: 'player.dodge', payload: p }));
  return log;
}

describe('combat B: responsive combat', () => {
  it('is locked (no movement, no dash) during startup+active, recovery starts at lockedMs', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.setMoveInput(1, 0);
    player.step(LIGHT_LOCKED - 1);
    expect(player.isInRecovery).toBe(false);
    expect(player.position).toEqual({ x: 0, y: 0 });
    player.tryDodge(); // buffered, does not fire while locked
    expect(player.state).toBe('acting');
    player.step(1); // recovery starts: the buffered dash fires right away
    expect(player.state).toBe('dodging');

    const other = makePlayer().player;
    other.tryAction(LIGHT.id);
    other.step(LIGHT_LOCKED);
    expect(other.isInRecovery).toBe(true);
  });

  it('without input the recovery ends by itself at totalCommitmentMs with no player.cancel', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(LIGHT.id);
    player.step(LIGHT_TOTAL);
    expect(player.state).toBe('idle');
    expect(log.filter((e) => e.type === 'player.cancel')).toHaveLength(0);
  });

  it('movement input cancels the recovery and moves in the same tick, emitting player.cancel{move}', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(LIGHT.id);
    player.step(LIGHT_LOCKED); // enter recovery
    player.setMoveInput(1, 0);
    player.step(100);
    expect(player.state).toBe('idle');
    expect(player.position.x).toBeCloseTo((PLAYER_WALK_SPEED * 100) / 1000);
    expect(log.map((e) => e.type)).toEqual(['player.action', 'player.cancel']);
    expect(log[1].payload).toEqual({ by: 'move', actionId: LIGHT.id });
  });

  it('holding movement from before the attack does not move during the locked phase, only from recovery on', () => {
    const { player } = makePlayer();
    player.setMoveInput(1, 0);
    player.tryAction(LIGHT.id);
    player.step(LIGHT_LOCKED);
    expect(player.position).toEqual({ x: 0, y: 0 });
    player.step(16);
    expect(player.state).toBe('idle');
    expect(player.position.x).toBeGreaterThan(0);
  });

  it('dash cancels the recovery: player.cancel{dash} comes before player.dodge', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(LIGHT.id);
    player.step(LIGHT_LOCKED);
    player.tryDodge();
    expect(player.state).toBe('dodging');
    expect(log.map((e) => e.type)).toEqual(['player.action', 'player.cancel', 'player.dodge']);
    expect(log[1].payload).toEqual({ by: 'dash', actionId: LIGHT.id });
  });

  it('a new attack cancels the recovery: player.cancel{attack} (previous action id) comes before the new player.action', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(LIGHT.id);
    player.step(LIGHT_LOCKED);
    player.tryAction(HEAVY.id);
    expect(player.currentActionDef?.id).toBe(HEAVY.id);
    expect(log.map((e) => e.type)).toEqual(['player.action', 'player.cancel', 'player.action']);
    expect(log[1].payload).toEqual({ by: 'attack', actionId: LIGHT.id });
    expect((log[2].payload as { actionId: string }).actionId).toBe(HEAVY.id);
  });

  it('a dash pressed during the locked phase is buffered and fires when the recovery starts', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs); // 100ms in, still locked
    player.tryDodge(); // buffered
    expect(player.state).toBe('acting');
    player.step(LIGHT.timing.activeMs); // recovery begins; age = 100ms <= INPUT_BUFFER_MS
    expect(player.state).toBe('dodging');
    expect(log.map((e) => e.type)).toEqual(['player.action', 'player.cancel', 'player.dodge']);
  });

  it('an attack pressed during the locked phase is buffered and fires when the recovery starts', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.step(LIGHT.timing.startupMs);
    player.tryAction(HEAVY.id);
    player.step(LIGHT.timing.activeMs);
    expect(player.currentActionDef?.id).toBe(HEAVY.id);
  });

  it('a buffered input older than INPUT_BUFFER_MS is dropped', () => {
    expect(LIGHT_LOCKED).toBeGreaterThan(INPUT_BUFFER_MS);
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.tryDodge(); // pressed at t=0 of a 200ms lock
    player.step(LIGHT_LOCKED); // age 200 > 120
    expect(player.state).toBe('acting'); // in recovery, dash was dropped
    expect(player.isInRecovery).toBe(true);
  });

  it('dash is buffered during stagger and fires when it ends', () => {
    const { player } = makePlayer();
    player.enterStagger();
    player.step(STAGGER_MS - 50);
    player.tryDodge();
    expect(player.state).toBe('staggered');
    player.step(50);
    expect(player.state).toBe('dodging');
  });

  it('an attack of the newly equipped weapon pressed during the switch lock is buffered and fires when it ends', () => {
    const { player } = makePlayer();
    player.switchWeapon('bow');
    player.step(50);
    player.tryAction('bow.shot'); // buffered, 100ms of lock left
    expect(player.state).toBe('idle');
    player.step(SWITCH_RECOVERY_MS - 50);
    expect(player.currentActionDef?.id).toBe('bow.shot');
  });

  it('dash direction follows the movement input; with no input it follows the aim', () => {
    const a = makePlayer().player;
    a.setAimDirection({ x: -1, y: 0 });
    a.setMoveInput(0, 1);
    a.tryDodge();
    a.step(DODGE.durationMs);
    expect(a.position.y).toBeGreaterThan(0);
    expect(a.position.x).toBeCloseTo(0);

    const b = makePlayer().player;
    b.reset({ x: 300, y: 300 }); // away from the arena edge so the upward dash is not clamped
    b.setAimDirection({ x: 0, y: -1 });
    b.tryDodge();
    b.step(DODGE.durationMs);
    expect(b.position.y).toBeLessThan(300);
  });

  it('dash cancels a charge in progress without emitting player.action; releasing afterwards does nothing', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(CHARGED.id);
    player.step(400); // still charging
    player.tryDodge();
    expect(player.state).toBe('dodging');
    player.step(DODGE.durationMs);
    player.releaseAction();
    expect(log.map((e) => e.type)).toEqual(['player.dodge']);
  });

  it('dash exits blocking and works during the weapon-switch lock', () => {
    const a = makePlayer().player;
    a.startBlock();
    a.tryDodge();
    expect(a.state).toBe('dodging');

    const b = makePlayer().player;
    b.switchWeapon('bow');
    b.tryDodge();
    expect(b.state).toBe('dodging');
  });

  it('moves at half speed while blocking', () => {
    const { player } = makePlayer();
    player.startBlock();
    player.setMoveInput(1, 0);
    player.step(1000);
    expect(player.state).toBe('blocking');
    expect(player.position.x).toBeCloseTo(PLAYER_WALK_SPEED * BLOCK_MOVE_SPEED_FACTOR);
  });

  it('reset() clears a pending buffered input', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.tryDodge(); // buffered
    player.reset({ x: 0, y: 0 });
    player.step(500);
    expect(player.state).toBe('idle');
  });

  it('Q tapped during the locked phase is never buffered: no charged action fires afterwards', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryAction(LIGHT.id);
    player.step(100);
    player.tryAction(CHARGED.id);
    player.step(16);
    player.releaseAction();
    player.step(1000);
    expect(log.filter((e) => e.type === 'player.action')).toHaveLength(1);
    expect(player.currentActionDef).toBeNull();
  });

  it('the dash cooldown applies when blocking: dash is buffered and fires when the cooldown ends', () => {
    const { player } = makePlayer();
    player.tryDodge();
    player.step(DODGE.durationMs); // cooldown starts
    player.step(DODGE.cooldownMs - 100); // 100ms left
    player.startBlock();
    player.tryDodge();
    expect(player.state).toBe('blocking');
    player.step(100);
    expect(player.state).toBe('dodging');
  });

  it('a dash buffered from blocking is dropped if the cooldown outlasts INPUT_BUFFER_MS', () => {
    const { player } = makePlayer();
    player.tryDodge();
    player.step(DODGE.durationMs);
    player.startBlock();
    player.tryDodge(); // full cooldown left, > INPUT_BUFFER_MS
    player.step(DODGE.cooldownMs);
    expect(player.state).toBe('blocking');
  });

  it('the dash cooldown applies while charging: dash waits, then cancels the charge when the cooldown ends', () => {
    const { player } = makePlayer();
    player.tryDodge();
    player.step(DODGE.durationMs);
    player.step(DODGE.cooldownMs - 100);
    player.tryAction(CHARGED.id);
    player.tryDodge();
    expect(player.state).toBe('acting');
    player.step(100);
    expect(player.state).toBe('dodging');
  });

  it('the dash cooldown applies in recovery: no cancel, buffered dash fires when it ends', () => {
    const { bus, player } = makePlayer();
    const log = collect(bus);
    player.tryDodge();
    player.step(DODGE.durationMs);
    player.step(DODGE.cooldownMs - 250); // 250ms left
    player.tryAction(LIGHT.id);
    player.step(LIGHT_LOCKED); // recovery, ~50ms of cooldown left
    player.tryDodge();
    expect(player.state).toBe('acting');
    expect(log.map((e) => e.type)).toEqual(['player.dodge', 'player.action']);
    player.step(50);
    expect(player.state).toBe('dodging');
  });

  it('a direct execution discards an older pending input', () => {
    const { player } = makePlayer();
    player.tryAction(LIGHT.id);
    player.step(LIGHT_LOCKED - 10);
    player.tryAction(HEAVY.id); // buffered
    player.step(10); // fires HEAVY directly from the buffer, clearing it
    player.step(HEAVY.timing.startupMs); // no stale input must remain
    expect(player.currentActionDef?.id).toBe(HEAVY.id);
  });
});
