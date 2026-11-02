// src/telemetry/stack.boss.test.ts
import { describe, it, expect } from 'vitest';
import { createTelemetryStack, type TelemetryStack } from './stack';
import { ProfileAccumulator } from '../profile/profileAccumulator';
import { makeBotStack, runBot } from './testing/scriptedBot';
import { GAME_VERSION, SCHEMA_VERSION, sessionStartPayload, type LoggedEvent } from './schema';

const STEP = 1000 / 60;
const INFO = sessionStartPayload('2026-11-02T00:00:00.000Z', true);

function ev(type: string, seq: number, extra: Record<string, unknown>, player = 'p', session = 'old'): LoggedEvent {
  return { v: SCHEMA_VERSION, seq, t_ms: seq, player_id: player, session_id: session, run_idx: 0, room_idx: 0, enc_idx: 0, type, ...extra };
}

function historyWithBossEntry(version = GAME_VERSION, player = 'p'): LoggedEvent[] {
  return [
    ev('session.start', 0, { ...INFO, game_version: version }, player),
    ev('profile.snapshot', 1, { at: 'boss.entry', partial: false }, player),
  ];
}

function build(opts: { sessionId?: string; history?: readonly LoggedEvent[]; boss?: { afterEncounters?: number } | null } = {}): TelemetryStack {
  let seed = 4242;
  return createTelemetryStack({
    accumulator: new ProfileAccumulator(),
    playerId: 'p',
    sessionId: opts.sessionId ?? 's',
    firstRunIdx: 0,
    nextSeed: () => seed++,
    entitySize: 20,
    ...(opts.history ? { history: opts.history } : {}),
    ...(opts.boss === null ? {} : { boss: opts.boss ?? {} }),
  });
}

/** Kills the enemy between steps until the boss.entry snapshot is logged. */
function playToBossEntry(stack: TelemetryStack): void {
  let entered = false;
  stack.encounter.bus.on('profile.snapshot', (e) => { if (e.snapshot.at === 'boss.entry') entered = true; });
  let guard = 0;
  while (!entered && guard++ < 200) {
    stack.encounter.assaltante.takeDamage(1e9);
    stack.step(STEP);
  }
  expect(entered).toBe(true);
}

describe('TelemetryStack boss wiring', () => {
  it('(a) history with a boss.entry snapshot of this version opens the gate before any step', () => {
    const stack = build({ history: historyWithBossEntry() });
    expect(stack.evidence?.facedBoss).toBe(true);
  });

  it('(b) another game version or another player leaves the gate closed', () => {
    expect(build({ history: historyWithBossEntry('0.0.1') }).evidence?.facedBoss).toBe(false);
    expect(build({ history: historyWithBossEntry(GAME_VERSION, 'other') }).evidence?.facedBoss).toBe(false);
  });

  it('(c) the gate persists across sessions through the drained log', () => {
    const first = build({ boss: { afterEncounters: 1 } });
    first.startSession(INFO, null);
    playToBossEntry(first);
    expect(first.evidence?.facedBoss).toBe(true);
    const drained = first.recorder.drain();
    const second = build({ sessionId: 's2', history: drained, boss: { afterEncounters: 1 } });
    expect(second.evidence?.facedBoss).toBe(true);
  });

  it('(d) without boss: no evidence, and the log is identical to a stack built without the new options', () => {
    const run = (stack: TelemetryStack) => {
      stack.startSession(INFO, null);
      runBot(stack, 600);
      return stack.recorder.drain();
    };
    const plain = makeBotStack({ seedStart: 4242 }).stack;
    const viaOpts = build({ boss: null, history: historyWithBossEntry() });
    expect(viaOpts.evidence).toBeNull();
    expect(run(viaOpts)).toEqual(run(plain));
  });

  it('(e) the first boss entry of a fresh player logs a neutral boss.entry snapshot and no boss.adapt', () => {
    const stack = build({ boss: { afterEncounters: 1 } });
    stack.startSession(INFO, null);
    playToBossEntry(stack);
    const log = stack.recorder.drain();
    const snap = log.find((e) => e.type === 'profile.snapshot' && e.at === 'boss.entry');
    expect(snap?.applied).toEqual({ dash_cooldown_ms: 2500, advance_mult: 1 });
    expect(log.some((e) => e.type === 'boss.adapt')).toBe(false);
  });
});
