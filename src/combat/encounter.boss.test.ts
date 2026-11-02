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
    e.assaltante.configureBoss({ maxHp: BOSS_CONFIG.bossMaxHp, advanceMult: 1 });
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
