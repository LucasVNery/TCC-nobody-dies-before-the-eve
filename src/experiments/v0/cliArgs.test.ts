import { describe, it, expect } from 'vitest';
import { defaultOutName, parseCliArgs, parsePilotVerdicts, type CliOptions } from './cliArgs';
import { DEFAULT_EXPERIMENT } from './agentRunner';

const D = { seed: DEFAULT_EXPERIMENT.seed, runs: 30, runsPerSession: 10, capMs: DEFAULT_EXPERIMENT.runCapMs };
const parse = (...a: string[]) => parseCliArgs(a, D);
const errs = (...a: string[]): string[] => {
  const r = parse(...a);
  if (r.ok) throw new Error('expected rejection');
  return r.errors;
};
const opts = (...a: string[]): CliOptions => {
  const r = parse(...a);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.options;
};

describe('experiment defaults', () => {
  it('official run: seed 20261105 and a 10 minute cap per run', () => {
    expect(DEFAULT_EXPERIMENT.seed).toBe(20261105);
    expect(DEFAULT_EXPERIMENT.runCapMs).toBe(600_000);
  });
});

describe('parseCliArgs', () => {
  it('--smoke is the tiny preset on seed 4242 and needs nothing else', () => {
    expect(opts('--smoke')).toMatchObject({ agents: ['agressivo', 'repetitivo'], runs: 3, capMs: 60_000, seed: 4242, smoke: true });
  });

  it('another seed needs neither --full nor --reviewed-before', () => {
    expect(opts('--seed', '7', '--runs', '5', '--agents', 'agressivo')).toMatchObject({ seed: 7, runs: 5, agents: ['agressivo'] });
  });

  it('the default seed alone is refused, naming what is missing', () => {
    const e = errs();
    expect(e.join(' ')).toContain('--full');
    expect(e.join(' ')).toContain('--reviewed-before');
    expect(errs('--full').join(' ')).toContain('--reviewed-before');
    expect(errs('--reviewed-before', 'yes').join(' ')).toContain('--full');
  });

  it('a full run needs both --full and --reviewed-before', () => {
    expect(opts('--full', '--reviewed-before', 'no')).toMatchObject({ seed: D.seed, full: true, reviewedBefore: false });
    expect(opts('--full', '--reviewed-before', 'yes').reviewedBefore).toBe(true);
    // an explicit --seed equal to the pre-registered one is the same full run
    expect(errs('--seed', String(D.seed))).not.toHaveLength(0);
  });

  it('--smoke with the pre-registered seed is refused; --full with another seed too', () => {
    expect(errs('--smoke', '--seed', String(D.seed)).join(' ')).toContain('pre-registered');
    expect(errs('--full', '--seed', '7').join(' ')).toContain('--full');
  });

  it('rejects unknown flags, positionals and the --flag=value form', () => {
    expect(errs('--smoke', '--bogus').join(' ')).toContain('unknown argument "--bogus"');
    expect(errs('--smoke', 'extra').join(' ')).toContain('unexpected argument');
    expect(errs('--smoke', '--runs=5').join(' ')).toContain('--flag=value');
  });

  it('rejects missing values, repeated flags and bad numbers', () => {
    expect(errs('--smoke', '--runs').join(' ')).toContain('needs a value');
    expect(errs('--smoke', '--runs', '--force').join(' ')).toContain('needs a value');
    expect(errs('--smoke', '--runs', '3', '--runs', '4').join(' ')).toContain('given twice');
    expect(errs('--smoke', '--runs', '0').join(' ')).toContain('--runs');
    expect(errs('--smoke', '--runs', '2.5').join(' ')).toContain('--runs');
    expect(errs('--smoke', '--cap-ms', 'abc').join(' ')).toContain('--cap-ms');
    expect(errs('--smoke', '--reviewed-before', 'maybe').join(' ')).toContain('yes or no');
  });

  it('rejects an empty or duplicated or unknown --agents list', () => {
    expect(errs('--smoke', '--agents', '').join(' ')).toContain('--agents');
    expect(errs('--smoke', '--agents', 'agressivo,').join(' ')).toContain('--agents');
    expect(errs('--smoke', '--agents', 'agressivo,agressivo').join(' ')).toContain('duplicate');
    expect(errs('--smoke', '--agents', 'nope').join(' ')).toContain('unknown agent');
  });

  it('accepts --force and --out and keeps agents in the given order', () => {
    expect(opts('--smoke', '--force', '--out', 'x/y', '--agents', 'variado,agressivo')).toMatchObject({
      force: true,
      out: 'x/y',
      agents: ['variado', 'agressivo'],
    });
  });

  it('--pilot takes a path, defaults to null and may not be repeated or empty', () => {
    expect(opts('--smoke').pilot).toBeNull();
    expect(opts('--smoke', '--pilot', 'a/b.csv').pilot).toBe('a/b.csv');
    expect(errs('--smoke', '--pilot').join(' ')).toContain('needs a value');
    expect(errs('--smoke', '--pilot', 'x', '--pilot', 'y').join(' ')).toContain('given twice');
  });

  it('collects several errors at once', () => {
    expect(errs('--bogus', '--runs', '0').length).toBeGreaterThanOrEqual(2);
  });
});

describe('defaultOutName', () => {
  it('uses the local date and time', () => {
    expect(defaultOutName(4242, true, new Date(2026, 9, 19, 9, 5))).toBe('2026-10-19-0905-seed4242-smoke');
    expect(defaultOutName(7, false, new Date(2026, 0, 2, 23, 59))).toBe('2026-01-02-2359-seed7');
  });
});

describe('parsePilotVerdicts', () => {
  it('maps id to verdict from the pilot hipoteses.csv', () => {
    const csv = 'id,skill,kind,verdict\r\nH1,a,greater,indefinida\r\nH1u,b,undefinedRate,confirmada\nH3,c,greater,refutada\n';
    expect(parsePilotVerdicts(csv)).toEqual({ H1: 'indefinida', H1u: 'confirmada', H3: 'refutada' });
  });
  it('returns null for a missing header, an empty body or unknown verdicts', () => {
    expect(parsePilotVerdicts('')).toBeNull();
    expect(parsePilotVerdicts('id,skill\nH1,x')).toBeNull();
    expect(parsePilotVerdicts('id,verdict\nH1,talvez')).toBeNull();
  });
});
