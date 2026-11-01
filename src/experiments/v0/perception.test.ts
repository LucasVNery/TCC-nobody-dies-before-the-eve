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
    runIdx: 0,
    telegraph: null,
    heldItem: null,
    groundItems: [],
    isSprinting: false,
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
    const o = observe(e, 1234, 7);
    expect(Object.keys(o).sort()).toEqual(
      [
        'enemyDead',
        'enemyPos',
        'enemyState',
        'equippedWeaponId',
        'groundItems',
        'heldItem',
        'isBlocking',
        'isSprinting',
        'playerHp',
        'playerStamina',
        'playerPos',
        'runIdx',
        'tMs',
        'telegraph',
      ].sort(),
    );
    expect(o).not.toHaveProperty('phaseElapsedMs');
    expect(o).not.toHaveProperty('activeRuleId');
    expect(o.tMs).toBe(1234);
    expect(o.runIdx).toBe(7);
    expect(o.playerHp).toBe(e.player.hp);
    expect(o.enemyPos).toEqual(e.assaltante.position);
  });

  it('is a snapshot: later encounter changes do not alter a stored observation', () => {
    const e = new Encounter<ProfileSink>(
      { x: 100, y: 100, width: 20, height: 20 },
      { x: 300, y: 100, width: 20, height: 20 },
      new ProfileAccumulator(),
    );
    const first = observe(e, 0, 0);
    const snapshot = JSON.parse(JSON.stringify(first));
    e.setPlayerMoveInput(1, 0);
    for (let i = 0; i < 30; i++) e.step(1000 / 60);
    e.player.hp -= 10;
    e.assaltante.state = 'attacking';
    expect(first).toEqual(snapshot);
    const second = observe(e, 500, 0);
    expect(second.playerPos).not.toEqual(first.playerPos);
    expect(second.enemyState).toBe('attacking');
    expect(second.playerPos).not.toBe(first.playerPos);
    expect(second.enemyPos).not.toBe(first.enemyPos);
  });
});

describe('observe: telegraph, items, sprint', () => {
  const mk = () =>
    new Encounter<ProfileSink>(
      { x: 100, y: 100, width: 20, height: 20 },
      { x: 300, y: 100, width: 20, height: 20 },
      new ProfileAccumulator(),
    );
  const spy = <T,>(obj: object, prop: string, value: T) =>
    Object.defineProperty(obj, prop, { get: () => value, configurable: true });

  it('copies the telegraph (hit only on the combo) and is null outside it', () => {
    const e = mk();
    expect(observe(e, 0, 0).telegraph).toBeNull();
    spy(e.assaltante, 'telegraph', { kind: 'slam', progress: 0.4, origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, reach: 1, halfAngleRad: 1 });
    const t1 = observe(e, 0, 0).telegraph;
    expect(t1).toEqual({ kind: 'slam', progress: 0.4 });
    expect(t1).not.toHaveProperty('hit');
    spy(e.assaltante, 'telegraph', { kind: 'combo', progress: 0.1, hit: 2, origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, reach: 1, halfAngleRad: 1 });
    expect(observe(e, 0, 0).telegraph).toEqual({ kind: 'combo', progress: 0.1, hit: 2 });
  });

  it('reads the held item, copies ground items and the sprint flag', () => {
    const e = mk();
    expect(observe(e, 0, 0).heldItem).toBeNull();
    expect(observe(e, 0, 0).isSprinting).toBe(false);
    const ground = [{ id: 'a', kind: 'bomb' as const, pos: { x: 5, y: 6 }, ageMs: 0 }];
    spy(e.items, 'onMap', ground);
    spy(e.items, 'held', 'heal');
    spy(e.player, 'isSprinting', true);
    const o = observe(e, 0, 0);
    expect(o.heldItem).toBe('heal');
    expect(o.isSprinting).toBe(true);
    expect(o.groundItems).toEqual([{ kind: 'bomb', pos: { x: 5, y: 6 } }]);
    (o.groundItems as unknown as { pos: { x: number } }[])[0].pos.x = 99;
    expect(ground[0].pos.x).toBe(5);
  });
});
