// src/combat/elitePatterns.test.ts
// Elite combo and ground slam (combat v2 spec §4.3).
import { describe, it, expect } from 'vitest';
import { Encounter } from './encounter';
import { ELITE, ELITE_TELEGRAPH_MS } from './eliteDefs';
import { ASSALTANTE_MAX_HP, PLAYER_MAX_HP } from './movementDefs';
import { PARRY_BONUS_RECOVERY_MS } from './actionDefs';
import { sectorOverlapsBox } from './sector';

const STEP_MS = 16;
// beginPattern runs before the first step; the n-th step has phase 16 * n.
const SWING_STRIKE_STEP = Math.ceil(ELITE_TELEGRAPH_MS.swing / STEP_MS); // 29: first active tick of combo strike 1
const FIRST_END_STEP = Math.ceil((ELITE_TELEGRAPH_MS.swing + 150) / STEP_MS); // 38: strike 2 begins on this step
const SECOND_STRIKE_STEP = FIRST_END_STEP + ELITE_TELEGRAPH_MS.combo / STEP_MS; // 58: first active tick of strike 2
const SLAM_STRIKE_STEP = Math.ceil(ELITE_TELEGRAPH_MS.slam / STEP_MS); // 44

interface Log {
  starts: Array<{ kind: string; hit?: number }>;
  opens: Array<{ opp_id: string; type: string; src: string; window_ms: number }>;
  closes: Array<{ opp_id: string; type: string; outcome: string; reason?: string }>;
  defenses: Array<{ label: string; perfect?: boolean }>;
  hurts: Array<{ dmg: number; hp_after: number }>;
}

function setup(player: { x: number; y: number }, enemy: { x: number; y: number }) {
  const encounter = new Encounter(
    { x: player.x, y: player.y, width: 20, height: 20 },
    { x: enemy.x, y: enemy.y, width: 20, height: 20 },
  );
  const log: Log = { starts: [], opens: [], closes: [], defenses: [], hurts: [] };
  encounter.bus.on('enemy.attack_start', (e) => log.starts.push(e));
  encounter.bus.on('opp.open', (e) => log.opens.push(e));
  encounter.bus.on('opp.close', (e) => log.closes.push(e));
  encounter.bus.on('player.defense', (e) => log.defenses.push(e));
  encounter.bus.on('player.hurt', (e) => log.hurts.push(e));
  return { encounter, log };
}

/** `count` steps, numbering them from `from` (1-based). */
function steps(encounter: Encounter, from: number, to: number, before?: (step: number) => void) {
  for (let n = from; n <= to; n++) {
    before?.(n);
    encounter.step(STEP_MS);
  }
}

/** Takes the player out of reach and lets every pending window run out, so the open/close counts can be compared. */
function settle(encounter: Encounter) {
  encounter.player.reset({ x: -900, y: 0 });
  steps(encounter, 1, 100);
}

function conserved(log: Log) {
  expect(log.closes.length).toBe(log.opens.length);
  expect(new Set(log.closes.map((c) => c.opp_id))).toEqual(new Set(log.opens.map((o) => o.opp_id)));
}

describe('elite HP', () => {
  it('has 160 HP', () => {
    const { encounter } = setup({ x: 0, y: 0 }, { x: 30, y: 0 });
    expect(ASSALTANTE_MAX_HP).toBe(160);
    expect(encounter.assaltante.hp).toBe(160);
  });
});

describe('beginPattern', () => {
  it('is ignored while the elite is already attacking', () => {
    const { encounter, log } = setup({ x: 0, y: 0 }, { x: 30, y: 0 });
    encounter.assaltante.beginPattern('combo', encounter.player.position);
    encounter.assaltante.beginPattern('slam', encounter.player.position);
    expect(log.opens).toHaveLength(1);
    expect(encounter.assaltante.attackKind).toBe('combo');
  });
});

describe('combo', () => {
  it('chains two strikes, each with its own dodge window, then one punish window; opps are conserved', () => {
    const { encounter, log } = setup({ x: -600, y: 0 }, { x: 30, y: 0 });
    const a = encounter.assaltante;
    a.beginPattern('combo', encounter.player.position);
    expect(a.attackKind).toBe('combo');
    expect(log.starts).toEqual([{ kind: 'combo', hit: 1 }]);
    expect(log.opens[0]).toMatchObject({ type: 'dodge', src: 'assaltante.combo', window_ms: 600 });

    // telegraph 450: no hitbox / no landing before the first strike tick
    steps(encounter, 1, SWING_STRIKE_STEP - 1);
    expect(a.attackHitbox()).toBeNull();
    expect(a.strikeLanding()).toBe(false);
    steps(encounter, SWING_STRIKE_STEP, SWING_STRIKE_STEP);
    expect(a.attackHitbox()).not.toBeNull();
    expect(a.strikeLanding()).toBe(true);

    // end of strike 1: window 1 closed (retreat, the player is far away) and window 2 opened
    steps(encounter, SWING_STRIKE_STEP + 1, FIRST_END_STEP);
    expect(log.starts).toEqual([{ kind: 'combo', hit: 1 }, { kind: 'combo', hit: 2 }]);
    const dodgeOpens = log.opens.filter((o) => o.type === 'dodge');
    expect(dodgeOpens).toHaveLength(2);
    expect(dodgeOpens[1]).toMatchObject({ src: 'assaltante.combo', window_ms: ELITE_TELEGRAPH_MS.combo + 150 });
    expect(log.closes.find((c) => c.opp_id === dodgeOpens[0].opp_id)).toMatchObject({ outcome: 'expired' });
    expect(log.defenses).toEqual([{ label: 'retreat' }]);
    expect(a.state).toBe('attacking'); // no recovery between the strikes
    expect(a.attackHitbox()).toBeNull();

    steps(encounter, FIRST_END_STEP + 1, SECOND_STRIKE_STEP - 1);
    expect(a.strikeLanding()).toBe(false);
    steps(encounter, SECOND_STRIKE_STEP, SECOND_STRIKE_STEP);
    expect(a.strikeLanding()).toBe(true);

    steps(encounter, SECOND_STRIKE_STEP + 1, SECOND_STRIKE_STEP + 12);
    expect(a.state).toBe('recovering');
    expect(log.defenses).toEqual([{ label: 'retreat' }, { label: 'retreat' }]);
    const punishes = log.opens.filter((o) => o.type === 'punish');
    expect(punishes).toHaveLength(1);
    expect(punishes[0].window_ms).toBe(500);
    settle(encounter); // the punish window runs out
    conserved(log);
  });

  it('a player dodging strike 1 and standing in the area still takes strike 2: 20 damage and stagger', () => {
    // dash toward the elite from the left (the dash covers ~113 u; the arena clamps x at 0), i-frames up at strike 1; it ends inside the area of strike 2
    const { encounter, log } = setup({ x: 200, y: 0 }, { x: 330, y: 0 });
    encounter.assaltante.beginPattern('combo', encounter.player.position);
    steps(encounter, 1, SECOND_STRIKE_STEP + 4, (n) => {
      if (n === SWING_STRIKE_STEP - 8 + 1) {
        encounter.setPlayerMoveInput(1, 0);
        encounter.player.tryDodge();
      }
      if (n === SWING_STRIKE_STEP - 8 + 2) encounter.setPlayerMoveInput(0, 0);
    });
    expect(log.defenses.map((d) => d.label)).toEqual(['dodge']);
    const dodgeOpens = log.opens.filter((o) => o.type === 'dodge');
    expect(log.closes.find((c) => c.opp_id === dodgeOpens[0].opp_id)?.outcome).toBe('taken');
    expect(log.hurts).toHaveLength(1);
    expect(log.hurts[0].dmg).toBe(ELITE.swingDamage);
    expect(encounter.player.hp).toBe(PLAYER_MAX_HP - 20);
    expect(encounter.player.state).toBe('staggered');
    settle(encounter);
    expect(log.hurts).toHaveLength(1); // hit once for strike 2
    conserved(log);
  });

  it('dodging strike 1 and strike 2 each credit a dodge, strike 2 by invulnerability alone while standing outside the sector', () => {
    // Two dashes away from the elite: both end outside every sector. Strike 2's first active tick is credited
    // only because firstLandingProcessed is re-armed when the second dodge window opens.
    const { encounter, log } = setup({ x: 250, y: 0 }, { x: 330, y: 0 });
    const a = encounter.assaltante;
    a.beginPattern('combo', encounter.player.position);
    steps(encounter, 1, SECOND_STRIKE_STEP + 4, (n) => {
      if (n === SWING_STRIKE_STEP - 8 || n === SECOND_STRIKE_STEP - 8) {
        encounter.setPlayerMoveInput(-1, 0);
        encounter.player.tryDodge();
      }
    });
    expect(log.defenses.map((d) => d.label)).toEqual(['dodge', 'dodge']);
    const dodgeOpens = log.opens.filter((o) => o.type === 'dodge');
    expect(dodgeOpens).toHaveLength(2);
    for (const open of dodgeOpens) {
      expect(log.closes.find((c) => c.opp_id === open.opp_id)?.outcome).toBe('taken');
    }
    expect(log.hurts).toHaveLength(0);
    settle(encounter);
    conserved(log);
  });

  it('an unmitigated strike 1 hurts, and strike 2 hurts again (two separate defense flags)', () => {
    const { encounter, log } = setup({ x: 0, y: 0 }, { x: 30, y: 0 });
    encounter.assaltante.beginPattern('combo', encounter.player.position);
    steps(encounter, 1, SECOND_STRIKE_STEP + 4);
    expect(log.hurts).toHaveLength(2);
    expect(log.hurts.map((h) => h.dmg)).toEqual([20, 20]);
    expect(encounter.player.hp).toBe(PLAYER_MAX_HP - 40);
  });

  it('a parry on strike 1 ends the combo with the 750 ms punish window', () => {
    const { encounter, log } = setup({ x: 0, y: 0 }, { x: 30, y: 0 });
    const a = encounter.assaltante;
    a.beginPattern('combo', encounter.player.position);
    steps(encounter, 1, SWING_STRIKE_STEP - 4, () => undefined);
    encounter.player.startBlock(); // pressed just before the impact: parry timing
    steps(encounter, SWING_STRIKE_STEP - 3, SWING_STRIKE_STEP + 2);
    expect(log.defenses.map((d) => d.label)).toEqual(['parry']);
    expect(a.state).toBe('recovering');
    expect(log.hurts).toHaveLength(0);
    expect(log.opens.filter((o) => o.type === 'dodge')).toHaveLength(1);
    expect(log.opens.filter((o) => o.type === 'punish')[0].window_ms).toBe(PARRY_BONUS_RECOVERY_MS);
    expect(log.starts).toEqual([{ kind: 'combo', hit: 1 }]); // no strike 2
    settle(encounter);
    conserved(log);
  });

  it('dodging strike 1 and parrying strike 2 resolves both', () => {
    const { encounter, log } = setup({ x: 200, y: 0 }, { x: 330, y: 0 });
    const a = encounter.assaltante;
    a.beginPattern('combo', encounter.player.position);
    steps(encounter, 1, SECOND_STRIKE_STEP - 4, (n) => {
      if (n === SWING_STRIKE_STEP - 8 + 1) {
        encounter.setPlayerMoveInput(1, 0);
        encounter.player.tryDodge();
      }
      if (n === SWING_STRIKE_STEP - 8 + 2) encounter.setPlayerMoveInput(0, 0);
    });
    encounter.player.startBlock();
    steps(encounter, SECOND_STRIKE_STEP - 3, SECOND_STRIKE_STEP + 3);
    expect(log.defenses.map((d) => d.label)).toEqual(['dodge', 'parry']);
    expect(log.hurts).toHaveLength(0);
    expect(a.state).toBe('recovering');
    expect(log.opens.filter((o) => o.type === 'punish')[0].window_ms).toBe(PARRY_BONUS_RECOVERY_MS);
    settle(encounter);
    conserved(log);
  });

  it('the player dying during strike 1 closes the combo as invalid/player_dead; no second strike, opps conserved', () => {
    const { encounter, log } = setup({ x: 0, y: 0 }, { x: 30, y: 0 });
    encounter.assaltante.beginPattern('combo', encounter.player.position);
    steps(encounter, 1, 10);
    encounter.respawnEnemy({ x: 900, y: 600 }, 'player_dead');
    expect(log.closes).toHaveLength(1);
    expect(log.closes[0]).toMatchObject({ type: 'dodge', outcome: 'invalid', reason: 'player_dead' });
    expect(encounter.assaltante.attackKind).toBeNull();
    conserved(log);
  });

  it('the player dying during strike 2 closes strike 2 invalid, and strike 1 was already closed', () => {
    const { encounter, log } = setup({ x: -600, y: 0 }, { x: 30, y: 0 });
    encounter.assaltante.beginPattern('combo', encounter.player.position);
    steps(encounter, 1, FIRST_END_STEP + 5);
    expect(log.opens.filter((o) => o.type === 'dodge')).toHaveLength(2);
    encounter.respawnEnemy({ x: 900, y: 600 }, 'player_dead');
    const dodgeCloses = log.closes.filter((c) => c.type === 'dodge');
    expect(dodgeCloses.map((c) => c.outcome)).toEqual(['expired', 'invalid']);
    expect(dodgeCloses[1].reason).toBe('player_dead');
    conserved(log);
  });

  it('a bomb stagger during strike 2 closes its window as source_interrupted', () => {
    const { encounter, log } = setup({ x: -600, y: 0 }, { x: 30, y: 0 });
    encounter.assaltante.beginPattern('combo', encounter.player.position);
    steps(encounter, 1, FIRST_END_STEP + 5);
    encounter.assaltante.stagger(400);
    expect(log.closes[log.closes.length - 1]).toMatchObject({ outcome: 'invalid', reason: 'source_interrupted' });
    expect(log.starts).toHaveLength(2);
    settle(encounter);
    conserved(log);
  });

  it('the elite dying on the player hit mid-combo (respawn as source_interrupted) conserves opps', () => {
    const { encounter, log } = setup({ x: -600, y: 0 }, { x: 30, y: 0 });
    encounter.assaltante.beginPattern('combo', encounter.player.position);
    steps(encounter, 1, 20);
    encounter.respawnEnemy({ x: 900, y: 600 }, 'source_interrupted');
    expect(log.closes[0]).toMatchObject({ outcome: 'invalid', reason: 'source_interrupted' });
    conserved(log);
  });

  it('re-aims at the start of each strike', () => {
    const { encounter } = setup({ x: 0, y: 0 }, { x: 300, y: 0 });
    const a = encounter.assaltante;
    a.beginPattern('combo', encounter.player.position);
    expect(a.attackDirection).toEqual({ x: -1, y: 0 });
    // the player moves above the elite before strike 2 starts
    const player = encounter.player;
    player.reset({ x: 300, y: -200 });
    steps(encounter, 1, FIRST_END_STEP);
    expect(a.attackDirection.y).toBeLessThan(-0.5);
  });

  it('msUntilThreatens is the telegraph remaining while the target is in reach, null when safe', () => {
    const { encounter } = setup({ x: 0, y: 0 }, { x: 30, y: 0 });
    const a = encounter.assaltante;
    a.beginPattern('combo', encounter.player.position);
    steps(encounter, 1, 1);
    const near = { x: 0, y: 0, width: 20, height: 20 };
    expect(a.msUntilThreatens(near, 1000)).toBe(ELITE_TELEGRAPH_MS.swing - STEP_MS);
    const far = { x: -800, y: 0, width: 20, height: 20 };
    expect(a.msUntilThreatens(far, 100)).toBeNull();
  });

  it('msUntilThreatens covers the second strike for a target outside the aimed fan but inside the circle', () => {
    const { encounter } = setup({ x: 0, y: 0 }, { x: 30, y: 0 });
    const a = encounter.assaltante;
    a.beginPattern('combo', encounter.player.position);
    steps(encounter, 1, 1);
    const behind = { x: 60, y: 0, width: 20, height: 20 }; // behind the elite, aimed left
    const t = a.msUntilThreatens(behind, 2000);
    expect(t).toBe(ELITE_TELEGRAPH_MS.swing + 150 - STEP_MS + ELITE_TELEGRAPH_MS.combo);
  });
});

describe('ground slam', () => {
  it('telegraphs 700 ms, then hits a full circle of radius 110 + half width for 30 damage and a stagger', () => {
    const { encounter, log } = setup({ x: 0, y: 0 }, { x: 30, y: 0 });
    const a = encounter.assaltante;
    a.beginPattern('slam', encounter.player.position);
    expect(log.starts).toEqual([{ kind: 'slam' }]);
    expect(a.attackKind).toBe('slam');
    expect(a.currentStrikeDamage).toBe(ELITE.slamDamage);
    expect(log.opens[0]).toMatchObject({ type: 'dodge', src: 'assaltante.slam', window_ms: 700 + ELITE.slamActiveMs });

    steps(encounter, 1, SLAM_STRIKE_STEP - 1);
    expect(a.attackHitbox()).toBeNull();
    expect(log.hurts).toHaveLength(0);
    steps(encounter, SLAM_STRIKE_STEP, SLAM_STRIKE_STEP);
    const hitbox = a.attackHitbox()!;
    expect(hitbox.halfAngleRad).toBe(Math.PI);
    expect(hitbox.reach).toBe(ELITE.slamRadius + 10);
    expect(hitbox.origin).toEqual({ x: 40, y: 10 });
    expect(a.strikeLanding()).toBe(true);

    expect(log.hurts).toHaveLength(1);
    expect(log.hurts[0]).toEqual({ dmg: 30, hp_after: PLAYER_MAX_HP - 30 });
    expect(encounter.player.state).toBe('staggered');
    steps(encounter, SLAM_STRIKE_STEP + 1, SLAM_STRIKE_STEP + 10);
    expect(log.hurts).toHaveLength(1);
    expect(a.state).toBe('recovering');
    expect(log.opens.filter((o) => o.type === 'punish')[0].window_ms).toBe(ELITE.slamRecoveryMs);
    expect(a.currentStrikeDamage).toBe(ELITE.swingDamage);
    settle(encounter);
    conserved(log);
  });

  it('hits in every direction, including behind the elite', () => {
    const { encounter } = setup({ x: 0, y: 0 }, { x: 30, y: 0 });
    const a = encounter.assaltante;
    a.beginPattern('slam', { x: 0, y: 0 });
    steps(encounter, 1, SLAM_STRIKE_STEP);
    const behind = { x: 100, y: 0, width: 20, height: 20 };
    const farAway = { x: 400, y: 0, width: 20, height: 20 };
    expect(sectorOverlapsBox(a.attackHitbox()!, behind)).toBe(true);
    expect(sectorOverlapsBox(a.attackHitbox()!, farAway)).toBe(false);
  });

  it('a player at 200 u without i-frames takes no damage; the window expires as retreat', () => {
    const { encounter, log } = setup({ x: 0, y: 0 }, { x: 200, y: 0 });
    encounter.assaltante.beginPattern('slam', encounter.player.position);
    steps(encounter, 1, SLAM_STRIKE_STEP + 12);
    expect(log.hurts).toHaveLength(0);
    expect(log.defenses).toEqual([{ label: 'retreat' }]);
    const slamOpen = log.opens.find((o) => o.src === 'assaltante.slam')!;
    expect(log.closes.find((c) => c.opp_id === slamOpen.opp_id)?.outcome).toBe('expired');
    settle(encounter);
    conserved(log);
  });

  it('a dash with i-frames up at the strike credits the dodge, no damage, window taken', () => {
    const { encounter, log } = setup({ x: 0, y: 0 }, { x: 30, y: 0 });
    encounter.assaltante.beginPattern('slam', encounter.player.position);
    steps(encounter, 1, SLAM_STRIKE_STEP + 6, (n) => {
      if (n === SLAM_STRIKE_STEP - 8 + 1) {
        encounter.setPlayerMoveInput(-1, 0);
        encounter.player.tryDodge();
      }
    });
    expect(log.defenses.map((d) => d.label)).toEqual(['dodge']);
    expect(log.hurts).toHaveLength(0);
    const slamOpen = log.opens.find((o) => o.src === 'assaltante.slam')!;
    expect(log.closes.find((c) => c.opp_id === slamOpen.opp_id)?.outcome).toBe('taken');
    settle(encounter);
    conserved(log);
  });

  it('a bomb during the telegraph closes the window as invalid/source_interrupted and cancels the slam', () => {
    const { encounter, log } = setup({ x: 0, y: 0 }, { x: 30, y: 0 });
    encounter.assaltante.beginPattern('slam', encounter.player.position);
    steps(encounter, 1, 20);
    encounter.assaltante.stagger(400);
    expect(log.closes).toHaveLength(1);
    expect(log.closes[0]).toMatchObject({ outcome: 'invalid', reason: 'source_interrupted' });
    expect(encounter.assaltante.attackKind).toBeNull();
    steps(encounter, 21, 24 + 10); // the 400 ms stagger spans the moment the slam would have landed
    expect(log.hurts).toHaveLength(0);
    expect(encounter.assaltante.attackHitbox()).toBeNull();
    settle(encounter);
    conserved(log);
  });

  it('msUntilThreatens: the telegraph remaining inside the radius, null outside it', () => {
    const { encounter } = setup({ x: 0, y: 0 }, { x: 30, y: 0 });
    const a = encounter.assaltante;
    a.beginPattern('slam', encounter.player.position);
    steps(encounter, 1, 1);
    const near = { x: 0, y: 0, width: 20, height: 20 };
    const behind = { x: 100, y: 0, width: 20, height: 20 };
    const far = { x: 400, y: 0, width: 20, height: 20 };
    expect(a.msUntilThreatens(near, 1000)).toBe(ELITE_TELEGRAPH_MS.slam - STEP_MS);
    expect(a.msUntilThreatens(behind, 1000)).toBe(ELITE_TELEGRAPH_MS.slam - STEP_MS);
    expect(a.msUntilThreatens(far, 1000)).toBeNull();
    expect(a.msUntilThreatens(near, 100)).toBeNull(); // beyond the horizon
  });
});
