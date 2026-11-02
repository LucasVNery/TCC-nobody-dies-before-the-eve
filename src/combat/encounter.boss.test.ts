import { describe, it, expect, vi } from 'vitest';
import { Encounter } from './encounter';
import { BossBrain } from '../boss/bossBrain';
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
    expect(onBarrage.mock.calls[0][0]).toBe(5);
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

  it('runs without a boss', () => {
    const e = new Encounter({ x: 0, y: 0, width: 20, height: 20 }, { x: 100, y: 0, width: 20, height: 20 });
    expect(e.boss).toBeNull();
    expect(() => e.step(STEP_MS)).not.toThrow();
  });
});
