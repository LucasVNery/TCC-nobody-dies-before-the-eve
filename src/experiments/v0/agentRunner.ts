// src/experiments/v0/agentRunner.ts
// Plays the synthetic agents through the real game stack, session by session (V0 plan, Task 5).
import { createPrng } from '../../core/prng';
import type { ProfileAccumulator } from '../../profile/profileAccumulator';
import { findAbandonedRun } from '../../telemetry/abandonedRun';
import { nextRunIdx, rebuildProfileWithStats } from '../../telemetry/replay';
import { GAME_VERSION, SCHEMA_VERSION, type LoggedEvent } from '../../telemetry/schema';
import { createTelemetryStack } from '../../telemetry/stack';
import { DEFAULT_HUMANIZER, Humanizer, type HumanizerConfig } from './humanizer';
import { PerceptionBuffer, observe } from './perception';
import { AgentPolicy, PERCEPTION_LAG_MS, type AgentIntent } from './policy';
import { AGENT_STYLES, STYLE_IDS, type StyleId } from './styles';

export interface ExperimentConfig {
  seed: number;
  agents: readonly StyleId[];
  runsPerAgent: number;
  runsPerSession: number;
  /** Simulated time cap per run: hitting it ends the session like a closed tab. */
  runCapMs: number;
  humanizer: HumanizerConfig;
  stepMs: number;
}

export const DEFAULT_EXPERIMENT: ExperimentConfig = {
  seed: 20261019,
  agents: STYLE_IDS,
  runsPerAgent: 30,
  runsPerSession: 10,
  runCapMs: 300_000,
  humanizer: DEFAULT_HUMANIZER,
  stepMs: 1000 / 60,
};

export interface AgentLog {
  styleId: StyleId;
  playerId: string;
  /** Every session's drained events, in session order. */
  events: LoggedEvent[];
  /** The live profile of the last session (rebuilt from the log at its start, then played on). */
  live: ProfileAccumulator;
  /** Runs ended by the agent's death. */
  completedRuns: number;
  /** Runs that hit runCapMs (left open; the next session, if any, closes them as abandoned). */
  truncatedRuns: number;
  simulatedMs: number;
  sessions: number;
}

/** Test/diagnostic hooks; not part of the experiment. */
export interface RunnerHooks {
  /** Called on every game nextSeed() call (one per run started by the director). */
  onNextSeed?: () => void;
}

/** Same hurtbox size the scene passes (visual/placeholderTextures ENTITY_SIZE; not imported: that module is Phaser-side). */
const ENTITY_SIZE = 20;

/** Stream tags, so the game seeds and the agent's streams never coincide. */
const STREAM_GAME = 1;
const STREAM_POLICY = 2;
const STREAM_HUMANIZER = 3;

/**
 * Integer mixing (murmur3-style fmix32 folded over the inputs): a fixed,
 * platform-independent 32-bit hash of a tuple of integers. Used to derive every
 * seed of the experiment from (cfg.seed, agentIndex, stream, n).
 */
export function mixSeed(...parts: readonly number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The game's seed for run `runIdx` of agent `agentIndex` (handed to the director's nextSeed). */
export function gameSeed(seed: number, agentIndex: number, runIdx: number): number {
  return mixSeed(seed, agentIndex, STREAM_GAME, runIdx);
}

/** Session n starts at 2026-01-01T00:00:n UTC: strictly increasing and deterministic (replay orders sessions by it). */
function sessionWallClock(n: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
}

/** Applies the intents in the order documented on AgentIntent. */
function applyIntent(player: ReturnType<typeof createTelemetryStack>['encounter']['player'], intent: AgentIntent): void {
  player.setMoveInput(intent.move.x, intent.move.y);
  player.setAimDirection(intent.aim);
  if (intent.switchTo) player.switchWeapon(intent.switchTo);
  if (intent.block === 'start') player.startBlock();
  else if (intent.block === 'stop') player.stopBlock();
  if (intent.dodge) player.tryDodge();
  if (intent.startAction) player.tryAction(intent.startAction);
  if (intent.release) player.releaseAction();
}

/**
 * One agent = one player (`agent-${styleId}`), playing `runsPerAgent` runs in
 * sessions of up to `runsPerSession` runs, exactly as the game boots:
 * every session rebuilds the profile from the accumulated log
 * (rebuildProfileWithStats), continues the run numbering (nextRunIdx) and
 * closes the run the previous session left open (findAbandonedRun ->
 * startSession). A run ends by the agent's death (through the game's own
 * RunDirector); a run that reaches `runCapMs` of simulated time ends the
 * session without run.end, like a closed tab. If that was the last session,
 * the run stays open in the log (counted in truncatedRuns; the analysis treats
 * it as abandoned).
 *
 * Note (real-game behaviour, mirrored): after a death the director starts the
 * next run at once, so a session that ends after its last death leaves an
 * empty run open; the next session closes it as abandoned (duration 0).
 *
 * Determinism: game seeds come from gameSeed(cfg.seed, agentIndex, runIdx);
 * the policy and humanizer get their own streams per session, so the agent's
 * decisions never consume the game's PRNG.
 */
export function playAgent(styleId: StyleId, cfg: ExperimentConfig, agentIndex: number, hooks: RunnerHooks = {}): AgentLog {
  const playerId = `agent-${styleId}`;
  const style = AGENT_STYLES[styleId];
  const history: LoggedEvent[] = [];
  let completedRuns = 0;
  let truncatedRuns = 0;
  let simulatedMs = 0;
  let sessions = 0;
  let live: ProfileAccumulator | null = null;

  while (completedRuns + truncatedRuns < cfg.runsPerAgent) {
    const n = sessions;
    const { accumulator } = rebuildProfileWithStats(history, playerId);
    const firstRunIdx = nextRunIdx(history, playerId);
    const abandoned = findAbandonedRun(history, playerId);
    let runIdx = firstRunIdx;
    let runEnded = false;
    const stack = createTelemetryStack({
      accumulator,
      playerId,
      sessionId: `${styleId}-s${n}`,
      firstRunIdx,
      nextSeed: () => {
        hooks.onNextSeed?.();
        return gameSeed(cfg.seed, agentIndex, runIdx++);
      },
      entitySize: ENTITY_SIZE,
      onRunEnd: () => {
        runEnded = true;
      },
    });
    stack.startSession(
      { wall_clock_iso: sessionWallClock(n), game_version: GAME_VERSION, schema_v: SCHEMA_VERSION, persistent: true },
      abandoned,
    );
    runEnded = false; // the abandoned closing above also fires onRunEnd

    const humanizer = new Humanizer(cfg.humanizer, createPrng(mixSeed(cfg.seed, agentIndex, STREAM_HUMANIZER, n)).next);
    const policy = new AgentPolicy(style, humanizer, createPrng(mixSeed(cfg.seed, agentIndex, STREAM_POLICY, n)).next);
    const buffer = new PerceptionBuffer();
    const { encounter, recorder } = stack;

    let runsThisSession = 0;
    let runStartMs = recorder.nowMs;
    while (runsThisSession < cfg.runsPerSession && completedRuns + truncatedRuns < cfg.runsPerAgent) {
      const t = recorder.nowMs;
      const now = observe(encounter, t);
      buffer.push(now);
      applyIntent(encounter.player, policy.decide({ now, seen: buffer.at(t, PERCEPTION_LAG_MS), nowMs: t }));
      stack.step(cfg.stepMs);
      if (runEnded) {
        runEnded = false;
        completedRuns++;
        runsThisSession++;
        runStartMs = recorder.nowMs;
      } else if (recorder.nowMs - runStartMs >= cfg.runCapMs) {
        truncatedRuns++;
        break; // tab closed mid-run: no run.end
      }
    }

    simulatedMs += recorder.nowMs;
    for (const e of recorder.drain()) history.push(e);
    live = accumulator;
    sessions++;
  }

  return {
    styleId,
    playerId,
    events: history,
    live: live ?? rebuildProfileWithStats(history, playerId).accumulator,
    completedRuns,
    truncatedRuns,
    simulatedMs,
    sessions,
  };
}

/** Every configured agent, in order (agentIndex = position in cfg.agents). */
export function runExperiment(cfg: ExperimentConfig): AgentLog[] {
  return cfg.agents.map((styleId, i) => playAgent(styleId, cfg, i));
}
