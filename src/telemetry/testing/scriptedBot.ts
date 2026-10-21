// src/telemetry/testing/scriptedBot.ts
import { ProfileAccumulator } from '../../profile/profileAccumulator';
import { findWeaponAction } from '../../combat/actionRegistry';
import { createTelemetryStack, type TelemetryStack } from '../stack';

export interface BotStackOptions {
  sessionId?: string;
  firstRunIdx?: number;
  seedStart?: number;
  accumulator?: ProfileAccumulator;
}

/** Telemetry stack for scripted-bot tests. Does NOT start a session or the director. */
export function makeBotStack(opts: BotStackOptions = {}) {
  let seed = opts.seedStart ?? 7;
  const runEnds = { count: 0 };
  const stack = createTelemetryStack({
    accumulator: opts.accumulator ?? new ProfileAccumulator(),
    playerId: 'p',
    sessionId: opts.sessionId ?? 's',
    firstRunIdx: opts.firstRunIdx ?? 0,
    nextSeed: () => seed++,
    entitySize: 20,
    onRunEnd: () => { runEnds.count += 1; },
  });
  return { stack, runEnds };
}

/**
 * Deterministic scripted player: chases the Assaltante, attacks on a cadence,
 * dodges now and then, alternates weapons. Only needs to be good enough to
 * produce kills, deaths, rooms and every profile write type — the coverage
 * assertions in the test guard that. If they fail, tune the cadences here;
 * never delete the assertions.
 */
export function runBot(stack: TelemetryStack, ticks: number) {
  const { encounter } = stack;
  for (let i = 0; i < ticks; i++) {
    // Fixture, not a skill model: keep the bot out of exhaustion so it still produces kills, deaths,
    // rooms and every profile write type now that actions cost stamina.
    encounter.player.stamina.refund(100);
    const p = encounter.player.position;
    const e = encounter.assaltante.position;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    encounter.player.setAimDirection({ x: dx, y: dy });
    const far = Math.hypot(dx, dy) > 40;
    encounter.setPlayerMoveInput(far ? dx : 0, far ? dy : 0);
    if (i % 400 === 0) encounter.player.switchWeapon('sword_shield');
    if (i % 400 === 200) encounter.player.switchWeapon('heavy_weapon');
    if (i % 36 === 0) {
      const light = findWeaponAction(encounter.player.equippedWeaponId, 'light');
      if (light) encounter.player.tryAction(light.id);
    }
    // Dodge cadence (i % 20) is deliberately loose: it leaves margin above the `runEnds >= 2` guard
    // while still covering obs.defense via dodge. i % 10 sat exactly on that threshold.
    if (encounter.assaltante.state === 'attacking' && i % 20 === 0) encounter.player.tryDodge();
    stack.step(1000 / 60);
  }
}
