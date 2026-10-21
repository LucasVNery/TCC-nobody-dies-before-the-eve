import { describe, it, expect } from 'vitest';
import { Encounter } from '../../combat/encounter';
import type { ProfileSink } from '../../profile/profileSink';
import { ProfileAccumulator } from '../../profile/profileAccumulator';
import { PerceptionBuffer, observe, type Observation } from './perception';

function obs(tMs: number, over: Partial<Observation> = {}): Observation {
  return {
    tMs,
    enemyState: 'idle',
    enemyPos: { x: 0, y: 0 },
    playerPos: { x: 1, y: 1 },
    playerHp: 100,
    playerStamina: 50,
    isBlocking: false,
    equippedWeaponId: 'sword_shield',
    enemyDead: false,
    ...over,
  };
}

describe('PerceptionBuffer', () => {
  function filled() {
    const b = new PerceptionBuffer();
    [0, 100, 200].forEach((t) => b.push(obs(t)));
    return b;
  }

  it('respects the delay', () => {
    const b = filled();
    expect(b.at(250, 100)?.tMs).toBe(100);
    expect(b.at(250, 0)?.tMs).toBe(200);
    expect(b.at(250, 300)).toBeNull();
  });

  it('drops observations older than capacityMs', () => {
    const b = new PerceptionBuffer(300);
    [0, 100, 200, 500].forEach((t) => b.push(obs(t)));
    expect(b.at(500, 450)).toBeNull();
    expect(b.at(500, 0)?.tMs).toBe(500);
    expect(b.at(500, 300)?.tMs).toBe(200);
  });

  it('keeps the last push for equal tMs and throws on a decreasing tMs', () => {
    const b = new PerceptionBuffer();
    b.push(obs(100, { playerHp: 1 }));
    b.push(obs(100, { playerHp: 2 }));
    expect(b.at(100, 0)?.playerHp).toBe(2);
    expect(() => b.push(obs(50))).toThrow();
  });

  it('shows a threat only once the delay has elapsed', () => {
    const b = new PerceptionBuffer();
    b.push(obs(900));
    b.push(obs(1000, { enemyState: 'attacking' }));
    expect(b.at(1200, 250)?.enemyState).toBe('idle');
    expect(b.at(1250, 250)?.enemyState).toBe('attacking');
  });
});

describe('observe', () => {
  const noop = {} as ProfileSink;
  it('returns only the player-visible fields', () => {
    const e = new Encounter<ProfileSink>(
      { x: 100, y: 100, width: 20, height: 20 },
      { x: 300, y: 100, width: 20, height: 20 },
      noop,
    );
    const o = observe(e, 1234);
    expect(Object.keys(o).sort()).toEqual(
      [
        'enemyDead',
        'enemyPos',
        'enemyState',
        'equippedWeaponId',
        'isBlocking',
        'playerHp',
        'playerStamina',
        'playerPos',
        'tMs',
      ].sort(),
    );
    expect(o).not.toHaveProperty('phaseElapsedMs');
    expect(o).not.toHaveProperty('activeRuleId');
    expect(o.tMs).toBe(1234);
    expect(o.playerHp).toBe(e.player.hp);
    expect(o.enemyPos).toEqual(e.assaltante.position);
  });

  it('is a snapshot: later encounter changes do not alter a stored observation', () => {
    const e = new Encounter<ProfileSink>(
      { x: 100, y: 100, width: 20, height: 20 },
      { x: 300, y: 100, width: 20, height: 20 },
      new ProfileAccumulator(),
    );
    const first = observe(e, 0);
    const snapshot = JSON.parse(JSON.stringify(first));
    e.setPlayerMoveInput(1, 0);
    for (let i = 0; i < 30; i++) e.step(1000 / 60);
    e.player.hp -= 10;
    e.assaltante.state = 'attacking';
    expect(first).toEqual(snapshot);
    const second = observe(e, 500);
    expect(second.playerPos).not.toEqual(first.playerPos);
    expect(second.enemyState).toBe('attacking');
    expect(second.playerPos).not.toBe(first.playerPos);
    expect(second.enemyPos).not.toBe(first.enemyPos);
  });
});
