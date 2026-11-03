// tools/measure-volume.ts
// Measures the real event volume of the game's NDJSON log, using the synthetic agents (seed 4242 only),
// to fix the cloud batch size (spec 2026-11-03-supabase-design, section 7). Read-only: prints to stdout,
// writes nothing. Does NOT change what is logged.
//
//   npm run volume
import { DEFAULT_EXPERIMENT, playAgent, type AgentLog, type ExperimentConfig } from '../src/experiments/v0/agentRunner';
import { STYLE_IDS } from '../src/experiments/v0/styles';
import { BOSS_CONFIG_DEMO } from '../src/boss/bossConfig';

const SEED = 4242;
const RUNS = 3;
const BATCH = 500;
const enc = new TextEncoder();
const bytesOf = (s: string): number => enc.encode(s).length;

const CONFIGS: Record<string, ExperimentConfig> = {
  'no-boss (default)': { ...DEFAULT_EXPERIMENT, seed: SEED, runsPerAgent: RUNS, runsPerSession: RUNS },
  'boss room': {
    ...DEFAULT_EXPERIMENT,
    seed: SEED,
    runsPerAgent: RUNS,
    runsPerSession: RUNS,
    runCapMs: 120_000,
    boss: { config: BOSS_CONFIG_DEMO, afterEncounters: 1 },
  },
};

interface TypeStat { count: number; bytes: number }

function measure(log: AgentLog) {
  const sizes = log.events.map((e) => bytesOf(JSON.stringify(e)) + 1);
  const total = sizes.reduce((a, b) => a + b, 0);
  const byType = new Map<string, TypeStat>();
  log.events.forEach((e, i) => {
    const s = byType.get(e.type) ?? { count: 0, bytes: 0 };
    s.count++;
    s.bytes += sizes[i];
    byType.set(e.type, s);
  });
  const batches: number[] = [];
  for (let i = 0; i < sizes.length; i += BATCH) batches.push(sizes.slice(i, i + BATCH).reduce((a, b) => a + b, 0));
  return { n: sizes.length, total, byType, maxBatch: Math.max(0, ...batches), meanBatch: total / Math.max(1, batches.length) };
}

const top = (m: Map<string, TypeStat>, key: 'count' | 'bytes', n: number, tot: number): string =>
  [...m.entries()]
    .sort((a, b) => b[1][key] - a[1][key])
    .slice(0, n)
    .map(([t, s]) => `${t} ${((100 * s[key]) / tot).toFixed(1)}%`)
    .join(', ');

for (const [name, cfg] of Object.entries(CONFIGS)) {
  console.log(`\n## ${name} (seed ${SEED}, ${RUNS} runs/agent, cap ${cfg.runCapMs / 1000} s/run)\n`);
  console.log('| style | sim min | events | events/min | bytes/min | bytes/event | max 500-batch KB | mean batch KB |');
  console.log('|---|---|---|---|---|---|---|---|');
  let sumN = 0, sumB = 0, sumMs = 0, maxBatch = 0;
  const all = new Map<string, TypeStat>();
  const notes: string[] = [];
  for (const styleId of STYLE_IDS) {
    const log = playAgent(styleId, cfg, STYLE_IDS.indexOf(styleId));
    const m = measure(log);
    const min = log.simulatedMs / 60_000;
    sumN += m.n; sumB += m.total; sumMs += log.simulatedMs; maxBatch = Math.max(maxBatch, m.maxBatch);
    for (const [t, s] of m.byType) {
      const a = all.get(t) ?? { count: 0, bytes: 0 };
      a.count += s.count; a.bytes += s.bytes; all.set(t, a);
    }
    console.log(`| ${styleId} | ${min.toFixed(2)} | ${m.n} | ${(m.n / min).toFixed(0)} | ${(m.total / min).toFixed(0)} | ${(m.total / m.n).toFixed(0)} | ${(m.maxBatch / 1024).toFixed(1)} | ${(m.meanBatch / 1024).toFixed(1)} |`);
    notes.push(`- ${styleId}: top5 by count: ${top(m.byType, 'count', 5, m.n)}; top5 by bytes: ${top(m.byType, 'bytes', 5, m.total)}`);
  }
  const min = sumMs / 60_000;
  console.log(`| ALL | ${min.toFixed(2)} | ${sumN} | ${(sumN / min).toFixed(0)} | ${(sumB / min).toFixed(0)} | ${(sumB / sumN).toFixed(0)} | ${(maxBatch / 1024).toFixed(1)} | |`);
  console.log(`\n${notes.join('\n')}`);
  console.log(`- ALL: top5 by count: ${top(all, 'count', 5, sumN)}; top5 by bytes: ${top(all, 'bytes', 5, sumB)}`);
  console.log(`- KB per minute: ${(sumB / min / 1024).toFixed(1)}; MB per hour: ${((sumB / min) * 60 / 1048576).toFixed(2)}`);
}
