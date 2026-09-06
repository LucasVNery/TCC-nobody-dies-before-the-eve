// src/combat/encounter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Encounter } from './encounter';
import { DODGE } from './actionDefs';
import { aabbOverlap } from './collision';

const TELEGRAPH_MS = 400;
const SWING_MS = 150;
const STEP_MS = 16;

function runFor(encounter: Encounter, ms: number) {
  let elapsed = 0;
  while (elapsed < ms) {
    encounter.step(STEP_MS);
    elapsed += STEP_MS;
  }
}

function useWeapon(encounter: Encounter, weaponId: string) {
  encounter.player.switchWeapon(weaponId);
  runFor(encounter, 260); // > SWITCH_RECOVERY_MS (250ms) — clears the attack lock
}

function attackWith(encounter: Encounter, actionId: string, totalMs: number) {
  encounter.player.tryAction(actionId);
  runFor(encounter, totalMs);
}

describe('Encounter', () => {
  it('a successful dodge resolves the dodge opportunity as taken, not expired', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    encounter.step(STEP_MS);
    expect(encounter.assaltante.state).toBe('attacking');

    runFor(encounter, TELEGRAPH_MS - STEP_MS * 2);
    encounter.player.tryDodge();
    runFor(encounter, SWING_MS + STEP_MS * 2);

    const dodgeClose = closeEvents.find(
      (e): e is { type: string; outcome: string } =>
        typeof e === 'object' && e !== null && (e as any).type === 'dodge',
    );
    expect(dodgeClose).toBeDefined();
    expect((dodgeClose as any).outcome).toBe('taken');
  });

  it('not dodging lets the dodge opportunity expire', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    const dodgeClose = closeEvents.find(
      (e): e is { type: string; outcome: string } =>
        typeof e === 'object' && e !== null && (e as any).type === 'dodge',
    );
    expect(dodgeClose).toBeDefined();
    expect((dodgeClose as any).outcome).toBe('expired');
  });

  it('landing a hit during recovery resolves the punish opportunity as taken', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 },
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS);
    expect(encounter.assaltante.state).toBe('recovering');

    encounter.player.tryAction('sword_shield.light');
    runFor(encounter, 300);

    const punishClose = closeEvents.find(
      (e): e is { type: string; outcome: string } =>
        typeof e === 'object' && e !== null && (e as any).type === 'punish',
    );
    expect(punishClose).toBeDefined();
    expect((punishClose as any).outcome).toBe('taken');
  });

  it('is deterministic: two encounters given the same scripted inputs produce the same event sequence', () => {
    function scripted(): unknown[] {
      const encounter = new Encounter(
        { x: 0, y: 0, width: 20, height: 20 },
        { x: 30, y: 0, width: 20, height: 20 },
      );
      const events: unknown[] = [];
      encounter.bus.on('opp.open', (e) => events.push(e));
      encounter.bus.on('opp.close', (e) => events.push(e));
      runFor(encounter, TELEGRAPH_MS + SWING_MS + 300);
      return events;
    }

    expect(scripted()).toEqual(scripted());
  });

  it('assaltante chases from outside attack range and eventually attacks', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 200, y: 0, width: 20, height: 20 },
    );
    let elapsed = 0;
    while (encounter.assaltante.state !== 'attacking' && elapsed < 10000) {
      encounter.step(STEP_MS);
      elapsed += STEP_MS;
    }
    expect(encounter.assaltante.state).toBe('attacking');
  });

  it('assaltante attack hitbox actually overlaps a stationary player hurtbox when it swings (reachability invariant)', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 200, y: 0, width: 20, height: 20 },
    );
    let overlapped = false;
    let elapsed = 0;
    while (elapsed < 3000) {
      encounter.step(STEP_MS);
      elapsed += STEP_MS;
      const hitbox = encounter.assaltante.attackHitbox();
      if (hitbox && aabbOverlap(hitbox, encounter.player.hurtbox())) {
        overlapped = true;
        break;
      }
    }
    expect(overlapped).toBe(true);
  });

  it('player moves via setPlayerMoveInput', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 500, y: 0, width: 20, height: 20 },
    );
    encounter.setPlayerMoveInput(1, 0);
    for (let i = 0; i < 30; i++) encounter.step(STEP_MS);
    expect(encounter.player.position.x).toBeGreaterThan(0);
  });

  it('attacking during the Assaltante telegraph resolves the dodge opportunity as missed', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    encounter.step(STEP_MS);
    expect(encounter.assaltante.state).toBe('attacking');

    encounter.player.tryAction('sword_shield.light');
    runFor(encounter, STEP_MS);

    const dodgeClose = closeEvents.find(
      (e): e is { type: string; outcome: string; attempt?: string } =>
        typeof e === 'object' && e !== null && (e as any).type === 'dodge',
    );
    expect(dodgeClose).toBeDefined();
    expect((dodgeClose as any).outcome).toBe('missed');
    expect((dodgeClose as any).attempt).toBe('sword_shield.light');
  });

  it('a punish opportunity resolved as taken raises the punish skill domain above the uniform prior', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 },
    );

    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS);
    expect(encounter.assaltante.state).toBe('recovering');

    encounter.player.tryAction('sword_shield.light');
    runFor(encounter, 300);

    encounter.profile.applyRoomBoundary();
    expect(encounter.profile.domain('punish', 'trait')).toBeGreaterThan(0.5);
  });

  it('a punish opportunity that expires naturally still counts toward the punish denominator', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 },
    );
    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS);
    expect(encounter.assaltante.state).toBe('recovering');

    runFor(encounter, 600); // let the punish window expire naturally without attacking (RECOVERY_MS = 500)

    encounter.profile.applyRoomBoundary();
    expect(encounter.profile.domain('punish', 'trait')).toBeLessThan(0.5);
    expect(encounter.profile.confidence('punish', 'trait')).toBeGreaterThan(0);
  });

  it('a punish opportunity that resolves as invalid (out of range) does not affect punish confidence', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 50, y: 0, width: 20, height: 20 }, // within ATTACK_RANGE (60) to trigger attack, but outside ATTACK_REACH (45)
    );
    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS);
    expect(encounter.assaltante.state).toBe('recovering');

    runFor(encounter, 600); // player never within ATTACK_REACH during the whole punish window

    encounter.profile.applyRoomBoundary();
    expect(encounter.profile.confidence('punish', 'trait')).toBe(0);
  });

  it('staying within ATTACK_REACH the whole time drives the distance skill domain toward 1', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 20, y: 0, width: 20, height: 20 },
    );
    runFor(encounter, 2000);
    encounter.profile.applyRoomBoundary();
    // With dim 5 now measured in seconds (Finding 1's fix), the Beta(1,1) prior
    // (weight 2) is no longer negligible next to only ~2s of accumulated evidence,
    // so domain settles around (2+1)/(2+2)=0.75 rather than the ~1.0 it reached
    // when the same 2000 raw ticks were (incorrectly) treated as 2000 "seconds".
    expect(encounter.profile.domain('distance', 'trait')).toBeGreaterThan(0.7);
    expect(encounter.profile.confidence('distance', 'trait')).toBeCloseTo(2 / (2 + 10), 2);
  });

  it('staying outside ATTACK_REACH drives the distance skill domain toward 0', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 500, y: 0, width: 20, height: 20 },
    );
    runFor(encounter, 500); // not enough time for the (slower) Assaltante to close a ~480px gap into ATTACK_REACH
    encounter.profile.applyRoomBoundary();
    // Same seconds-scale prior effect as above: ~0.5s of evidence against a
    // Beta(1,1) prior settles around (0+1)/(0.5+2)=0.4, well below the 0.5
    // uninformative prior but far from the ~0 this test asserted pre-fix.
    expect(encounter.profile.domain('distance', 'trait')).toBeLessThan(0.45);
  });

  it('the action-repertoire dimension end to end: a mixed sequence of light/heavy/charged actions yields the hand-computed entropy at room.exit', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 1000, y: 0, width: 20, height: 20 }, // far enough away to stay out of the way
    );

    function doLight() {
      encounter.player.tryAction('sword_shield.light');
      runFor(encounter, 400); // > light's total duration (350ms)
    }
    function doHeavy() {
      encounter.player.tryAction('sword_shield.heavy');
      runFor(encounter, 700); // > heavy's total duration (640ms)
    }
    function doCharged() {
      encounter.player.tryAction('sword_shield.charged');
      runFor(encounter, 300); // still charging (< maxHoldMs 900), > minHoldMs 150
      encounter.player.releaseAction();
      runFor(encounter, 600); // > charged's active+recovery (140+350=490ms)
    }

    for (let i = 0; i < 6; i++) doLight();
    for (let i = 0; i < 3; i++) doHeavy();
    doCharged();

    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');

    const counts = { light: 6, heavy: 3, charged: 1 };
    const total = 10;
    const H =
      -Object.values(counts).reduce((acc, c) => {
        const p = c / total;
        return acc + p * Math.log(p);
      }, 0) / Math.log(5);

    expect(snap.domain.action_repertoire).toBeCloseTo(H, 6);
    expect(snap.counts.action_repertoire).toEqual([3, 10]);
  });

  it('using only light attacks keeps the action-repertoire domain null and ineligible as a deficit target', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 1000, y: 0, width: 20, height: 20 },
    );

    for (let i = 0; i < 5; i++) {
      encounter.player.tryAction('sword_shield.light');
      runFor(encounter, 400);
    }

    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.domain.action_repertoire).toBeNull();
  });

  it('the weapon-repertoire dimension end to end: switching weapons between attacks yields the hand-computed entropy at room.exit', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 1000, y: 0, width: 20, height: 20 }, // far enough away to stay out of the way
    );

    useWeapon(encounter, 'bow');
    for (let i = 0; i < 3; i++) attackWith(encounter, 'bow.shot', 340); // 80+60+200

    useWeapon(encounter, 'heavy_weapon');
    for (let i = 0; i < 2; i++) attackWith(encounter, 'heavy_weapon.light', 500); // 160+120+220

    useWeapon(encounter, 'sword_shield');
    for (let i = 0; i < 4; i++) attackWith(encounter, 'sword_shield.light', 400); // > 350

    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');

    const counts = { bow: 3, heavy_weapon: 2, sword_shield: 4 };
    const total = 9;
    const H =
      -Object.values(counts).reduce((acc, c) => {
        const p = c / total;
        return acc + p * Math.log(p);
      }, 0) / Math.log(3);

    expect(snap.domain.weapon_repertoire).toBeCloseTo(H, 6);
    expect(snap.counts.weapon_repertoire).toEqual([3, 9]);
  });

  it('using only one weapon keeps the weapon-repertoire domain null', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 1000, y: 0, width: 20, height: 20 },
    );

    for (let i = 0; i < 5; i++) attackWith(encounter, 'sword_shield.light', 400);

    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.domain.weapon_repertoire).toBeNull();
  });
});
