import { describe, it, expect } from 'vitest';
import { rebuildProfileWithStats, orderEvents } from '../../telemetry/replay';
import { WEAPON_IDS } from '../../combat/actionRegistry';
import type { LoggedEvent } from '../../telemetry/schema';
import { GAME_VERSION, SCHEMA_VERSION, CONFIG_VERSION, windowsMs } from '../../telemetry/schema';
import { DEFAULT_HUMANIZER, Humanizer } from './humanizer';
import { AgentPolicy, PERCEPTION_LAG_MS } from './policy';
import { PerceptionBuffer, observe } from './perception';
import { AGENT_STYLES } from './styles';
import { createPrng } from '../../core/prng';
import { STYLE_IDS } from './styles';
import { REPORT_SKILLS } from './windowValues';
import { DEFAULT_EXPERIMENT, applyIntent, gameSeed, playAgent, runExperiment, type ExperimentConfig } from './agentRunner';
import { createTelemetryStack } from '../../telemetry/stack';
import { sessionStartPayload } from '../../telemetry/schema';
import { ProfileAccumulator } from '../../profile/profileAccumulator';

const tiny = (over: Partial<ExperimentConfig> = {}): ExperimentConfig => ({
  ...DEFAULT_EXPERIMENT,
  seed: 4242,
  runsPerAgent: 2,
  runsPerSession: 2,
  runCapMs: 20_000,
  ...over,
});

const ofType = (events: readonly LoggedEvent[], type: string) => events.filter((e) => e.type === type);

describe('DEFAULT_EXPERIMENT', () => {
  it('holds the global constants of the plan', () => {
    expect(DEFAULT_EXPERIMENT).toEqual({
      seed: 20261019,
      agents: STYLE_IDS,
      runsPerAgent: 60,
      runsPerSession: 10,
      runCapMs: 300_000,
      humanizer: DEFAULT_HUMANIZER,
      stepMs: 1000 / 60,
    });
  });
});

describe('agent runner', () => {
  it('same config twice gives identical logs', () => {
    const cfg = tiny({ agents: ['repetitivo', 'agressivo'] });
    const a = runExperiment(cfg);
    const b = runExperiment(cfg);
    expect(a).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      expect(a[i].events.length).toBeGreaterThan(0);
      expect(a[i].events).toEqual(b[i].events);
      expect([a[i].completedRuns, a[i].truncatedRuns, a[i].simulatedMs, a[i].sessions]).toEqual([
        b[i].completedRuns,
        b[i].truncatedRuns,
        b[i].simulatedMs,
        b[i].sessions,
      ]);
      expect(a[i].live.snapshot('room.exit')).toEqual(b[i].live.snapshot('room.exit'));
    }
  });

  it('a different seed gives a different log', () => {
    const a = playAgent('agressivo', tiny(), 0);
    const b = playAgent('agressivo', tiny({ seed: 7 }), 0);
    expect(a.events).not.toEqual(b.events);
  });

  it('session wall_clock_iso is strictly increasing and deterministic', () => {
    const log = playAgent('repetitivo', tiny({ runsPerAgent: 3, runsPerSession: 1 }), 0);
    const isos = ofType(log.events, 'session.start').map((e) => e.wall_clock_iso as string);
    expect(isos.length).toBe(log.sessions);
    expect(isos.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < isos.length; i++) expect(isos[i] > isos[i - 1]).toBe(true);
    expect(isos[0]).toBe(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString());
  });

  it('a run that hits the cap is truncated and the next session closes it as abandoned', () => {
    const log = playAgent('evasivo', tiny({ runCapMs: 3000, runsPerAgent: 3, runsPerSession: 3 }), 0);
    expect(log.truncatedRuns).toBeGreaterThanOrEqual(1);
    expect(log.completedRuns + log.truncatedRuns).toBe(3);
    const ends = ofType(log.events, 'run.end');
    const abandoned = ends.filter((e) => e.cause === 'abandoned');
    expect(abandoned.length).toBeGreaterThanOrEqual(1);
    expect(ofType(log.events, 'run.start').length).toBeGreaterThanOrEqual(ends.length);
    // every abandoned closing is logged by a later session than its run.start, under the run's own index
    for (const end of abandoned) {
      const start = log.events.find((e) => e.type === 'run.start' && e.run_idx === end.run_idx)!;
      expect(start.session_id).not.toBe(end.session_id);
      expect(end.duration_ms as number).toBeGreaterThanOrEqual(3000 - 20);
    }
    // a truncated run is never closed twice and never ended by death
    const endsByRun = new Map<number, number>();
    for (const e of ends) endsByRun.set(e.run_idx, (endsByRun.get(e.run_idx) ?? 0) + 1);
    for (const n of endsByRun.values()) expect(n).toBe(1);
    // per session: contiguous seq from 0 and t_ms restarting at session.start
    const bySession = new Map<string, LoggedEvent[]>();
    for (const e of log.events) {
      const list = bySession.get(e.session_id) ?? [];
      list.push(e);
      bySession.set(e.session_id, list);
    }
    expect(bySession.size).toBe(log.sessions);
    for (const list of bySession.values()) {
      expect(list.map((e) => e.seq)).toEqual(list.map((_, i) => i));
      expect(list[0].type).toBe('session.start');
      expect(list[0].t_ms).toBe(0);
    }
  });

  it('agent profile is rebuilt per session and keeps accumulating', () => {
    const log = playAgent('agressivo', tiny({ runsPerAgent: 3, runsPerSession: 1, runCapMs: 15_000 }), 0);
    expect(log.sessions).toBeGreaterThanOrEqual(2);
    const replay = rebuildProfileWithStats(log.events, log.playerId);
    expect(replay.skipped).toBe(0);
    const full = replay.accumulator;
    expect(log.live.snapshot('room.exit')).toEqual(full.snapshot('room.exit'));
    for (const skill of REPORT_SKILLS) {
      for (const clock of ['trait', 'state'] as const) {
        expect([log.live.domain(skill, clock), log.live.confidence(skill, clock), log.live.sampleSize(skill, clock)]).toEqual([
          full.domain(skill, clock),
          full.confidence(skill, clock),
          full.sampleSize(skill, clock),
        ]);
      }
    }
    // the profile keeps accumulating across sessions: the last session starts with evidence from the earlier ones
    expect(REPORT_SKILLS.some((s) => full.sampleSize(s, 'trait') > 0)).toBe(true);
    // run numbering continues across sessions
    const runIdx = ofType(orderEvents(log.events), 'run.start').map((e) => e.run_idx);
    expect(runIdx).toEqual(runIdx.map((_, i) => i));
  });

  it('repetitivo only produces sword_shield.light actions and no weapon switch', () => {
    const log = playAgent('repetitivo', tiny({ runCapMs: 30_000 }), 0);
    const actions = ofType(log.events, 'player.action');
    // seed 4242 gives 20 actions (other seeds 12-25); the stamina-blind policy managed only ~10
    expect(actions.length).toBeGreaterThan(10);
    for (const a of actions) {
      expect(a.actionId).toBe('sword_shield.light');
      expect(a.weaponId).toBe('sword_shield');
    }
  });

  it('variado produces actions of every registered weapon', () => {
    const log = playAgent('variado', tiny({ runCapMs: 60_000, runsPerAgent: 3 }), 0);
    const weapons = new Set(ofType(log.events, 'player.action').map((e) => e.weaponId));
    expect([...weapons].sort()).toEqual([...WEAPON_IDS].sort());
  });

  it('player ids and session ids follow the convention', () => {
    const log = playAgent('bloqueador', tiny({ runsPerAgent: 2, runsPerSession: 1, runCapMs: 5000 }), 3);
    expect(log.styleId).toBe('bloqueador');
    expect(log.playerId).toBe('agent-bloqueador');
    for (const e of log.events) expect(e.player_id).toBe('agent-bloqueador');
    const starts = ofType(log.events, 'session.start');
    expect(starts.map((e) => e.session_id)).toEqual(starts.map((_, n) => `bloqueador-s${n}`));
    for (const s of starts) {
      expect(s.game_version).toBe(GAME_VERSION);
      expect(s.config_version).toBe(CONFIG_VERSION);
      expect(s.windows_ms).toEqual(windowsMs());
      expect(s.schema_v).toBe(SCHEMA_VERSION);
    }
  });

  describe('stamina limits (Task 9)', () => {
    // 60 runs (the default count) of up to 60 s, seed 4242. Measured simulated time per style against the 160 HP elite:
    // agressivo 735 s (the lowest: it dies in ~12 s per run), repetitivo 850 s, aleatorio 1093 s, variado 1229 s,
    // paciente 1681 s, bloqueador 2776 s, evasivo 3319 s. All clear the 600 s bar; 150 runs were not needed.
    const long = tiny({ runsPerAgent: 60, runsPerSession: 10, runCapMs: 60_000 });
    const logs = runExperiment(long);

    it.each(STYLE_IDS.map((id, i) => [id, i] as const))('%s: 600 s+ of play with no player.stamina_denied and >= 2 completed runs', (id, i) => {
      const log = logs[i];
      expect(log.styleId).toBe(id);
      expect(log.simulatedMs).toBeGreaterThanOrEqual(600_000);
      expect(ofType(log.events, 'player.stamina_denied')).toHaveLength(0);
      expect(log.completedRuns).toBeGreaterThanOrEqual(2);
      expect(ofType(log.events, 'player.action').length).toBeGreaterThan(0);
    });

    it('AgentLog is deterministic: same seed, same log', () => {
      const again = runExperiment(long);
      for (let i = 0; i < logs.length; i++) {
        expect(again[i].events).toEqual(logs[i].events);
        expect([again[i].completedRuns, again[i].truncatedRuns, again[i].emptyRuns, again[i].simulatedMs]).toEqual([
          logs[i].completedRuns,
          logs[i].truncatedRuns,
          logs[i].emptyRuns,
          logs[i].simulatedMs,
        ]);
      }
    });
  });

  describe('run classes: completed, truncated, empty', () => {
    const noEvidence = (events: readonly LoggedEvent[]) => {
      const withEvidence = new Set(
        events.filter((e) => e.type.startsWith('obs.') && e.type !== 'obs.boundary').map((e) => e.run_idx),
      );
      return [...new Set(ofType(events, 'run.start').map((e) => e.run_idx))]
        .filter((r) => !withEvidence.has(r))
        .sort((a, b) => a - b);
    };
    const check = (log: ReturnType<typeof playAgent>) => {
      expect(ofType(log.events, 'run.start').length).toBe(log.completedRuns + log.truncatedRuns + log.emptyRuns.length);
      expect(log.emptyRuns).toEqual(noEvidence(log.events));
      expect(log.completedRuns).toBe(ofType(log.events, 'run.end').filter((e) => e.cause === 'death').length);
      for (const r of log.emptyRuns) {
        expect(log.events.some((e) => e.type === 'run.end' && e.run_idx === r && e.cause === 'death')).toBe(false);
      }
    };

    it('multi-session: run.start count = completed + truncated + empty, and empty = no evidence', () => {
      const logs = runExperiment(tiny({ agents: ['agressivo', 'repetitivo'], runsPerAgent: 4, runsPerSession: 2, runCapMs: 60_000 }));
      for (const log of logs) {
        check(log);
        expect(log.emptyRuns.length).toBeGreaterThan(0);
        expect([...log.emptyRuns].sort((a, b) => a - b)).toEqual(log.emptyRuns);
      }
    });

    it('a capped agent has truncated runs and consistent empty runs', () => {
      const log = playAgent('evasivo', tiny({ runsPerAgent: 3, runsPerSession: 2, runCapMs: 2000 }), 1);
      expect(log.truncatedRuns).toBeGreaterThan(0);
      check(log);
    });
  });

  it('a subset of agents reproduces the same log per style (agentIndex = position in STYLE_IDS)', () => {
    const cfg = tiny({ runsPerAgent: 1, runCapMs: 10_000 });
    const all = runExperiment({ ...cfg, agents: STYLE_IDS });
    const alone = runExperiment({ ...cfg, agents: ['variado'] });
    expect(alone[0].events).toEqual(all[STYLE_IDS.indexOf('variado')].events);
  });

  it('does not touch the game PRNG: nextSeed is called once per run, seeds derive from (seed, agent, run)', () => {
    let calls = 0;
    const cfg = tiny({ runsPerAgent: 3, runsPerSession: 2, runCapMs: 8000 });
    const log = playAgent('aleatorio', cfg, 2, { onNextSeed: () => calls++ });
    const starts = ofType(log.events, 'run.start');
    expect(calls).toBe(starts.length);
    for (const s of starts) expect(s.seed).toBe(gameSeed(cfg.seed, 2, s.run_idx));
    // game seeds are per (seed, agent, run): agents never share a stream
    expect(gameSeed(cfg.seed, 2, 0)).not.toBe(gameSeed(cfg.seed, 3, 0));
    expect(gameSeed(cfg.seed, 2, 0)).not.toBe(gameSeed(cfg.seed, 2, 1));
  });
});

describe('applyIntent: sprint and item', () => {
  const stack = () =>
    createTelemetryStack({
      accumulator: new ProfileAccumulator(),
      playerId: 'agent-test',
      sessionId: 's0',
      firstRunIdx: 0,
      nextSeed: () => 4242,
      entitySize: 20,
      onRunEnd: () => {},
    });
  const aim = { x: 1, y: 0 };

  it('sprint with movement leaves the player sprinting', () => {
    const s = stack();
    s.startSession(sessionStartPayload('2026-01-01T00:00:00.000Z', true), null);
    applyIntent(s.encounter, { move: { x: 1, y: 0 }, aim, sprint: true });
    for (let i = 0; i < 10; i++) s.step(1000 / 60);
    applyIntent(s.encounter, { move: { x: 1, y: 0 }, aim, sprint: true });
    expect(s.encounter.player.isSprinting).toBe(true);
    applyIntent(s.encounter, { move: { x: 1, y: 0 }, aim });
    s.step(1000 / 60);
    expect(s.encounter.player.isSprinting).toBe(false);
  });

  it('useItem with an item in the slot emits item.use', () => {
    const s = stack();
    s.startSession(sessionStartPayload('2026-01-01T00:00:00.000Z', true), null);
    const items = s.encounter.items as unknown as { slot: unknown };
    items.slot = { id: 'i1', kind: 'heal', heldMs: 0 };
    applyIntent(s.encounter, { move: { x: 0, y: 0 }, aim, useItem: true });
    s.step(1000 / 60);
    expect(s.encounter.items.held).toBeNull();
    expect(ofType(s.recorder.drain(), 'item.use')).toHaveLength(1);
  });
});

describe('agents and items, end to end (V0.1 Task 4)', () => {
  const cfg = tiny({ runsPerAgent: 10, runsPerSession: 10, runCapMs: 120_000 });
  const itemEvents = (events: readonly LoggedEvent[]) => events.filter((e) => e.type === 'item.pickup' || e.type === 'item.use');

  it('an agent that seeks items picks them up and uses them in the real game, deterministically by seed', () => {
    const a = playAgent('evasivo', cfg, 1);
    expect(ofType(a.events, 'item.pickup').length).toBeGreaterThan(0);
    expect(ofType(a.events, 'item.use').length).toBeGreaterThan(0);
    expect(itemEvents(playAgent('evasivo', cfg, 1).events)).toEqual(itemEvents(a.events));
  }, 120_000);

  it('a heal in the middle of a run is not read as a restart (real stack and policy)', () => {
    const s = createTelemetryStack({
      accumulator: new ProfileAccumulator(),
      playerId: 'agent-test',
      sessionId: 's0',
      firstRunIdx: 0,
      nextSeed: () => 4242,
      entitySize: 20,
      onRunEnd: () => {},
    });
    s.startSession(sessionStartPayload('2026-01-01T00:00:00.000Z', true), null);
    const policy = new AgentPolicy(AGENT_STYLES.evasivo, new Humanizer({ ...DEFAULT_HUMANIZER, lapseProb: 0 }, createPrng(1).next), createPrng(2).next);
    const buffer = new PerceptionBuffer();
    const priv = policy as unknown as { lockedUntil: number; pending: unknown[] };
    (s.encounter.items as unknown as { slot: unknown }).slot = { id: 'i1', kind: 'heal', heldMs: 0 };
    s.encounter.player.hp = 40;
    let used = false;
    for (let i = 0; i < 240 && !used; i++) {
      const t = s.recorder.nowMs;
      const now = observe(s.encounter, t, s.director.runIdx);
      buffer.push(now);
      const intent = policy.decide({ now, seen: buffer.at(t, PERCEPTION_LAG_MS), nowMs: t });
      used = intent.useItem === true;
      applyIntent(s.encounter, intent);
      s.step(1000 / 60);
    }
    expect(used).toBe(true);
    expect(s.encounter.player.hp).toBeGreaterThan(40);
    expect(s.director.runIdx).toBe(0);
    priv.lockedUntil = 1e9; // a marker a restart would clear (set now: it would block the use itself)
    // one more tick with the raised HP: the policy sees a heal, not a new run
    const t = s.recorder.nowMs;
    policy.decide({ now: observe(s.encounter, t, s.director.runIdx), seen: buffer.at(t, PERCEPTION_LAG_MS), nowMs: t });
    expect(priv.lockedUntil).toBe(1e9);
    const events = s.recorder.drain();
    expect(ofType(events, 'run.start')).toHaveLength(1);
    expect(ofType(events, 'item.use')).toHaveLength(1);
  });
});

