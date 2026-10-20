import { describe, it, expect } from 'vitest';
import { rebuildProfileWithStats, orderEvents } from '../../telemetry/replay';
import { WEAPON_IDS } from '../../combat/actionRegistry';
import type { LoggedEvent } from '../../telemetry/schema';
import { GAME_VERSION, SCHEMA_VERSION } from '../../telemetry/schema';
import { DEFAULT_HUMANIZER } from './humanizer';
import { STYLE_IDS } from './styles';
import { REPORT_SKILLS } from './windowValues';
import { DEFAULT_EXPERIMENT, gameSeed, playAgent, runExperiment, type ExperimentConfig } from './agentRunner';

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
      runsPerAgent: 30,
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
      expect(s.schema_v).toBe(SCHEMA_VERSION);
    }
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
