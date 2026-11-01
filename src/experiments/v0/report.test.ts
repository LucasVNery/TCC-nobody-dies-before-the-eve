import { describe, it, expect } from 'vitest';
import { ProfileAccumulator } from '../../profile/profileAccumulator';
import { DEFAULT_EXPERIMENT, type AgentLog } from './agentRunner';
import type { HypothesisResult, IccResult, MHypothesisResult } from './evaluate';
import type { PipelineCheck } from './pipelineChecks';
import { buildReport, type ReportInput } from './report';
import type { RunMetrics, RunReactions } from './runMetrics';
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
  acc.applyRoomBoundary();
  return acc;
}

const ev = (...types: string[]): AgentLog['events'] => types.map((type) => ({ type }) as unknown as AgentLog['events'][number]);

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

const MHYP: MHypothesisResult[] = [
  {
    id: 'M1',
    metric: 'staminaSpentPerMinute',
    verdict: 'confirmada',
    delta: 0.75,
    lo: 0.5,
    hi: 1,
    nHigher: 12,
    nLower: 11,
    undefinedRateHigher: 0,
    undefinedRateLower: 0.25,
  },
  {
    id: 'M5',
    metric: 'itemPickRate',
    verdict: 'indefinida',
    delta: null,
    lo: null,
    hi: null,
    nHigher: 0,
    nLower: 2,
    undefinedRateHigher: 1,
    undefinedRateLower: 1 / 3,
  },
];

const rm = (
  runIdx: number,
  staminaSpentPerMinute: number | null,
  staminaHighFraction: number | null,
  dodgeSpendShare: number | null,
  blockSpendShare: number | null,
  itemPickRate: number | null,
): RunMetrics => ({ runIdx, staminaSpentPerMinute, staminaHighFraction, dodgeSpendShare, blockSpendShare, itemPickRate });

const emptyMetrics = (): Record<StyleId, RunMetrics[]> =>
  Object.fromEntries(STYLE_IDS.map((s) => [s, []])) as unknown as Record<StyleId, RunMetrics[]>;
const emptyReactions = (): Record<StyleId, RunReactions[]> =>
  Object.fromEntries(STYLE_IDS.map((s) => [s, []])) as unknown as Record<StyleId, RunReactions[]>;

function smallInput(over: Partial<ReportInput> = {}): ReportInput {
  // 2 agents x 3 runs for the M family / stamina / reaction sections
  const runMetrics = emptyMetrics();
  runMetrics.agressivo = [rm(0, 120, 0.25, 0.1, 0, 0.5), rm(1, 90, 0.5, 0.2, 0, null), rm(2, 150, 0.125, 0, 0.1, 1)];
  runMetrics.evasivo = [rm(0, 60, 0.75, 0.8, 0, 1), rm(1, null, null, null, null, null), rm(2, 45.5, 0.625, 0.9, 0.05, 0.5)];
  const reactions = emptyReactions();
  reactions.agressivo = [
    { runIdx: 0, byKind: { swing: { n: 2, meanMs: 300 } } },
    { runIdx: 1, byKind: {} },
    { runIdx: 2, byKind: { swing: { n: 1, meanMs: 210 }, lunge: { n: 1, meanMs: 400 } } },
  ];
  reactions.evasivo = [
    { runIdx: 0, byKind: { slam: { n: 3, meanMs: 500 } } },
    { runIdx: 1, byKind: {} },
    { runIdx: 2, byKind: { charge: { n: 1, meanMs: 610 }, slam: { n: 1, meanMs: 420 } } },
  ];
  const runValues = emptyByStyle();
  const roomValues = emptyByStyle();
  runValues.agressivo = [wv(0, null, 'punish', 0.25), wv(1, null, 'punish', null)];
  runValues.evasivo = [wv(0, null, 'punish', 0.75), wv(1, null, 'punish', 0.5)];
  roomValues.agressivo = [wv(0, 0, 'punish', 0.25), wv(0, 1, 'punish', 1 / 3)];
  roomValues.evasivo = [wv(0, 0, 'punish', 0.75)];
  return {
    config: { ...DEFAULT_EXPERIMENT, seed: 4242, agents: ['agressivo', 'evasivo'], runsPerAgent: 2, runsPerSession: 1, runCapMs: 300_000 },
    gameVersion: 'v-test',
    generatedAtIso: '2026-10-19T12:00:00.000Z',
    elapsedMs: 4321,
    logs: [log('agressivo', 'agent-0', { events: ev('run.start', 'obs.action', 'run.start', 'run.end', 'obs.action', 'obs.action') }), log('evasivo', 'agent-1')],
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
    runMetrics,
    mHypotheses: MHYP,
    reactions,
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
        'agent-0,agressivo,0,punish,0.250,0.500,4.000',
        'agent-0,agressivo,1,punish,,0.500,0.000',
        'agent-1,evasivo,0,punish,0.750,0.500,4.000',
        'agent-1,evasivo,1,punish,0.500,0.500,4.000',
        '',
      ].join('\n'),
    );
    expect(f['rooms.csv']).toBe(
      [
        'agent,style,runIdx,roomIdx,skill,domain,confidence,sampleSize',
        'agent-0,agressivo,0,0,punish,0.250,0.500,4.000',
        'agent-0,agressivo,0,1,punish,0.333,0.500,4.000',
        'agent-1,evasivo,0,0,punish,0.750,0.500,4.000',
        '',
      ].join('\n'),
    );
    expect(f['hipoteses.csv']).toBe(
      [
        'id,skill,kind,higher,lower,style,delta,ci_lo,ci_hi,n_higher,n_lower,undefined_rate_higher,undefined_rate_lower,undefined_rate,n_runs,verdict',
        'H3,punish,greater,paciente,evasivo,,0.500,0.250,0.750,12,11,,0.100,,,confirmada',
        'H1u,weapon_repertoire,undefinedRate,,,repetitivo,,,,,,,,1.000,4,indefinida',
        '',
      ].join('\n'),
    );
    expect(f['icc.csv']).toBe(
      [
        'skill,n_agents,n_room_measures,icc,ci_lo,ci_hi,below_criterion,criterion',
        'punish,2,3,0.400,0.100,0.700,true,0.500',
        'patience,0,0,,,,,0.500',
        '',
      ].join('\n'),
    );
    const lines = f['perfil_final.csv'].trimEnd().split('\n');
    expect(lines).toHaveLength(1 + 2 * 6);
    expect(lines[0]).toBe('agent,style,skill,domain,confidence,deficit,sampleSize');
    expect(lines.find((l) => l.startsWith('agent-0,agressivo,punish'))).toBe('agent-0,agressivo,punish,0.667,0.286,0.333,4.000');
    expect(lines.find((l) => l.startsWith('agent-0,agressivo,weapon_repertoire'))).toBe(
      'agent-0,agressivo,weapon_repertoire,,0.000,,0.000',
    );
  });

  it('counts events by type per agent (sorted, with total) in section 5 and events_by_type.csv', () => {
    const f = buildReport(smallInput());
    expect(f['events_by_type.csv']).toBe(
      ['agent,type,count', 'agent-0,obs.action,3', 'agent-0,run.end,1', 'agent-0,run.start,2', ''].join('\n'),
    );
    expect(f['relatorio.md']).toContain('| agent-0 | obs.action | 3 |');
    expect(f['relatorio.md']).toContain('| agent-0 | **total** | 6 |');
    expect(f['relatorio.md']).toContain('| agent-1 | **total** | 0 |');
  });

  it('golden: the WHOLE relatorio.md for the small hand-written input', () => {
    const golden = Object.values(
      import.meta.glob('./__golden__/relatorio.md', { query: '?raw', import: 'default', eager: true }),
    )[0] as string;
    const actual = buildReport(smallInput())['relatorio.md'];
    expect(actual).toEqual(golden.replace(/\r\n/g, '\n'));
  });

  it('writes non-integer sample sizes with 3 decimals in runs.csv, rooms.csv and perfil_final.csv', () => {
    const input = smallInput();
    input.runValues.agressivo = [{ ...wv(0, null, 'distance', 0.4), sampleSize: 11.320115000000001 }];
    input.roomValues.agressivo = [{ ...wv(0, 0, 'distance', 0.4), sampleSize: 12.999999999999996 }];
    const live = new ProfileAccumulator();
    live.record('distance', 1.5, 3.1);
    live.applyRoomBoundary();
    input.logs[0].live = live;
    const f = buildReport(input);
    expect(f['runs.csv']).toContain('agent-0,agressivo,0,distance,0.400,0.500,11.320\n');
    expect(f['rooms.csv']).toContain('agent-0,agressivo,0,0,distance,0.400,0.500,13.000\n');
    const row = f['perfil_final.csv'].split('\n').find((l) => l.startsWith('agent-0,agressivo,distance'))!;
    expect(row).toMatch(/,\d+\.\d{3}$/);
    for (const [name, text] of Object.entries(f)) if (name.endsWith('.csv')) expect(text, name).not.toMatch(/\d\.\d{4,}/);
  });

  it('marks sample-size-0 rows as a priori in section 2 and leaves domain/deficit empty in the CSV', () => {
    const f = buildReport(smallInput());
    const md = f['relatorio.md'];
    expect(md).toContain('| agressivo | weapon_repertoire | 0,000 | — | 0,000 | — | a priori (sem dados) |');
    expect(md).toContain('a priori (sem dados)');
    expect(f['perfil_final.csv']).toContain('agent-0,agressivo,weapon_repertoire,,0.000,,0.000');
  });

  it('renders hypothesis changes in section 1', () => {
    expect(buildReport(smallInput())['relatorio.md']).toContain(
      'Alterações nas hipóteses depois da primeira execução completa: nenhuma registrada',
    );
    expect(buildReport(smallInput({ hypothesisChanges: ['H3 trocada', 'H7 removida'] }))['relatorio.md']).toContain(
      'primeira execução completa: H3 trocada; H7 removida',
    );
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
      'H1 e H5 também são confirmadas',
      'Viés de seleção em defensive_repertoire',
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
    expect(r(true)).toContain('Hipóteses da família P (H1–H11 e H1u, H2u; 13 itens)');
    expect(r(true)).toContain('revisados pelo autor ANTES da execução completa da V0.1: sim');
    expect(r(false)).toContain('revisados pelo autor ANTES da execução completa da V0.1: não ');
    expect(r(null)).toContain('execução completa da V0.1: não informado');
    expect(r(true)).toContain('seeds 4242–4244; a seed ');
    expect(r(true)).toContain(
      'Versão final do pré-registro da família P (revisão do autor em 2026-10-20, depois do piloto da 0.0.3 e antes da execução completa dela): H1 recebeu a cláusula "ou indefinido"; H12 foi retirada por redundância com H2u.',
    );
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
      expect(m[13]).toBe(c[15]);
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

const NEW_SECTIONS = [
  '## 7. Métricas de estamina e de itens por estilo',
  '## 8. Família M (métricas novas)',
  '## 9. Reação por tipo de ataque (descritiva)',
  '## Apêndice A. Comparação com o piloto 0.0.3 (descritiva)',
];

describe('buildReport: V0.1 sections (M family, stamina/items, reactions, pilot appendix)', () => {
  it('the new sections come after the six V0 sections, in order, identical across two runs', () => {
    const md = buildReport(smallInput())['relatorio.md'];
    const idx = [...SECTIONS, ...NEW_SECTIONS].map((s) => md.indexOf(`\n${s}\n`));
    for (const i of idx) expect(i).toBeGreaterThan(-1);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(buildReport(smallInput())['relatorio.md']).toBe(md);
  });

  it('stamina and item metrics per style: mean and sample sd over the defined run values', () => {
    const md = buildReport(smallInput())['relatorio.md'];
    expect(md).toContain('| agressivo | staminaSpentPerMinute | 3 | 3 | 120,000 | 30,000 |');
    expect(md).toContain('| evasivo | staminaSpentPerMinute | 3 | 2 | 52,750 | 10,253 |');
    expect(md).toContain('| agressivo | itemPickRate | 3 | 2 | 0,750 | 0,354 |');
  });

  it('M family table and hipoteses_m.csv', () => {
    const f = buildReport(smallInput());
    expect(f['relatorio.md']).toContain(
      '| M1 | staminaSpentPerMinute | agressivo | bloqueador | 0,750 | [0,500; 1,000] | 12 | 11 | 0% | 25% | confirmada |',
    );
    expect(f['relatorio.md']).toContain('| M5 | itemPickRate | evasivo | agressivo | — | — | 0 | 2 | 100% | 33% | indefinida |');
    expect(f['relatorio.md']).toContain('- A elite não adapta (peso fixo)');
    expect(f['hipoteses_m.csv']).toBe(
      [
        'id,metric,higher,lower,delta,ci_lo,ci_hi,n_higher,n_lower,undefined_rate_higher,undefined_rate_lower,verdict',
        'M1,staminaSpentPerMinute,agressivo,bloqueador,0.750,0.500,1.000,12,11,0.000,0.250,confirmada',
        'M5,itemPickRate,evasivo,agressivo,,,,0,2,1.000,0.333,indefinida',
        '',
      ].join('\n'),
    );
  });

  it('metricas_run.csv is long format agent,style,run,metric,value with null as empty', () => {
    const rows = parseCsv(buildReport(smallInput())['metricas_run.csv']);
    expect(rows[0]).toEqual(['agent', 'style', 'run', 'metric', 'value']);
    expect(rows.length - 1).toBe(2 * 3 * 5);
    expect(rows[1]).toEqual(['agent-0', 'agressivo', '0', 'staminaSpentPerMinute', '120.000']);
    expect(rows).toContainEqual(['agent-1', 'evasivo', '1', 'dodgeSpendShare', '']);
    expect(rows).toContainEqual(['agent-1', 'evasivo', '2', 'staminaSpentPerMinute', '45.500']);
  });

  it('reaction by attack kind: weighted by n across runs, kinds as logged (unknown ones kept)', () => {
    const f = buildReport(smallInput());
    expect(f['reacao_por_tipo.csv']).toBe(
      [
        'agent,style,kind,n,mean_ms',
        'agent-0,agressivo,lunge,1,400.000',
        'agent-0,agressivo,swing,3,270.000',
        'agent-1,evasivo,charge,1,610.000',
        'agent-1,evasivo,slam,4,480.000',
        '',
      ].join('\n'),
    );
    expect(f['relatorio.md']).toContain('| agressivo | swing | 3 | 270,0 |');
    expect(f['relatorio.md']).toContain('| evasivo | charge | 1 | 610,0 |');
  });

  it('empty runs are dropped from the run metrics and the reactions', () => {
    const input = smallInput({
      logs: [log('agressivo', 'agent-0', { completedRuns: 1, emptyRuns: [2] }), log('evasivo', 'agent-1')],
    });
    const f = buildReport(input);
    const agr = parseCsv(f['metricas_run.csv']).filter((r) => r[1] === 'agressivo');
    expect([...new Set(agr.map((r) => r[2]))]).toEqual(['0', '1']);
    expect(f['reacao_por_tipo.csv']).toContain('agent-0,agressivo,swing,2,300.000');
    expect(f['reacao_por_tipo.csv']).not.toContain('agent-0,agressivo,lunge');
    expect(f['relatorio.md']).toContain('| agressivo | staminaSpentPerMinute | 2 | 2 | 105,000 | 21,213 |');
  });

  it('pilot appendix: P verdicts side by side when pilotVerdicts is given', () => {
    const md = buildReport(smallInput({ pilotVerdicts: { H3: 'refutada', H1u: 'indefinida', H7: 'confirmada' } }))['relatorio.md'];
    expect(md).not.toContain('piloto 0.0.3 não encontrado');
    expect(md).toContain('| Id | Dimensão | Veredito 0.0.3 (piloto) | Veredito atual |');
    expect(md).toContain('| H3 | punish | refutada | confirmada |');
    expect(md).toContain('| H1u | weapon_repertoire | indefinida | indefinida |');
    expect(md).toContain('| H7 | distance | confirmada | — |');
    expect(md).toContain('| H1 | weapon_repertoire | — | — |');
    expect(md).toContain('versões não comparáveis');
    const rows = md.split('## Apêndice A.')[1].split('\n').filter((l) => /^\| H\d/.test(l));
    expect(rows).toHaveLength(13);
  });

  it('the spec §4.5 limitation bullets are always in section 6, with or without the pilot file', () => {
    const bullets = [
      '- A elite não adapta (peso fixo).',
      '- Política estacionária',
      '- Humanizador igual para todos os estilos',
      '- O *perfect dodge* depende do ruído do humanizador, não de habilidade.',
      '- As hipóteses da família P (H1…H11, H1u, H2u; 13 itens) já foram vistas na 0.0.3; a V0.1 não as trata como novas',
      '- A dimensão de itens (aproveitamento de itens, candidata à sétima dimensão) fica fora do perfil; só depois destes dados.',
    ];
    for (const pilotVerdicts of [undefined, null, { H3: 'refutada' as const }]) {
      const md = buildReport(smallInput({ pilotVerdicts }))['relatorio.md'];
      const limits = md.split('\n## 6. Limitações\n')[1].split('\n## ')[0];
      for (const b of bullets) expect(limits, `${String(pilotVerdicts)}: ${b}`).toContain(b);
    }
  });

  it('pilot appendix: omitted with a warning (no throw) when pilotVerdicts is absent', () => {
    for (const pilotVerdicts of [undefined, null]) {
      const md = buildReport(smallInput({ pilotVerdicts }))['relatorio.md'];
      expect(md).toContain('piloto 0.0.3 não encontrado');
      expect(md).not.toContain('Veredito 0.0.3 (piloto)');
    }
  });

  it('new files never print NaN, undefined or Infinity', () => {
    const input = smallInput();
    input.mHypotheses[0] = { ...input.mHypotheses[0], delta: Number.NaN, lo: Infinity, hi: -Infinity };
    input.runMetrics.agressivo = [rm(0, Number.NaN, null, Infinity, null, null)];
    const f = buildReport(input);
    for (const [name, text] of Object.entries(f)) expect(text, name).not.toMatch(/NaN|Infinity|(?<!\w)undefined(?!\w)/);
  });
});
