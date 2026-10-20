// src/experiments/v0/cliArgs.ts
// Pure parsing and validation of the V0 command line (no node:*, no process, no clock).
// tools/run-v0.ts is the only caller; it does the I/O. Guards against an accidental full run
// (the pre-registered seed) and against malformed arguments.
import { STYLE_IDS, type StyleId } from './styles';

export interface CliDefaults {
  /** The pre-registered experiment seed: a run with it is a FULL run and needs --full and --reviewed-before. */
  seed: number;
  runs: number;
  runsPerSession: number;
  capMs: number;
}

export interface CliOptions {
  agents: StyleId[];
  runs: number;
  runsPerSession: number;
  capMs: number;
  seed: number;
  /** null: use the default folder name. */
  out: string | null;
  /** null: not informed. */
  reviewedBefore: boolean | null;
  smoke: boolean;
  full: boolean;
  force: boolean;
}

export type CliParse = { ok: true; options: CliOptions } | { ok: false; errors: string[] };

/** Smoke preset: tiny, with a seed that is never the experiment's. */
export const SMOKE_PRESET = { agents: ['agressivo', 'repetitivo'] as StyleId[], runs: 3, capMs: 60_000, seed: 4242 };

const VALUE_FLAGS = ['agents', 'runs', 'runs-per-session', 'cap-ms', 'seed', 'out', 'reviewed-before'] as const;
const BOOL_FLAGS = ['smoke', 'full', 'force'] as const;

export function parseCliArgs(argv: readonly string[], defaults: CliDefaults): CliParse {
  const errors: string[] = [];
  const values = new Map<string, string>();
  const bools = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) {
      errors.push(`unexpected argument "${tok}" (flags start with --)`);
      continue;
    }
    if (tok.includes('=')) {
      errors.push(`"${tok}": the --flag=value form is not supported; write --flag value`);
      continue;
    }
    const name = tok.slice(2);
    if ((BOOL_FLAGS as readonly string[]).includes(name)) {
      if (bools.has(name)) errors.push(`--${name} given twice`);
      bools.add(name);
    } else if ((VALUE_FLAGS as readonly string[]).includes(name)) {
      if (values.has(name)) errors.push(`--${name} given twice`);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        errors.push(`--${name} needs a value`);
      } else {
        values.set(name, v);
        i++;
      }
    } else {
      errors.push(`unknown argument "${tok}"`);
    }
  }

  const smoke = bools.has('smoke');
  const full = bools.has('full');
  const force = bools.has('force');

  const num = (name: string, fallback: number, min: number): number => {
    const v = values.get(name);
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < min) {
      errors.push(`--${name} must be an integer >= ${min} (got "${v}")`);
      return fallback;
    }
    return n;
  };

  let agents: StyleId[] = smoke ? [...SMOKE_PRESET.agents] : [...STYLE_IDS];
  const agentsRaw = values.get('agents');
  if (agentsRaw !== undefined) {
    const ids = agentsRaw.split(',').map((s) => s.trim());
    if (ids.some((s) => s === '')) {
      errors.push('--agents must be a non-empty comma-separated list without empty entries');
    } else {
      const unknown = ids.filter((s) => !(STYLE_IDS as readonly string[]).includes(s));
      if (unknown.length > 0) errors.push(`unknown agent(s) ${unknown.join(', ')}; valid: ${STYLE_IDS.join(', ')}`);
      const dup = ids.filter((s, i) => ids.indexOf(s) !== i);
      if (dup.length > 0) errors.push(`duplicate agent(s) in --agents: ${[...new Set(dup)].join(', ')}`);
      if (unknown.length === 0 && dup.length === 0) agents = ids as StyleId[];
    }
  }

  const reviewedRaw = values.get('reviewed-before');
  let reviewedBefore: boolean | null = null;
  if (reviewedRaw !== undefined) {
    if (reviewedRaw === 'yes') reviewedBefore = true;
    else if (reviewedRaw === 'no') reviewedBefore = false;
    else errors.push(`--reviewed-before must be yes or no (got "${reviewedRaw}")`);
  }

  const seed = num('seed', smoke ? SMOKE_PRESET.seed : defaults.seed, 0);
  const options: CliOptions = {
    agents,
    runs: num('runs', smoke ? SMOKE_PRESET.runs : defaults.runs, 1),
    runsPerSession: num('runs-per-session', defaults.runsPerSession, 1),
    capMs: num('cap-ms', smoke ? SMOKE_PRESET.capMs : defaults.capMs, 1),
    seed,
    out: values.get('out') ?? null,
    reviewedBefore,
    smoke,
    full,
    force,
  };
  if (values.has('out') && values.get('out') === '') errors.push('--out must not be empty');

  const isFullSeed = seed === defaults.seed;
  if (isFullSeed && smoke) {
    errors.push(`--smoke never runs with the pre-registered seed ${defaults.seed}`);
  } else if (isFullSeed) {
    const missing: string[] = [];
    if (!full) missing.push('--full');
    if (reviewedBefore === null) missing.push('--reviewed-before yes|no');
    if (missing.length > 0) {
      errors.push(
        `seed ${defaults.seed} is the pre-registered FULL run; it requires ${missing.join(' and ')}. ` +
          'For a trial run use --smoke or another --seed.',
      );
    }
  } else if (full) {
    errors.push(`--full is only for the pre-registered seed ${defaults.seed}`);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, options };
}

/**
 * Default output folder name, from LOCAL date and time so two runs on the same day do not share a
 * folder: yyyy-mm-dd-HHMM-seed<seed>[-smoke].
 */
export function defaultOutName(seed: number, smoke: boolean, now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `${stamp}-seed${seed}${smoke ? '-smoke' : ''}`;
}
