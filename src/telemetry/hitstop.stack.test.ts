// src/telemetry/hitstop.stack.test.ts
import { describe, it, expect } from 'vitest';
import { makeBotStack, runBot } from './testing/scriptedBot';
import { rebuildProfile } from './replay';
import { metricsFromLog } from '../debug/analysis/metricsAggregator';
import { sessionStartPayload } from './schema';
import { STAMINA_COST } from '../combat/stamina';
import { INPUT_BUFFER_MS } from '../combat/actionDefs';
import { HITSTOP_COOLDOWN_STEPS } from '../combat/hitstop';

const STEP = 1000 / 60;
const INFO = sessionStartPayload('2026-10-29T00:00:00.000Z', true);

function started(sessionId = 's') {
  const { stack, runEnds } = makeBotStack({ sessionId });
  stack.startSession(INFO, null);
  return { stack, runEnds };
}

describe('TelemetryStack hit-stop, real flow', () => {
  it('the killing blow on the enemy keeps its 2-step freeze across the respawn, then everything resumes', () => {
    const { stack } = started();
    const { encounter, recorder } = stack;
    const px = encounter.player.position;
    encounter.respawnEnemy({ x: px.x + 30, y: px.y }, 'source_interrupted');
    encounter.assaltante.hp = 1;
    let died = false;
    encounter.bus.on('enemy.death', () => { died = true; });
    encounter.player.tryAction('sword_shield.light');
    let guard = 0;
    while (!died && guard++ < 60) stack.step(STEP);
    expect(died).toBe(true);
    expect(encounter.hitStop.active).toBe(true); // armed by the killing hit, kept by the respawn
    const t = recorder.nowMs;
    const enemy = { ...encounter.assaltante.position };
    const state = encounter.assaltante.state;
    stack.step(STEP);
    stack.step(STEP);
    expect(encounter.hitStop.active).toBe(false);
    expect(recorder.nowMs).toBe(t);
    expect(encounter.assaltante.position).toEqual(enemy);
    expect(encounter.assaltante.state).toBe(state);
    stack.step(STEP);
    expect(recorder.nowMs).toBeCloseTo(t + STEP);
  });

  it('a lethal hit on the player: after the step the freeze is cleared and the new run starts normally', () => {
    const { stack, runEnds } = started();
    const { encounter, recorder } = stack;
    const px = encounter.player.position;
    encounter.respawnEnemy({ x: px.x + 30, y: px.y }, 'source_interrupted');
    encounter.player.takeDamage(encounter.player.hp - 1);
    let hurt = false;
    encounter.bus.on('player.hurt', () => { hurt = true; });
    let guard = 0;
    while (runEnds.count === 0 && guard++ < 3000) stack.step(STEP);
    expect(hurt).toBe(true);
    expect(runEnds.count).toBe(1);
    expect(encounter.hitStop.active).toBe(false);
    const t = recorder.nowMs;
    stack.step(STEP);
    expect(recorder.nowMs).toBeCloseTo(t + STEP);
  });

  it('a bomb kill and a bow kill request no freeze', () => {
    const { stack } = started();
    const { encounter } = stack;
    encounter.bus.emit('enemy.hurt', { dmg: 30, hp_after: 0, actionId: 'item.bomb' });
    encounter.bus.emit('enemy.hurt', { dmg: 10, hp_after: 0, actionId: 'bow.shot' });
    expect(encounter.hitStop.active).toBe(false);
  });
});

describe('TelemetryStack hit-stop', () => {
  it('a frozen step advances neither the log time, the enemy, the player, the opportunities nor the stamina', () => {
    const { stack } = started();
    const { encounter, recorder } = stack;
    for (let i = 0; i < 20; i++) stack.step(STEP);
    encounter.player.stamina.spend(STAMINA_COST.dodge, 'dodge');
    const before = {
      t: recorder.nowMs,
      stamina: encounter.player.stamina.value,
      enemy: { ...encounter.assaltante.position },
      player: { ...encounter.player.position },
      state: encounter.assaltante.state,
      seq: recorder.drain().length,
    };
    encounter.hitStop.request(4);
    for (let i = 0; i < 4; i++) stack.step(STEP);
    expect(encounter.hitStop.active).toBe(false);
    expect(recorder.nowMs).toBe(before.t);
    expect(encounter.player.stamina.value).toBe(before.stamina);
    expect(encounter.assaltante.position).toEqual(before.enemy);
    expect(encounter.player.position).toEqual(before.player);
    expect(encounter.assaltante.state).toBe(before.state);
    expect(recorder.drain()).toHaveLength(0); // nothing is logged while frozen
    stack.step(STEP);
    expect(recorder.nowMs).toBeCloseTo(before.t + STEP);
  });

  it('after the last frozen step everything resumes exactly where it stopped: the log equals a run with no freeze', () => {
    const run = (freezeAt: number | null) => {
      const { stack } = started('eq');
      let steps = 0;
      for (let i = 0; i < 300; i++) {
        stack.step(STEP);
        steps++;
        if (freezeAt === i) {
          stack.encounter.hitStop.request(5);
          for (let k = 0; k < 5; k++) stack.step(STEP);
        }
      }
      return { log: stack.recorder.drain(), steps };
    };
    const control = run(null);
    const frozen = run(150);
    expect(frozen.log).toEqual(control.log);
    expect(frozen.log.length).toBeGreaterThan(5);
  });

  it('an open dodge opportunity does not expire during a freeze and keeps its remaining time', () => {
    const { stack } = started();
    const { encounter } = stack;
    const opens: number[] = [];
    const closes: string[] = [];
    encounter.bus.on('opp.open', (e) => { if (e.type === 'dodge') opens.push(e.opp_id as unknown as number); });
    encounter.bus.on('opp.close', (e) => { if (e.type === 'dodge') closes.push(e.outcome); });
    let guard = 0;
    while (opens.length === 0 && guard++ < 2000) stack.step(STEP);
    expect(opens).toHaveLength(1);
    const t0 = stack.recorder.nowMs;
    encounter.hitStop.request(5);
    for (let i = 0; i < 5; i++) stack.step(STEP);
    expect(closes).toHaveLength(0);
    expect(stack.recorder.nowMs).toBe(t0);
  });

  it('a buffered input does not age during a freeze', () => {
    const { stack } = started();
    const { encounter } = stack;
    const player = encounter.player;
    player.setAimDirection({ x: 1, y: 0 });
    player.tryAction('sword_shield.light');
    for (let i = 0; i < 10; i++) stack.step(STEP); // ~167 of the 200 ms lock: the attack is about to unlock
    const actions: string[] = [];
    encounter.bus.on('player.action', (e) => actions.push(e.actionId));
    player.tryAction('sword_shield.light'); // buffered behind the running attack
    // a freeze longer than the whole buffer window must not consume it
    const frozenSteps = Math.ceil((INPUT_BUFFER_MS * 2) / STEP);
    encounter.hitStop.request(frozenSteps);
    for (let i = 0; i < frozenSteps; i++) stack.step(STEP);
    expect(actions).toHaveLength(0);
    let guard = 0;
    while (actions.length === 0 && guard++ < Math.ceil(INPUT_BUFFER_MS / STEP)) stack.step(STEP);
    expect(actions).toEqual(['sword_shield.light']); // still alive when the attack finishes
  });

  it('the player dying during a freeze ends the run cleanly and nothing stays frozen', () => {
    const { stack, runEnds } = started();
    const { encounter } = stack;
    encounter.hitStop.request(5);
    stack.step(STEP);
    encounter.player.takeDamage(999);
    expect(encounter.hitStop.active).toBe(true);
    // the director only sees the death on a simulated step: the freeze drains first
    for (let i = 0; i < 6; i++) stack.step(STEP);
    expect(runEnds.count).toBe(1);
    expect(encounter.hitStop.active).toBe(false);
    const t = stack.recorder.nowMs;
    stack.step(STEP);
    expect(stack.recorder.nowMs).toBeCloseTo(t + STEP);
  });

  it('a lethal hit on the player that itself requests a freeze does not leave the new run frozen', () => {
    const { stack, runEnds } = started();
    const { encounter } = stack;
    encounter.player.takeDamage(999);
    encounter.bus.emit('player.hurt', { dmg: 999, hp_after: 0 }); // requests the freeze
    expect(encounter.hitStop.active).toBe(true);
    for (let i = 0; i < 5; i++) stack.step(STEP);
    expect(runEnds.count).toBe(1);
    expect(encounter.hitStop.active).toBe(false);
    // the cooldown was reset with the run: a fresh impact freezes immediately
    encounter.bus.emit('player.hurt', { dmg: 10, hp_after: 90 });
    expect(encounter.hitStop.active).toBe(true);
  });

  it('a freeze cannot survive a run boundary even with the cooldown pending', () => {
    const { stack } = started();
    const { encounter } = stack;
    encounter.hitStop.request(2);
    stack.step(STEP);
    stack.step(STEP); // cooldown now running
    encounter.player.takeDamage(999);
    stack.step(STEP); // death -> new run -> resetPlayer
    encounter.hitStop.request(3);
    expect(encounter.hitStop.active).toBe(true);
    expect(HITSTOP_COOLDOWN_STEPS).toBeGreaterThan(1);
  });

  it('live profile equals the rebuilt profile and the metrics hold in a bot run with hit-stop on', () => {
    const { stack } = started('bot');
    let frozen = 0;
    const original = stack.step.bind(stack);
    runBot({ ...stack, step: (ms: number) => { if (stack.encounter.hitStop.active) frozen++; original(ms); } } as typeof stack, 6000);
    expect(frozen).toBeGreaterThan(0);
    const log = stack.recorder.drain();
    const rebuilt = rebuildProfile(log, 'p');
    expect(rebuilt.snapshot('room.exit')).toEqual(stack.accumulator.snapshot('room.exit'));
    expect(metricsFromLog(log)).toBeTruthy();
  });
});
