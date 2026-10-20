// tools/run-v0.ts
// Command line of the V0 experiment (synthetic agents; spec 2026-10-19-v0-agentes-sinteticos).
//
//   npx vite-node tools/run-v0.ts [--agents a,b,...] [--runs N] [--runs-per-session N]
//                                 [--cap-ms N] [--seed N] [--out DIR] [--reviewed-before yes|no]
//                                 [--smoke] [--full] [--force]
//
// Argument parsing and validation are pure and tested (src/experiments/v0/cliArgs.ts). This is the
// ONLY file of the experiment that touches node:fs / node:path, process.argv and the clock
// (report.ts and the rest of src/experiments/v0 are pure). tools/ is outside the tsconfig include
// (src only), so `process` is declared minimally below instead of pulling in @types/node; the
// node:* imports are resolved by vite-node at run time, not by `tsc`.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_VERSION } from '../src/telemetry/schema';
import { createPrng } from '../src/core/prng';
import { DEFAULT_EXPERIMENT, mixSeed, runExperiment, type ExperimentConfig } from '../src/experiments/v0/agentRunner';
import { defaultOutName, parseCliArgs } from '../src/experiments/v0/cliArgs';
import { evaluateHypotheses, iccBySkill, prepareValues } from '../src/experiments/v0/evaluate';
import { checkAgentLog, type PipelineCheck } from '../src/experiments/v0/pipelineChecks';
import { buildReport } from '../src/experiments/v0/report';
import type { StyleId } from '../src/experiments/v0/styles';

declare const process: { argv: string[]; exit(code?: number): never };

/** Stream constant of the analysis rng (bootstrap), distinct from the agents' and the game's streams. */
const STREAM_ANALYSIS = 0xa7a15;

const parsed = parseCliArgs(process.argv.slice(2), {
  seed: DEFAULT_EXPERIMENT.seed,
  runs: DEFAULT_EXPERIMENT.runsPerAgent,
  runsPerSession: DEFAULT_EXPERIMENT.runsPerSession,
  capMs: DEFAULT_EXPERIMENT.runCapMs,
});
if (!parsed.ok) {
  console.error(`run-v0: invalid arguments\n  ${parsed.errors.join('\n  ')}`);
  process.exit(2);
}
const o = parsed.options;

const outDir = o.out ?? join('experiments', 'v0', 'out', defaultOutName(o.seed, o.smoke, new Date()));
if (!o.force && existsSync(outDir) && readdirSync(outDir).length > 0) {
  console.error(`run-v0: output folder "${outDir}" is not empty; use --force to overwrite or choose another --out`);
  process.exit(2);
}

const cfg: ExperimentConfig = {
  ...DEFAULT_EXPERIMENT,
  seed: o.seed,
  agents: o.agents,
  runsPerAgent: o.runs,
  runsPerSession: o.runsPerSession,
  runCapMs: o.capMs,
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
  hypothesesReviewedBeforeFullRun: o.reviewedBefore,
});

mkdirSync(outDir, { recursive: true });
for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text, 'utf8');

console.log(`V0 report written to ${outDir}`);
console.log(`elapsed: ${elapsedMs} ms (${o.agents.length} agents x ${cfg.runsPerAgent} runs, seed ${cfg.seed})`);

const failed: string[] = [];
for (const log of logs) for (const c of checks[log.styleId]) if (!c.ok) failed.push(`${log.styleId}: ${c.id} (${c.detail})`);
if (failed.length > 0) {
  console.error(`PIPELINE CHECKS FAILED:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
console.log('pipeline checks: all ok');
