// tools/calibrate-v0.ts
// Pilot calibration of the V0 agent styles (plan Task 6) against RAW BEHAVIOUR only.
//
//   npx vite-node tools/calibrate-v0.ts [--seed 1] [--runs 10] [--agents agressivo,evasivo]
//
// Anti-objective (spec §2): this script never computes a profile dimension, Cliff's delta,
// ICC, bootstrap interval or hypothesis verdict. It only counts what the agents did in the
// log (player.action, obs.defense, pos.sample, opp.close, enemy.*, run.*), so the styles
// are tuned on "does what its name says and produces enough data", never on separations.
// The pilot seed defaults to 1, different from the experiment seed (20261019), so the
// final experiment is not the calibration data.
import { ACTION_REGISTRY, WEAPON_IDS } from '../src/combat/actionRegistry';
import { metricsFromLog } from '../src/debug/analysis/metricsAggregator';
import type { LoggedEvent } from '../src/telemetry/schema';
import { DEFAULT_EXPERIMENT, playAgent, type AgentLog, type ExperimentConfig } from '../src/experiments/v0/agentRunner';
import { STYLE_IDS, type StyleId } from '../src/experiments/v0/styles';

declare const process: { argv: string[] };

/** Distance (px, top-left to top-left = centre to centre) at or below which the pair is "in melee": the enemy's attack range. */
const MELEE_PX = 60;
const ACTION_IDS = [...ACTION_REGISTRY.keys()];
const DEFENSE_LABELS = ['dodge', 'block', 'parry', 'retreat'] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface RunInfo {
  runIdx: number;
  cls: 'completed' | 'truncated';
  durationMs: number;
  rooms: number;
  maxActionGapMs: number;
}

export interface RawBehaviour {
  styleId: StyleId;
  completed: number;
  truncated: number;
  empty: number;
  meanRunS: number;
  medianRunS: number;
  minRunS: number;
  playedMin: number;
  actions: number;
  actionsPerMin: number;
  byAction: Record<string, number>;
  byWeapon: Record<string, number>;
  weaponChangesPerMin: number;
  defenses: Record<string, number>;
  meanDistM2: number | null;
  meanDistSamples: number;
  medianDist: number;
  meleeFrac: number;
  /** Mean distance over the samples where the enemy is attacking or recovering (the exchange itself, without spawn walk-ins). */
  engagedDist: number;
  attacksDuringEnemyAttack: number;
  enemyAttacksPerMin: number;
  dodgeOpp: Record<string, number>;
  punishOpp: Record<string, number>;
  roomsPerRun: number;
  kills: number;
  deaths: number;
  maxActionGapS: number;
  medianMaxActionGapS: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function rawBehaviour(log: AgentLog): RawBehaviour {
  const ev = log.events;
  const empty = new Set(log.emptyRuns);
  const deathRuns = new Set<number>();
  const startOf = new Map<number, LoggedEvent>();
  for (const e of ev) {
    if (e.type === 'run.start') startOf.set(e.run_idx, e);
    if (e.type === 'run.end' && e.cause === 'death') deathRuns.add(e.run_idx);
  }
  // events of a run in its own session (the abandoned run.end written by a later session is excluded)
  const inRun = (e: LoggedEvent): boolean => {
    const s = startOf.get(e.run_idx);
    return s !== undefined && !empty.has(e.run_idx) && e.session_id === s.session_id;
  };

  const runs = new Map<number, RunInfo>();
  const lastT = new Map<number, number>();
  const lastAction = new Map<number, number>();
  const rooms = new Map<number, Set<number>>();
  for (const [r, s] of startOf) {
    if (empty.has(r)) continue;
    runs.set(r, { runIdx: r, cls: deathRuns.has(r) ? 'completed' : 'truncated', durationMs: 0, rooms: 0, maxActionGapMs: 0 });
    lastT.set(r, s.t_ms);
    lastAction.set(r, s.t_ms);
    rooms.set(r, new Set());
  }

  const byAction: Record<string, number> = Object.fromEntries(ACTION_IDS.map((a) => [a, 0]));
  const byWeapon: Record<string, number> = Object.fromEntries(WEAPON_IDS.map((w) => [w, 0]));
  const defenses: Record<string, number> = Object.fromEntries(DEFENSE_LABELS.map((l) => [l, 0]));
  const dodgeOpp: Record<string, number> = { taken: 0, missed: 0, expired: 0, invalid: 0 };
  const punishOpp: Record<string, number> = { taken: 0, missed: 0, expired: 0, invalid: 0 };
  let actions = 0;
  let duringAttack = 0;
  let weaponChanges = 0;
  let prevWeapon: { run: number; w: string } | null = null;
  let enemyAttacks = 0;
  let kills = 0;
  let samples = 0;
  let distSum = 0;
  let melee = 0;
  const dists: number[] = [];
  let engagedSum = 0;
  let engagedN = 0;

  for (const e of ev) {
    if (!inRun(e)) continue;
    const r = e.run_idx;
    lastT.set(r, Math.max(lastT.get(r)!, e.t_ms));
    switch (e.type) {
      case 'room.enter':
        rooms.get(r)!.add(e.room_idx);
        break;
      case 'player.action': {
        actions++;
        const id = String(e.actionId);
        byAction[id] = (byAction[id] ?? 0) + 1;
        const w = String(e.weaponId);
        byWeapon[w] = (byWeapon[w] ?? 0) + 1;
        if (prevWeapon && prevWeapon.run === r && prevWeapon.w !== w) weaponChanges++;
        prevWeapon = { run: r, w };
        const ctx = e.ctx as { e_state?: string } | undefined;
        if (ctx?.e_state === 'attacking') duringAttack++;
        const info = runs.get(r)!;
        info.maxActionGapMs = Math.max(info.maxActionGapMs, e.t_ms - lastAction.get(r)!);
        lastAction.set(r, e.t_ms);
        break;
      }
      case 'obs.defense':
        defenses[String(e.label)] = (defenses[String(e.label)] ?? 0) + 1;
        break;
      case 'opp.close': {
        const tgt = e.opp_type === 'dodge' ? dodgeOpp : punishOpp;
        tgt[String(e.outcome)] = (tgt[String(e.outcome)] ?? 0) + 1;
        break;
      }
      case 'enemy.attack_start':
        enemyAttacks++;
        break;
      case 'enemy.death':
        kills++;
        break;
      case 'pos.sample': {
        const p = e.p as [number, number];
        const q = e.e as [number, number];
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        samples++;
        distSum += d;
        dists.push(d);
        if (d <= MELEE_PX) melee++;
        if (e.e_state === 'attacking' || e.e_state === 'recovering') {
          engagedSum += d;
          engagedN++;
        }
        break;
      }
    }
  }

  for (const [r, info] of runs) {
    info.durationMs = lastT.get(r)! - startOf.get(r)!.t_ms;
    info.rooms = rooms.get(r)!.size;
    // the stretch from the last action to the end of the run also counts as a gap
    info.maxActionGapMs = Math.max(info.maxActionGapMs, lastT.get(r)! - lastAction.get(r)!);
  }
  const list = [...runs.values()];
  const durs = list.map((x) => x.durationMs / 1000);
  const playedMin = durs.reduce((a, b) => a + b, 0) / 60;
  const perMin = (n: number) => (playedMin > 0 ? n / playedMin : 0);
  const m = metricsFromLog(ev);

  return {
    styleId: log.styleId,
    completed: log.completedRuns,
    truncated: log.truncatedRuns,
    empty: log.emptyRuns.length,
    meanRunS: durs.reduce((a, b) => a + b, 0) / Math.max(1, durs.length),
    medianRunS: median(durs),
    minRunS: Math.min(...durs),
    playedMin,
    actions,
    actionsPerMin: perMin(actions),
    byAction,
    byWeapon,
    weaponChangesPerMin: perMin(weaponChanges),
    defenses,
    meanDistM2: m.windows.history.meanDistance,
    meanDistSamples: samples > 0 ? distSum / samples : NaN,
    medianDist: median(dists),
    meleeFrac: samples > 0 ? melee / samples : NaN,
    engagedDist: engagedN > 0 ? engagedSum / engagedN : NaN,
    attacksDuringEnemyAttack: actions > 0 ? duringAttack / actions : NaN,
    enemyAttacksPerMin: perMin(enemyAttacks),
    dodgeOpp,
    punishOpp,
    roomsPerRun: list.reduce((a, x) => a + x.rooms, 0) / Math.max(1, list.length),
    kills,
    deaths: log.completedRuns,
    maxActionGapS: Math.max(...list.map((x) => x.maxActionGapMs)) / 1000,
    medianMaxActionGapS: median(list.map((x) => x.maxActionGapMs / 1000)),
  };
}

const f1 = (x: number | null) => (x === null || Number.isNaN(x) ? '—' : x.toFixed(1));
const pct = (x: number) => (Number.isNaN(x) ? '—' : `${(100 * x).toFixed(0)}%`);
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const oppCell = (o: Record<string, number>) => `${o.taken + o.missed + o.expired} valid, ${sum(o)} total (${o.taken}/${o.missed}/${o.expired}/${o.invalid})`;
const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;

function printTables(rows: RawBehaviour[]): void {
  console.log('### Runs, cadence, space, data\n');
  console.log(row(['style', 'compl', 'trunc', 'empty', 'mean run s', 'median run s', 'min run s', 'actions/min', 'weapon changes/min', 'M2 mean dist px', 'median dist px', 'mean dist while enemy attacks/recovers px', 'in melee (<=60px)', 'attacks w/ enemy attacking', 'enemy attacks/min', 'rooms/run', 'kills/death', 'max action gap s (median of runs)']));
  console.log(row(Array(18).fill('---')));
  for (const r of rows) {
    console.log(row([
      r.styleId, r.completed, r.truncated, r.empty, f1(r.meanRunS), f1(r.medianRunS), f1(r.minRunS),
      f1(r.actionsPerMin), f1(r.weaponChangesPerMin), f1(r.meanDistM2), f1(r.medianDist), f1(r.engagedDist), pct(r.meleeFrac),
      pct(r.attacksDuringEnemyAttack), f1(r.enemyAttacksPerMin), f1(r.roomsPerRun),
      r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : `${r.kills}/0`, `${f1(r.maxActionGapS)} (${f1(r.medianMaxActionGapS)})`,
    ]));
  }
  console.log('\n### Executed actions per minute by action id (share of executed actions)\n');
  console.log(row(['style', ...ACTION_IDS, 'max share']));
  console.log(row(Array(ACTION_IDS.length + 2).fill('---')));
  for (const r of rows) {
    const shares = ACTION_IDS.map((a) => (r.actions > 0 ? r.byAction[a] / r.actions : 0));
    console.log(row([
      r.styleId,
      ...ACTION_IDS.map((a, i) => `${f1(r.byAction[a] / Math.max(1e-9, r.playedMin))} (${pct(shares[i])})`),
      pct(Math.max(...shares)),
    ]));
  }
  console.log('\n### Executed actions per minute by weapon (share)\n');
  console.log(row(['style', ...WEAPON_IDS]));
  console.log(row(Array(WEAPON_IDS.length + 1).fill('---')));
  for (const r of rows) {
    console.log(row([r.styleId, ...WEAPON_IDS.map((w) => `${f1(r.byWeapon[w] / Math.max(1e-9, r.playedMin))} (${pct(r.actions > 0 ? r.byWeapon[w] / r.actions : 0)})`)]));
  }
  console.log('\n### obs.defense by label (count, share) and opportunities (valid = taken+missed+expired; invalid = out of range or interrupted)\n');
  console.log(row(['style', ...DEFENSE_LABELS, 'block+parry share', 'dodge opp (taken/missed/expired/invalid)', 'punish opp (taken/missed/expired/invalid)']));
  console.log(row(Array(DEFENSE_LABELS.length + 4).fill('---')));
  for (const r of rows) {
    const n = sum(r.defenses);
    console.log(row([
      r.styleId,
      ...DEFENSE_LABELS.map((l) => `${r.defenses[l]} (${pct(n > 0 ? r.defenses[l] / n : NaN)})`),
      pct(n > 0 ? (r.defenses.block + r.defenses.parry) / n : NaN),
      oppCell(r.dodgeOpp), oppCell(r.punishOpp),
    ]));
  }
}

function main(): void {
  const seed = Number(arg('seed') ?? 1);
  const runs = Number(arg('runs') ?? 10);
  const agents = (arg('agents')?.split(',') as StyleId[] | undefined) ?? STYLE_IDS;
  const cfg: ExperimentConfig = { ...DEFAULT_EXPERIMENT, seed, runsPerAgent: runs };
  const t0 = Date.now();
  const rows = agents.map((id) => rawBehaviour(playAgent(id, cfg, STYLE_IDS.indexOf(id))));
  console.log(`Pilot: seed ${seed}, ${runs} runs/agent, ${cfg.runsPerSession} runs/session, cap ${cfg.runCapMs / 1000} s, step ${cfg.stepMs.toFixed(2)} ms, wall ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
  printTables(rows);
}

main();
