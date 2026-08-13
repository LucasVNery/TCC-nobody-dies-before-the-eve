// src/combat/encounter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Encounter } from './encounter';
import { DODGE } from './actionDefs';

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

describe('Encounter', () => {
  it('a successful dodge resolves the dodge opportunity as taken, not expired', () => {
    const encounter = new Encounter(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
      30,
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    encounter.step(STEP_MS); // assaltante enters attacking, opens dodge opp
    expect(encounter.assaltante.state).toBe('attacking');

    // dodge just before the enemy's active swing lands
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
      30,
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    runFor(encounter, TELEGRAPH_MS + STEP_MS * 2);

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
      20,
    );
    const closeEvents: unknown[] = [];
    encounter.bus.on('opp.close', (e) => closeEvents.push(e));

    runFor(encounter, TELEGRAPH_MS + SWING_MS + STEP_MS); // enemy now recovering
    expect(encounter.assaltante.state).toBe('recovering');

    encounter.player.tryLightAttack();
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
        30,
      );
      const events: unknown[] = [];
      encounter.bus.on('opp.open', (e) => events.push(e));
      encounter.bus.on('opp.close', (e) => events.push(e));
      runFor(encounter, TELEGRAPH_MS + SWING_MS + 300);
      return events;
    }

    expect(scripted()).toEqual(scripted());
  });
});
