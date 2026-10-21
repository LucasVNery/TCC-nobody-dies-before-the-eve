// src/telemetry/testing/scriptedBot.ts
import { ProfileAccumulator } from '../../profile/profileAccumulator';
import { findWeaponAction } from '../../combat/actionRegistry';
import { STAMINA_COST } from '../../combat/stamina';
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
 * Deterministic scripted player: chases the Assaltante, punishes its recoveries,
 * dodges its swings, alternates weapons. Works under the stamina rules (no refill). Only needs to be good enough to
 * produce kills, deaths, rooms and every profile write type — the coverage
 * assertions in the test guard that. If they fail, tune the cadences here;
 * never delete the assertions.
 */
export function runBot(stack: TelemetryStack, ticks: number) {
  const { encounter } = stack;
  let threatTicks = 0;
  for (let i = 0; i < ticks; i++) {
    const p = encounter.player.position;
    const e = encounter.assaltante.position;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    encounter.player.setAimDirection({ x: dx, y: dy });
    const far = Math.hypot(dx, dy) > 40;
    // With a free slot the bot detours to the nearest item on the ground, so pickups and uses reach the log.
    const target = encounter.items.held ? undefined : encounter.items.onMap[0];
    if (target) {
      encounter.setPlayerMoveInput(target.pos.x - p.x, target.pos.y - p.y);
    } else {
      encounter.setPlayerMoveInput(far ? dx : 0, far ? dy : 0);
    }
    if (i % 400 === 0) encounter.player.switchWeapon('sword_shield');
    if (i % 400 === 200) encounter.player.switchWeapon('heavy_weapon');
    // Stamina-aware, no refill. Dodge ~20 ticks (333 ms) into the enemy's swing telegraph, so the 150 ms
    // i-frames cover the hit (30 ticks into a lunge's), and only when the bar pays for it; light attacks go
    // out only in its recovery (the punish window) so the bar regenerates while it winds up.
    // Cadences were tuned empirically: dodging at the telegraph edge or at 16 ticks, or attacking while
    // it winds up, left the bot with ~0 kills (it died every ~8 s).
    const lunging = encounter.assaltante.state === 'lunging';
    const threat = lunging || encounter.assaltante.state === 'attacking';
    threatTicks = threat ? threatTicks + 1 : 0;
    if (threatTicks === (lunging ? 30 : 20) && encounter.player.stamina.value >= STAMINA_COST.dodge) encounter.player.tryDodge();
    if (i % 12 === 0 && encounter.assaltante.state === 'recovering' && encounter.player.stamina.value > 0) {
      const light = findWeaponAction(encounter.player.equippedWeaponId, 'light');
      if (light) encounter.player.tryAction(light.id);
    }
    // Use whatever it is holding now and then, so utility actions reach the log and the replay.
    if (encounter.items.held && i % 45 === 0) encounter.useItem();
    stack.step(1000 / 60);
  }
}
