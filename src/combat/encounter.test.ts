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
});
