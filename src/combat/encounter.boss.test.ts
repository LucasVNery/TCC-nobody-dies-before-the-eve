import { describe, it, expect, vi } from 'vitest';
import { Encounter } from './encounter';
import { BossBrain } from '../boss/bossBrain';
import { BOSS_CONFIG } from '../boss/bossConfig';
import type { Prng } from '../core/prng';

const STEP_MS = 16;
const zeroPrng: Prng = { next: () => 0, nextInt: () => 0 };

function setup(playerX: number) {
  const e = new Encounter(
    { x: playerX, y: 0, width: 20, height: 20 },
    { x: 100, y: 0, width: 20, height: 20 },
  );
  const onBarrage = vi.fn();
  e.boss = new BossBrain({ barrageLevel: 1, prng: zeroPrng, onBarrage });
  return { e, onBarrage };
}

describe('Encounter boss wiring', () => {
  it('a still blocking player near an idle enemy triggers the barrage', () => {
    const { e, onBarrage } = setup(40);
    e.player.startBlock();
    for (let t = 0; t < 1300; t += STEP_MS) e.step(STEP_MS);
    expect(e.boss!.windowsSeen).toBe(1);
    expect(onBarrage).toHaveBeenCalledTimes(1);
    expect(onBarrage.mock.calls[0][0]).toBe(4);
  });

  it('a moving player never opens a window', () => {
    const { e, onBarrage } = setup(40);
    e.player.startBlock();
    e.setPlayerMoveInput(0, 1);
    for (let t = 0; t < 1300; t += STEP_MS) e.step(STEP_MS);
    expect(e.boss!.windowsSeen).toBe(0);
    expect(onBarrage).not.toHaveBeenCalled();
  });

  it('a player not blocking never opens a window', () => {
    const { e } = setup(40);
    for (let t = 0; t < 1300; t += STEP_MS) e.step(STEP_MS);
    expect(e.boss!.windowsSeen).toBe(0);
  });

  it('real stepping: a blocking player gets a barrage after the first-attack delay, across boss attack patterns', () => {
    // Boss mode on the real elite; the brain is attached only once the first attack pattern has
    // started, so the window cannot come from the 2000 ms first-attack delay.
    const e = new Encounter(
      { x: 40, y: 0, width: 20, height: 20 },
      { x: 100, y: 0, width: 20, height: 20 },
    );
    e.assaltante.configureBoss({ maxHp: BOSS_CONFIG.bossMaxHp, advanceMult: 1, bodyScale: 1 });
    const starts: Array<{ t: number; kind: string }> = [];
    let t = 0;
    e.bus.on('enemy.attack_start', (ev) => starts.push({ t, kind: ev.kind }));
    const onBarrage = vi.fn((strikes: number) => e.assaltante.startBarrage(strikes, BOSS_CONFIG.barragePauseMs));
    const draw: Prng = { next: () => 0.1, nextInt: () => 0 }; // below the level-1 chance 0.5
    e.player.startBlock();
    for (; t < 10_000 && starts.length === 0; t += STEP_MS) e.step(STEP_MS);
    expect(starts.length).toBe(1);
    expect(t).toBeGreaterThanOrEqual(2000);
    e.boss = new BossBrain({ barrageLevel: 1, prng: draw, onBarrage });
    const attachedAt = t;
    let busyMs = 0;
    let firstBarrageAt: number | null = null;
    for (; t < attachedAt + 8000; t += STEP_MS) {
      const busy = e.assaltante.state !== 'idle' && e.assaltante.state !== 'chasing';
      e.step(STEP_MS);
      if (firstBarrageAt === null && onBarrage.mock.calls.length > 0) firstBarrageAt = t;
      if (firstBarrageAt === null && busy) busyMs += STEP_MS;
    }
    expect(e.player.isDead).toBe(false);
    expect(e.boss.windowsSeen).toBeGreaterThanOrEqual(1);
    expect(onBarrage).toHaveBeenCalled();
    expect(onBarrage.mock.calls[0][0]).toBe(4);
    expect(firstBarrageAt).not.toBeNull();
    // The window was built while the boss was attacking (the old rule reset it on every busy tick).
    expect(firstBarrageAt!).toBeGreaterThanOrEqual(attachedAt + BOSS_CONFIG.passiveWindowMs - STEP_MS);
    expect(busyMs).toBeGreaterThan(0);
    // The barrage started a swing after the regular pattern that was running at attach time.
    expect(starts.length).toBeGreaterThan(1);
  });

  it('no barrage on the tick the boss dies, even with the window completing then', () => {
    const { e, onBarrage } = setup(40);
    e.player.startBlock();
    for (let t = 0; t < 1184; t += STEP_MS) e.step(STEP_MS); // 74 steps: 1184 ms, one short of 1200
    expect(e.boss!.windowsSeen).toBe(0);
    e.assaltante.takeDamage(1e9);
    e.step(STEP_MS);
    expect(onBarrage).not.toHaveBeenCalled();
  });

  it('no barrage on the tick the player dies, even with the window completing then', () => {
    const { e, onBarrage } = setup(40);
    e.player.startBlock();
    for (let t = 0; t < 1184; t += STEP_MS) e.step(STEP_MS);
    expect(e.boss!.windowsSeen).toBe(0);
    e.player.takeDamage(1e9);
    e.step(STEP_MS);
    expect(onBarrage).not.toHaveBeenCalled();
  });

  it('runs without a boss', () => {
    const e = new Encounter({ x: 0, y: 0, width: 20, height: 20 }, { x: 100, y: 0, width: 20, height: 20 });
    expect(e.boss).toBeNull();
    expect(() => e.step(STEP_MS)).not.toThrow();
  });
});

describe('Encounter boss-room distances (centre-consistent anchor)', () => {
  /** Boss centred at (800, 600); player 20×20 whose centre is `dx` from it. One step, the distance the brain saw. */
  function distanceSeen(bodyScale: number | null, dx: number): { seen: number; e: Encounter } {
    const e = new Encounter(
      { x: 800 + dx - 10, y: 590, width: 20, height: 20 },
      { x: 790, y: 590, width: 20, height: 20 },
    );
    if (bodyScale !== null) e.assaltante.configureBoss({ maxHp: BOSS_CONFIG.bossMaxHp, advanceMult: 1, bodyScale });
    const views: number[] = [];
    e.boss = { step: (_ms: number, view: { distance: number }) => void views.push(view.distance) } as unknown as BossBrain;
    e.step(STEP_MS);
    return { seen: views[0], e };
  }

  it('ordinary enemy: distanceAnchor is exactly position and the distance is the old top-left one', () => {
    for (const dx of [-100, 100, 37.25]) {
      const { seen, e } = distanceSeen(null, dx);
      expect(e.assaltante.bodyScale).toBe(1);
      expect(e.assaltante.distanceAnchor).toEqual(e.assaltante.position);
      const p = e.assaltante.position;
      const q = e.player.position;
      expect(seen).toBe(Math.hypot(p.x - q.x, p.y - q.y)); // bit-identical to the pre-anchor formula
    }
  });

  it('boss at bodyScale 1.7: a player left or right of the boss centre is at the same distance (no direction bias)', () => {
    const left = distanceSeen(1.7, -100).seen;
    const right = distanceSeen(1.7, 100).seen;
    expect(left).toBeCloseTo(right, 9);
    // Top-left to top-left would have read ~7 px less on one side and ~7 px more on the other.
    const { e } = distanceSeen(1.7, 100);
    const tl = e.assaltante.position;
    const pp = e.player.position;
    expect(Math.abs(Math.hypot(tl.x - pp.x, tl.y - pp.y) - right)).toBeGreaterThan(5);
  });

  it('boss at bodyScale 1.7: item use measures dist_to_enemy from the centre anchor (symmetric)', () => {
    const dists: number[] = [];
    for (const dx of [-80, 80]) {
      const e = new Encounter({ x: 800 + dx - 10, y: 590, width: 20, height: 20 }, { x: 790, y: 590, width: 20, height: 20 });
      e.assaltante.configureBoss({ maxHp: BOSS_CONFIG.bossMaxHp, advanceMult: 1, bodyScale: 1.7 });
      (e.items as unknown as { slot: unknown }).slot = { id: 'item-t', kind: 'bomb', heldMs: 0 };
      e.bus.on('item.use', (ev) => dists.push(ev.dist_to_enemy));
      e.useItem();
    }
    expect(dists).toEqual([80, 80]);
  });
});

describe('Encounter boss-room near thresholds include the bigger body', () => {
  /** Boss centred at (800, 600); player centre `dx` to its right. Returns what the profile and the brain saw. */
  function seen(bodyScale: number | null, dx: number): { near: number; brain: number; anchorGap: number } {
    const records: Array<[string, number]> = [];
    const sink = { record: (s: string, n: number) => void records.push([s, n]) } as unknown as ConstructorParameters<typeof Encounter>[2];
    const e = new Encounter(
      { x: 800 + dx - 10, y: 590, width: 20, height: 20 },
      { x: 790, y: 590, width: 20, height: 20 },
      sink,
    );
    if (bodyScale !== null) e.assaltante.configureBoss({ maxHp: BOSS_CONFIG.bossMaxHp, advanceMult: 1, bodyScale });
    const views: number[] = [];
    e.boss = { step: (_ms: number, view: { distance: number }) => void views.push(view.distance) } as unknown as BossBrain;
    e.step(STEP_MS);
    const near = records.find(([s]) => s === 'distance');
    const a = e.assaltante.distanceAnchor;
    const q = e.player.position;
    // The boss may have moved during the step: the gap is read after it.
    return { near: near![1], brain: views[0], anchorGap: Math.hypot(a.x - q.x, a.y - q.y) };
  }

  it('ordinary enemy: near stays at ATTACK_REACH (45) and the brain sees the plain distance', () => {
    expect(seen(null, 44).near).toBeGreaterThan(0);
    expect(seen(null, 50).near).toBe(0);
  });

  it('boss at 1.7: a gap of 50 to the centre is near (reach 45 + 7 of the bigger body), 60 is not', () => {
    expect(seen(1.7, 50).near).toBeGreaterThan(0);
    expect(seen(1.7, 60).near).toBe(0);
  });

  it('boss at 1.7: the brain sees the distance minus the 7 px of the bigger body', () => {
    const r = seen(1.7, 100);
    expect(r.brain).toBeCloseTo(r.anchorGap - 7, 6);
    const plain = seen(null, 100);
    expect(plain.brain).toBeCloseTo(plain.anchorGap, 9); // no bonus for the ordinary enemy
  });
});
