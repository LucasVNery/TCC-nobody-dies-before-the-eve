import { describe, it, expect } from 'vitest';
import { ProfileAccumulator } from '../../profile/profileAccumulator';
import { DEFAULT_EXPERIMENT, type AgentLog } from './agentRunner';
import type { HypothesisResult, IccResult } from './evaluate';
import type { PipelineCheck } from './pipelineChecks';
import { buildReport, type ReportInput } from './report';
import { STYLE_IDS, type StyleId } from './styles';
import { REPORT_SKILLS, type WindowValue } from './windowValues';

/** Minimal CSV parser (RFC 4180 subset), independent of the implementation. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const emptyByStyle = (): Record<StyleId, WindowValue[]> =>
  Object.fromEntries(STYLE_IDS.map((s) => [s, []])) as unknown as Record<StyleId, WindowValue[]>;

const wv = (runIdx: number, roomIdx: number | null, skill: WindowValue['skill'], domain: number | null): WindowValue => ({
  runIdx,
  roomIdx,
  skill,
  domain,
  confidence: 0.5,
  sampleSize: domain === null ? 0 : 4,
});

function liveWith(): ProfileAccumulator {
  const acc = new ProfileAccumulator();
  acc.record('punish', 3, 4);
  return acc;
}

function log(styleId: StyleId, playerId: string, over: Partial<AgentLog> = {}): AgentLog {
  return {
    styleId,
    playerId,
    events: [],
    live: liveWith(),
    completedRuns: 2,
    truncatedRuns: 0,
    emptyRuns: [],
    simulatedMs: 12_500,
    sessions: 2,
    ...over,
  };
}

const HYP: HypothesisResult[] = [
  {
    id: 'H3',
    skill: 'punish',
    verdict: 'confirmada',
    delta: 0.5,
    lo: 0.25,
    hi: 0.75,
    nHigher: 12,
    nLower: 11,
    undefinedRateLower: 0.1,
    undefinedRate: null,
    nRuns: null,
  },
  {
    id: 'H1u',
    skill: 'weapon_repertoire',
    verdict: 'indefinida',
    delta: null,
    lo: null,
    hi: null,
    nHigher: 0,
    nLower: 0,
    undefinedRateLower: null,
    style: 'repetitivo',
    undefinedRate: 1,
    nRuns: 4,
  },
];

const ICC: IccResult[] = [
  { skill: 'punish', nAgents: 2, icc: 0.4, lo: 0.1, hi: 0.7, belowCriterion: true },
  { skill: 'patience', nAgents: 0, icc: null, lo: null, hi: null, belowCriterion: null },
];

function smallInput(over: Partial<ReportInput> = {}): ReportInput {
  const runValues = emptyByStyle();
  const roomValues = emptyByStyle();
  runValues.agressivo = [wv(0, null, 'punish', 0.25), wv(1, null, 'punish', null)];
  runValues.evasivo = [wv(0, null, 'punish', 0.75), wv(1, null, 'punish', 0.5)];
  roomValues.agressivo = [wv(0, 0, 'punish', 0.25), wv(0, 1, 'punish', 1 / 3)];
  roomValues.evasivo = [wv(0, 0, 'punish', 0.75)];
  return {
    config: { ...DEFAULT_EXPERIMENT, agents: ['agressivo', 'evasivo'], runsPerAgent: 2, runsPerSession: 1 },
    gameVersion: 'v-test',
    generatedAtIso: '2026-10-19T12:00:00.000Z',
    elapsedMs: 4321,
    logs: [log('agressivo', 'agent-0'), log('evasivo', 'agent-1')],
    runValues,
    roomValues,
    hypotheses: HYP,
    icc: ICC,
    checks: {
      ...(Object.fromEntries(STYLE_IDS.map((s) => [s, []])) as unknown as Record<StyleId, PipelineCheck[]>),
      agressivo: [{ id: 'seq-contiguous', ok: true, detail: '2 sessions' }],
      evasivo: [{ id: 'run-accounting', ok: true, detail: 'a | b' }],
    },
    hypothesesReviewedBeforeFullRun: true,
    ...over,
  };
}

const SECTIONS = [
  '## 1. Configuração',
  '## 2. Perfil final por agente',
  '## 3. Separação de estilos',
  '## 4. Estabilidade (limite superior)',
  '## 5. Verificações do pipeline',
  '## 6. Limitações',
];

describe('buildReport', () => {
  it('golden CSVs for a small hand-written input', () => {
    const f = buildReport(smallInput());
    expect(f['runs.csv']).toBe(
      [
        'agent,style,runIdx,skill,domain,confidence,sampleSize',
        'agent-0,agressivo,0,punish,0.250,0.500,4',
        'agent-0,agressivo,1,punish,,0.500,0',
        'agent-1,evasivo,0,punish,0.750,0.500,4',
        'agent-1,evasivo,1,punish,0.500,0.500,4',
        '',
      ].join('\n'),
    );
    expect(f['rooms.csv']).toBe(
      [
        'agent,style,runIdx,roomIdx,skill,domain,confidence,sampleSize',
        'agent-0,agressivo,0,0,punish,0.250,0.500,4',
        'agent-0,agressivo,0,1,punish,0.333,0.500,4',
        'agent-1,evasivo,0,0,punish,0.750,0.500,4',
        '',
      ].join('\n'),
    );
    expect(f['hipoteses.csv']).toBe(
      [
        'id,skill,kind,higher,lower,style,delta,ci_lo,ci_hi,n_higher,n_lower,undefined_rate_lower,undefined_rate,n_runs,verdict',
        'H3,punish,greater,paciente,evasivo,,0.500,0.250,0.750,12,11,0.100,,,confirmada',
        'H1u,weapon_repertoire,undefinedRate,,,repetitivo,,,,0,0,,1.000,4,indefinida',
        '',
      ].join('\n'),
    );
    expect(f['icc.csv']).toBe(
      [
        'skill,n_agents,icc,ci_lo,ci_hi,below_criterion,criterion',
        'punish,2,0.400,0.100,0.700,true,0.500',
        'patience,0,,,,,0.500',
        '',
      ].join('\n'),
    );
    const lines = f['perfil_final.csv'].trimEnd().split('\n');
    expect(lines).toHaveLength(1 + 2 * 6);
    expect(lines[0]).toBe('agent,style,skill,domain,confidence,deficit,sampleSize');
    expect(lines.find((l) => l.startsWith('agent-0,agressivo,punish'))).toBe('agent-0,agressivo,punish,0.500,0.000,0.500,0');
    expect(lines.find((l) => l.startsWith('agent-0,agressivo,weapon_repertoire'))).toBe(
      'agent-0,agressivo,weapon_repertoire,,0.000,,0',
    );
  });

  it('golden Markdown pieces for the same input', () => {
    const md = buildReport(smallInput())['relatorio.md'];
    expect(md).toContain('- Versão do jogo: v-test');
    expect(md).toContain('- Tempo decorrido: 4,3 s');
    expect(md).toContain(
      'revisadas pelo autor ANTES da execução completa: sim',
    );
    expect(md).toContain('| agressivo | 2 | 2 | 0 | 0 | 2 | 12,5 |');
    expect(md).toContain(
      '| H3 | punish | paciente | evasivo | — | 0,500 | [0,250; 0,750] | 12 | 11 | 10% | — | — | confirmada |',
    );
    expect(md).toContain(
      '| H1u | weapon_repertoire | — | — | repetitivo | — | — | — | — | — | 100% | 4 | indefinida |',
    );
    expect(md).toContain('| punish | 0,400 | [0,100; 0,700] | 2 | sim |');
    expect(md).toContain('| patience | — | — | 0 | — |');
    // matrix: agressivo punish median of the defined value 0.25, half of runs undefined
    expect(md).toContain('| agressivo | — | — | 0,250 (50%) | — | — | — |');
    expect(md).toContain('| evasivo | — | — | 0,625 (0%) | — | — | — |');
    expect(md).toContain('| evasivo | run-accounting | ok | a \\| b |');
  });

  it('the six sections exist, in order, and the fixed texts are present', () => {
    const md = buildReport(smallInput())['relatorio.md'];
    const idx = SECTIONS.map((s) => md.indexOf(`\n${s}\n`));
    for (const i of idx) expect(i).toBeGreaterThan(-1);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(md).toContain('IC condicional aos agentes: reamostra runs, não agentes; não é IC de população.');
    expect(md).toContain('limite superior');
    expect(md).toContain('H6 NÃO tem a cláusula');
    for (const frag of [
      'Política estacionária',
      'atraso de reação, mas não aprendem',
      'decisões do autor e do Claude',
      'seeds diferentes da do experimento',
      'dimensão 7',
      'não é validade em humanos',
      '180 ms',
      'teto de 35%',
      '300 px',
      'paciência pode separar mal',
      '`taken`',
      '10 vezes',
      'Runs vazias são descartadas',
    ])
      expect(md).toContain(frag);
  });

  it('renders the hypothesis review flag as sim / não / não informado', () => {
    const r = (v: boolean | null | undefined): string =>
      buildReport(smallInput({ hypothesesReviewedBeforeFullRun: v }))['relatorio.md'];
    expect(r(true)).toContain('execução completa: sim');
    expect(r(false)).toContain('execução completa: não\n');
    expect(r(null)).toContain('execução completa: não informado');
    expect(r(undefined)).toContain('execução completa: não informado');
    expect(r(true)).toContain('(14 itens)');
  });

  it('a failed pipeline check shows FALHOU in bold; passing ones do not', () => {
    const input = smallInput();
    input.checks.evasivo = [{ id: 'seq-contiguous', ok: false, detail: 'agent-s1: expected seq 3, found 5' }];
    const md = buildReport(input)['relatorio.md'];
    expect(md).toContain('| evasivo | seq-contiguous | **FALHOU** | agent-s1: expected seq 3, found 5 |');
    expect(md.match(/FALHOU/g)).toHaveLength(1);
  });

  it('empty runs are absent from runs.csv/rooms.csv and only counted in section 2', () => {
    const input = smallInput({
      logs: [
        log('agressivo', 'agent-0', { completedRuns: 1, emptyRuns: [1] }),
        log('evasivo', 'agent-1', { completedRuns: 1, truncatedRuns: 1 }),
      ],
    });
    // even if a caller forgets to drop them, run 1 of agressivo must not leak
    input.runValues.agressivo.push(wv(1, null, 'punish', 0.9));
    input.roomValues.agressivo.push(wv(1, 0, 'punish', 0.9));
    const f = buildReport(input);
    const runs = parseCsv(f['runs.csv']);
    expect(runs.filter((r) => r[1] === 'agressivo').map((r) => r[2])).toEqual(['0']);
    expect(parseCsv(f['rooms.csv']).filter((r) => r[1] === 'agressivo').map((r) => r[2])).toEqual(['0', '0']);
    expect(f['relatorio.md']).toContain('| agressivo | 2 | 1 | 0 | 1 | 2 | 12,5 |');
    expect(f['relatorio.md']).toContain('| evasivo | 2 | 1 | 1 | 0 | 2 | 12,5 |');
  });

  it('runs.csv has agents x non-empty runs x 6 dimensions rows', () => {
    const input = smallInput();
    for (const s of ['agressivo', 'evasivo'] as const) {
      input.runValues[s] = [0, 1, 2].flatMap((r) => REPORT_SKILLS.map((k) => wv(r, null, k, r === 2 ? null : 0.5)));
    }
    const rows = parseCsv(buildReport(input)['runs.csv']);
    expect(rows.length - 1).toBe(2 * 3 * 6);
  });

  it('Markdown and CSV agree on delta and CI after comma/point conversion', () => {
    const f = buildReport(smallInput());
    const md = f['relatorio.md'];
    const csvRows = parseCsv(f['hipoteses.csv']).slice(1);
    const mdRows = md
      .split('\n')
      .filter((l) => /^\| H\d/.test(l))
      .map((l) => l.split(' | ').map((c) => c.replace(/^\| |\ \|$/g, '')));
    expect(mdRows).toHaveLength(csvRows.length);
    for (const [i, c] of csvRows.entries()) {
      const m = mdRows[i];
      expect(m[0]).toBe(c[0]);
      expect(m[5].replace(',', '.').replace('—', '')).toBe(c[6]);
      const ci = m[6].replace(/,/g, '.').replace('—', '');
      expect(ci).toBe(c[7] === '' ? '' : `[${c[7]}; ${c[8]}]`);
      expect(m[12]).toBe(c[14]);
    }
  });

  it('never prints NaN, undefined or Infinity, even for non-finite inputs', () => {
    const input = smallInput();
    input.hypotheses[0] = { ...input.hypotheses[0], delta: Number.NaN, lo: Infinity, hi: -Infinity };
    input.icc[0] = { ...input.icc[0], icc: Number.NaN };
    input.logs[0].live = new ProfileAccumulator();
    const f = buildReport(input);
    for (const [name, text] of Object.entries(f)) expect(text, name).not.toMatch(/NaN|Infinity|(?<!\w)undefined(?!\w)/);
  });

  it('escapes commas, quotes and newlines in CSV and a minimal parser reads them back', () => {
    const awkward = 'agent "A", the\nfirst';
    const input = smallInput({ logs: [log('agressivo', awkward), log('evasivo', 'agent-1')] });
    const f = buildReport(input);
    expect(f['runs.csv']).toContain('"agent ""A"", the\nfirst",agressivo,0');
    const rows = parseCsv(f['runs.csv']);
    expect(rows[1][0]).toBe(awkward);
    expect(rows.every((r) => r.length === 7)).toBe(true);
    expect(parseCsv(f['rooms.csv']).every((r) => r.length === 8)).toBe(true);
  });

  it('is pure: the same input gives the same files', () => {
    expect(buildReport(smallInput())).toEqual(buildReport(smallInput()));
  });
});
