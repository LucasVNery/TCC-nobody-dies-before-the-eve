// tools/run-v0.ts
// Command line of the V0 experiment (synthetic agents; spec 2026-10-19-v0-agentes-sinteticos).
//
//   npx vite-node tools/run-v0.ts [--agents a,b,...] [--runs N] [--runs-per-session N]
//                                 [--cap-ms N] [--seed N] [--out DIR]
//                                 [--reviewed-before yes|no] [--smoke]
//
// This is the ONLY file of the experiment that touches node:fs / node:path, process.argv and
// the clock (report.ts and the rest of src/experiments/v0 are pure). tools/ is outside the
// tsconfig include (src only), so `process` is declared minimally below instead of pulling in
// @types/node; the node:* imports are resolved by vite-node at run time, not by `tsc`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_VERSION } from '../src/telemetry/schema';
import { createPrng } from '../src/core/prng';
import { DEFAULT_EXPERIMENT, mixSeed, runExperiment, type ExperimentConfig } from '../src/experiments/v0/agentRunner';
import { evaluateHypotheses, iccBySkill, prepareValues } from '../src/experiments/v0/evaluate';
import { checkAgentLog, type PipelineCheck } from '../src/experiments/v0/pipelineChecks';
import { buildReport } from '../src/experiments/v0/report';
import { STYLE_IDS, type StyleId } from '../src/experiments/v0/styles';

declare const process: { argv: string[]; exit(code?: number): never; exitCode?: number };

/** Smoke preset: tiny, different seed from the experiment's (20261019) so the real data is never touched. */
const SMOKE = { agents: ['agressivo', 'repetitivo'] as StyleId[], runs: 3, capMs: 60_000, seed: 4242 };
/** Stream constant of the analysis rng (bootstrap), distinct from the agents' and the game's streams. */
const STREAM_ANALYSIS = 0xa7a15;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function intArg(name: string, fallback: number): number {
  const v = arg(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`--${name} must be a positive integer (got "${v}")`);
    process.exit(2);
  }
  return n;
}

const smoke = flag('smoke');
const agentsArg = arg('agents');
const agents: StyleId[] = agentsArg ? (agentsArg.split(',').map((s) => s.trim()) as StyleId[]) : smoke ? SMOKE.agents : [...STYLE_IDS];
for (const a of agents) {
  if (!(STYLE_IDS as readonly string[]).includes(a)) {
    console.error(`unknown agent "${a}"; valid: ${STYLE_IDS.join(', ')}`);
    process.exit(2);
  }
}
const reviewed = arg('reviewed-before');
if (reviewed !== undefined && reviewed !== 'yes' && reviewed !== 'no') {
  console.error('--reviewed-before must be yes or no');
  process.exit(2);
}

const cfg: ExperimentConfig = {
  ...DEFAULT_EXPERIMENT,
  seed: intArg('seed', smoke ? SMOKE.seed : DEFAULT_EXPERIMENT.seed),
  agents,
  runsPerAgent: intArg('runs', smoke ? SMOKE.runs : DEFAULT_EXPERIMENT.runsPerAgent),
  runsPerSession: intArg('runs-per-session', DEFAULT_EXPERIMENT.runsPerSession),
  runCapMs: intArg('cap-ms', smoke ? SMOKE.capMs : DEFAULT_EXPERIMENT.runCapMs),
};

const started = Date.now();
const logs = runExperiment(cfg);
const { runValues, roomValues } = prepareValues(logs);
const prng = createPrng(mixSeed(cfg.seed, STREAM_ANALYSIS));
const rng = (): number => prng.next();
const hypotheses = evaluateHypotheses(runValues, rng);
const icc = iccBySkill(roomValues, rng);
const checks = {} as Record<StyleId, PipelineCheck[]>;
for (const log of logs) checks[log.styleId] = checkAgentLog(log);
const elapsedMs = Date.now() - started;

const files = buildReport({
  config: cfg,
  gameVersion: GAME_VERSION,
  generatedAtIso: new Date().toISOString(),
  elapsedMs,
  logs,
  runValues,
  roomValues,
  hypotheses,
  icc,
  checks,
  hypothesesReviewedBeforeFullRun: reviewed === undefined ? null : reviewed === 'yes',
});

const day = new Date().toISOString().slice(0, 10);
const outDir = arg('out') ?? join('experiments', 'v0', 'out', `${day}-seed${cfg.seed}${smoke ? '-smoke' : ''}`);
mkdirSync(outDir, { recursive: true });
for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text, 'utf8');

console.log(`V0 report written to ${outDir}`);
console.log(`elapsed: ${elapsedMs} ms = ${(elapsedMs / 1000).toFixed(2)} s (${agents.length} agents x ${cfg.runsPerAgent} runs, seed ${cfg.seed})`);

const failed: string[] = [];
for (const log of logs) for (const c of checks[log.styleId]) if (!c.ok) failed.push(`${log.styleId}: ${c.id} (${c.detail})`);
if (failed.length > 0) {
  console.error(`PIPELINE CHECKS FAILED:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
console.log('pipeline checks: all ok');
