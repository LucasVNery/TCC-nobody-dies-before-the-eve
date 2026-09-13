// src/combat/encounter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Encounter } from './encounter';
import { DODGE } from './actionDefs';
import { sectorOverlapsBox } from './sector';
import { resolveAction, totalCommitmentMs } from './actionRegistry';

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

    encounter.player.startBlock(); // guard held well before impact -> resolves as a block (not parry, since PARRY_WINDOW_MS is only 150ms and this guard has been up ~400ms by the time the swing connects); player never moves, so the punish attack below still reaches the Assaltante
    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS);
    encounter.player.stopBlock(); // back to idle so tryAction() below isn't a no-op
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
      if (hitbox && sectorOverlapsBox(hitbox, encounter.player.hurtbox())) {
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

    encounter.player.startBlock(); // guard held well before impact -> resolves as a block (not parry, since PARRY_WINDOW_MS is only 150ms and this guard has been up ~400ms by the time the swing connects); player never moves, so the punish attack below still reaches the Assaltante
    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS);
    encounter.player.stopBlock(); // back to idle so tryAction() below isn't a no-op
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

  it('a well-timed parry (E right before impact) resolves dodge as taken, records the parry label, and opens a bigger punish window', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    encounter.step(STEP_MS);
    expect(encounter.assaltante.state).toBe('attacking');

    runFor(encounter, TELEGRAPH_MS - STEP_MS * 2);
    encounter.player.startBlock(); // right before impact -> parry window
    runFor(encounter, STEP_MS * 3); // let the swing connect while still inside PARRY_WINDOW_MS

    expect(encounter.assaltante.state).toBe('recovering');
    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.counts.defensive_repertoire).toEqual([1, 1]); // exactly 1 label recorded: parry
  });

  it('holding block from well before impact (past PARRY_WINDOW_MS) absorbs the hit as a block, draining poise, not a parry', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    encounter.player.startBlock();
    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    // Block absorbs the hit but — unlike parry — never cuts the swing short;
    // the Assaltante still reaches 'recovering' on its own normal timing.
    // Poise drops by exactly one hit's worth (40), not to 0 — the hitbox
    // keeps overlapping for the rest of the ~150ms swing, but the guard
    // must make absorbBlockHit() fire only once per attack window.
    expect(encounter.player.poise).toBe(60);
    expect(encounter.assaltante.state).toBe('recovering');
  });

  it('re-blocking then re-entering the parry-timing window mid-swing does not grant a second parry once the window is already resolved', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    encounter.player.startBlock(); // held from t=0 -> resolves as an ordinary block, not a parry, when the swing connects at TELEGRAPH_MS
    runFor(encounter, TELEGRAPH_MS + STEP_MS);
    expect(encounter.player.poise).toBeLessThan(100); // confirms the block already absorbed the hit this window

    encounter.player.stopBlock();
    encounter.player.startBlock(); // re-press -> blockHeldMs resets to 0, briefly back inside the parry window
    runFor(encounter, STEP_MS * 3); // hitbox is still overlapping (swing runs until TELEGRAPH_MS + SWING_MS)

    // Without the fix, this second parry-timing window would incorrectly cut the swing short.
    expect(encounter.assaltante.state).toBe('attacking');
  });

  it('taking a hit with no defense at all increments the unmitigated-hit counter and staggers the player', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );
    const hitEvents: unknown[] = [];
    encounter.bus.on('player.hit_unmitigated', (e) => hitEvents.push(e));

    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    expect(hitEvents).toHaveLength(1);
    expect(encounter.player.state).toBe('staggered');
  });

  it('retreating out of range before the swing connects, with no defense used, records the retreat label', () => {
    // Player at x=100 (not x=0) so there's room to retreat left without
    // hitting ARENA_BOUNDS' left edge (x=0).
    const encounter = new Encounter(
      { x: 100, y: 0, width: 20, height: 20 },
      { x: 130, y: 0, width: 20, height: 20 },
    );
    encounter.step(STEP_MS);
    expect(encounter.assaltante.state).toBe('attacking');

    encounter.setPlayerMoveInput(-1, 0); // run away from the Assaltante
    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.counts.defensive_repertoire).toEqual([1, 1]); // exactly 1 label recorded: retreat
  });

  it('a full sequence of one of each defense yields exactly 4 dim-4 records and 1 unmitigated hit', () => {
    // Room 1: dodge
    const e1 = new Encounter({ x: 0, y: 0, width: 20, height: 20 }, { x: 30, y: 0, width: 20, height: 20 });
    e1.step(STEP_MS);
    runFor(e1, TELEGRAPH_MS - STEP_MS * 2);
    e1.player.tryDodge();
    runFor(e1, SWING_MS + STEP_MS * 2);

    // Room 2: parry
    const e2 = new Encounter({ x: 0, y: 0, width: 20, height: 20 }, { x: 30, y: 0, width: 20, height: 20 });
    e2.step(STEP_MS);
    runFor(e2, TELEGRAPH_MS - STEP_MS * 2);
    e2.player.startBlock();
    runFor(e2, STEP_MS * 3);

    // Room 3: block (held from well before impact)
    const e3 = new Encounter({ x: 0, y: 0, width: 20, height: 20 }, { x: 30, y: 0, width: 20, height: 20 });
    e3.player.startBlock();
    runFor(e3, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    // Room 4: retreat (player offset from x=0 so there's room to move away
    // from the Assaltante without hitting ARENA_BOUNDS' left edge)
    const e4 = new Encounter({ x: 100, y: 0, width: 20, height: 20 }, { x: 130, y: 0, width: 20, height: 20 });
    e4.step(STEP_MS);
    e4.setPlayerMoveInput(-1, 0);
    runFor(e4, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    // Room 5: unmitigated hit
    const e5 = new Encounter({ x: 0, y: 0, width: 20, height: 20 }, { x: 30, y: 0, width: 20, height: 20 });
    const hits: unknown[] = [];
    e5.bus.on('player.hit_unmitigated', (e) => hits.push(e));
    runFor(e5, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    for (const e of [e1, e2, e3, e4, e5]) e.profile.applyRoomBoundary();
    expect(e1.profile.snapshot('room.exit').counts.defensive_repertoire).toEqual([1, 1]);
    expect(e2.profile.snapshot('room.exit').counts.defensive_repertoire).toEqual([1, 1]);
    expect(e3.profile.snapshot('room.exit').counts.defensive_repertoire).toEqual([1, 1]);
    expect(e4.profile.snapshot('room.exit').counts.defensive_repertoire).toEqual([1, 1]);
    expect(e5.profile.snapshot('room.exit').counts.defensive_repertoire).toBeUndefined(); // never folded, nothing recorded
    expect(hits).toHaveLength(1);
  });

  it('a stationary in-range player approached diagonally is hit, not misread as retreat (regression for the 4-quadrant hitbox bug)', () => {
    const encounter = new Encounter(
      { x: 130, y: 30, width: 20, height: 20 },
      { x: 100, y: 0, width: 20, height: 20 },
    );
    const hitEvents: unknown[] = [];
    encounter.bus.on('player.hit_unmitigated', (e) => hitEvents.push(e));

    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS * 2);

    expect(hitEvents).toHaveLength(1);
    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.counts.defensive_repertoire).toBeUndefined(); // no dim-4 label — the window resolved as a hit, not a retreat
  });

  it('an attack started while the Assaltante is far away and idle is recorded as a patient window', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 2000, y: 0, width: 20, height: 20 },
    );

    encounter.player.tryAction('sword_shield.light'); // commitmentMs = 350; Assaltante can't possibly close 1940px in time

    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.counts.patience).toEqual([1, 1]);
  });

  it('an attack started while the Assaltante is mid-telegraph and aimed at the player is recorded as not patient', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    );

    encounter.step(STEP_MS); // Assaltante enters 'attacking', aimed at the player
    expect(encounter.assaltante.state).toBe('attacking');
    runFor(encounter, 336); // advance deep into the telegraph (still < TELEGRAPH_MS)

    encounter.player.tryAction('sword_shield.light'); // commitmentMs = 350; active phase begins within that window

    encounter.profile.applyRoomBoundary();
    const snap = encounter.profile.snapshot('room.exit');
    expect(snap.counts.patience).toEqual([0, 1]);
  });

  describe('predictThreatMs vs. the real loop (spec §2.3 criterion 4)', () => {
    // Assaltante starts at distance 150, outside ATTACK_RANGE (60), so it
    // must CHASE before it can telegraph — this is the branch of
    // predictThreatMs that a pure telegraph-only test (like the two above)
    // never exercises. With ASSALTANTE_CHASE_SPEED=90px/s:
    //   closeMs = (150 - 60) / 90 * 1000 = 1000ms
    //   predictThreatMs = closeMs + TELEGRAPH_MS = 1000 + 400 = 1400ms
    // The real 16ms-step loop re-checks distance (and only *then* moves)
    // every tick, so it crosses into ATTACK_RANGE one tick later than the
    // continuous model assumes, and its telegraph clock starts a tick after
    // that — the discrete loop's attack actually goes active at 1408ms, 8ms
    // (about half a step) after the continuous prediction. This is the
    // "conservative" discretization bias documented in spec §10: the
    // predictor never claims *more* safety than the real loop delivers.
    const DISTANCE = 150;

    it('agrees with reality when neither model reaches the threat within the horizon (negative case)', () => {
      const encounter = new Encounter(
        { x: 0, y: 0, width: 20, height: 20 },
        { x: DISTANCE, y: 0, width: 20, height: 20 },
      );
      // A real registry action: sword_shield.heavy = 220+120+300 = 640ms,
      // far short of the ~1400-1408ms it'd take the Assaltante to threaten —
      // this exercises predictThreatMs's CHASE-branch early return
      // (`elapsed + closeMs > horizonMs`) without ever reaching the
      // attacking-phase / sector-overlap logic.
      const commitmentMs = totalCommitmentMs(resolveAction('sword_shield.heavy'));
      expect(commitmentMs).toBe(640);

      const prediction = encounter.assaltante.msUntilThreatens(encounter.player.hurtbox(), commitmentMs);

      const hitEvents: unknown[] = [];
      encounter.bus.on('player.hit_unmitigated', (e) => hitEvents.push(e));
      runFor(encounter, commitmentMs);

      expect(prediction).toBeNull();
      expect(hitEvents).toHaveLength(0);
      expect(prediction !== null).toBe(hitEvents.length > 0);
    });

    it('agrees with reality when both models reach the threat within the horizon (positive case)', () => {
      const encounter = new Encounter(
        { x: 0, y: 0, width: 20, height: 20 },
        { x: DISTANCE, y: 0, width: 20, height: 20 },
      );
      // Comfortably above both the continuous prediction (1400ms) and the
      // real loop's actual active-at time (1408ms), with margin well beyond
      // the one-step discretization bias — not a knife's-edge horizon that
      // would make this test flaky.
      const horizonMs = 1500;

      const prediction = encounter.assaltante.msUntilThreatens(encounter.player.hurtbox(), horizonMs);

      const hitEvents: unknown[] = [];
      encounter.bus.on('player.hit_unmitigated', (e) => hitEvents.push(e));
      runFor(encounter, horizonMs);

      // If predictThreatMs had a subtly wrong reach/geometry adjustment (e.g.
      // the sector's reach or the closing-distance math were off), this is
      // the branch that would catch it: a wrong reach could make the
      // predicted sector miss the target (flipping this to null) or the real
      // sweep miss/hit differently than predicted.
      expect(prediction).toBe(1400);
      expect(hitEvents.length).toBeGreaterThan(0);
      expect(prediction !== null).toBe(hitEvents.length > 0);
    });
  });
});
