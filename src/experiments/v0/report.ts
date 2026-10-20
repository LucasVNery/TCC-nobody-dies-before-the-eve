// src/experiments/v0/report.ts
// The V0 report as Markdown + CSV (spec §4.6). PURE: no clock, no I/O; the date
// and the elapsed time come from the caller.
import { HYPOTHESES } from './hypotheses';
import type { HypothesisResult, IccResult } from './evaluate';
import { ICC_CRITERION, MIN_DELTA, MIN_VALUES, dropEmptyRuns } from './evaluate';
import type { AgentLog, ExperimentConfig } from './agentRunner';
import type { PipelineCheck } from './pipelineChecks';
import { AGENT_STYLES, type StyleId } from './styles';
import { REPORT_SKILLS, type WindowValue } from './windowValues';

export interface ReportInput {
  config: ExperimentConfig;
  gameVersion: string;
  generatedAtIso: string;
  elapsedMs: number;
  logs: AgentLog[];
  /** Already without empty runs (prepareValues); they are dropped again here, defensively. */
  runValues: Record<StyleId, WindowValue[]>;
  roomValues: Record<StyleId, WindowValue[]>;
  hypotheses: HypothesisResult[];
  icc: IccResult[];
  checks: Record<StyleId, PipelineCheck[]>;
  /** Filled by the CLI from a flag: did the author review H1-H12/H1u/H2u BEFORE the full run? */
  hypothesesReviewedBeforeFullRun?: boolean | null;
}

export interface ReportFiles {
  'relatorio.md': string;
  'runs.csv': string;
  'rooms.csv': string;
  'hipoteses.csv': string;
  'icc.csv': string;
  'perfil_final.csv': string;
}

// ---------------------------------------------------------------- numbers

type Num = number | null | undefined;

/** `n` with `digits` decimals and a point; null for null/undefined/non-finite (never NaN/Infinity in a file). */
function fixed(n: Num, digits = 3): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const s = n.toFixed(digits);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/** Markdown number: pt-BR decimal comma, '—' for null. */
function md(n: Num, digits = 3): string {
  const s = fixed(n, digits);
  return s === null ? '—' : s.replace('.', ',');
}

const mdPct = (n: Num): string => (n === null || n === undefined ? '—' : `${md(n * 100, 0)}%`);

/** Short decimal (no padding) for configuration values, with a comma. */
const short = (n: number): string => String(n).replace('.', ',');

function cell(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function table(header: string[], rows: string[][]): string {
  const line = (cs: string[]): string => `| ${cs.map(cell).join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

// -------------------------------------------------------------------- csv

/** Numbers are real-valued (3 decimals, point); counts and indices go in as strings via `int`. */
type CsvCell = string | number | boolean | null;

const int = (n: number | null): string | null => (n === null ? null : String(n));

function csvCell(c: CsvCell): string {
  if (c === null) return '';
  if (typeof c === 'boolean') return c ? 'true' : 'false';
  const s = typeof c === 'number' ? (fixed(c) ?? '') : c;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(header: string[], rows: CsvCell[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

// ------------------------------------------------------------------ build

export function buildReport(input: ReportInput): ReportFiles {
  const styles = input.config.agents;
  const logOf = (s: StyleId): AgentLog | undefined => input.logs.find((l) => l.styleId === s);
  const agentName = (s: StyleId): string => logOf(s)?.playerId ?? s;
  const kept = (values: Record<StyleId, WindowValue[]>, s: StyleId): WindowValue[] =>
    dropEmptyRuns(values[s] ?? [], logOf(s)?.emptyRuns ?? []);

  const windowRows = (values: Record<StyleId, WindowValue[]>, withRoom: boolean): CsvCell[][] =>
    styles.flatMap((s) =>
      kept(values, s).map((v) => [
        agentName(s),
        s,
        int(v.runIdx),
        ...(withRoom ? [int(v.roomIdx)] : []),
        v.skill,
        v.domain,
        v.confidence,
        int(v.sampleSize),
      ]),
    );
  const tail = ['skill', 'domain', 'confidence', 'sampleSize'];

  const hypRows = input.hypotheses.map((r) => {
    const h = HYPOTHESES.find((x) => x.id === r.id);
    return [
      r.id,
      r.skill,
      h?.kind ?? null,
      h?.higher ?? null,
      h?.lower ?? null,
      r.style ?? null,
      r.delta,
      r.lo,
      r.hi,
      int(r.nHigher),
      int(r.nLower),
      r.undefinedRateLower,
      r.undefinedRate,
      int(r.nRuns),
      r.verdict,
    ] satisfies CsvCell[];
  });

  return {
    'relatorio.md': markdown(input, logOf, kept),
    'runs.csv': csv(['agent', 'style', 'runIdx', ...tail], windowRows(input.runValues, false)),
    'rooms.csv': csv(['agent', 'style', 'runIdx', 'roomIdx', ...tail], windowRows(input.roomValues, true)),
    'hipoteses.csv': csv(
      [
        'id', 'skill', 'kind', 'higher', 'lower', 'style', 'delta', 'ci_lo', 'ci_hi',
        'n_higher', 'n_lower', 'undefined_rate_lower', 'undefined_rate', 'n_runs', 'verdict',
      ],
      hypRows,
    ),
    'icc.csv': csv(
      ['skill', 'n_agents', 'icc', 'ci_lo', 'ci_hi', 'below_criterion', 'criterion'],
      input.icc.map((r) => [r.skill, int(r.nAgents), r.icc, r.lo, r.hi, r.belowCriterion, ICC_CRITERION]),
    ),
    'perfil_final.csv': csv(
      ['agent', 'style', 'skill', 'domain', 'confidence', 'deficit', 'sampleSize'],
      styles.flatMap((s) => {
        const live = logOf(s)?.live;
        return REPORT_SKILLS.map((k) => [
          agentName(s),
          s,
          k,
          live?.domain(k, 'trait') ?? null,
          live ? live.confidence(k, 'trait') : null,
          live?.deficit(k, 'trait') ?? null,
          live ? int(live.sampleSize(k, 'trait')) : null,
        ]);
      }),
    ),
  };
}

// --------------------------------------------------------------- markdown

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function markdown(
  input: ReportInput,
  logOf: (s: StyleId) => AgentLog | undefined,
  kept: (v: Record<StyleId, WindowValue[]>, s: StyleId) => WindowValue[],
): string {
  const { config } = input;
  const styles = config.agents;
  const out: string[] = ['# Relatório do experimento V0 (agentes sintéticos)', ''];

  // 1
  const hr = config.humanizer;
  const reviewed =
    input.hypothesesReviewedBeforeFullRun === true
      ? 'sim'
      : input.hypothesesReviewedBeforeFullRun === false
        ? 'não'
        : 'não informado';
  const weights = (w: Record<string, number>): string =>
    Object.entries(w)
      .map(([k, v]) => `${k} ${short(v)}`)
      .join('; ');
  out.push(
    '## 1. Configuração',
    '',
    `- Versão do jogo: ${input.gameVersion}`,
    `- Seed do experimento: ${config.seed} (todas as seeds de jogo, política e humanizador derivam dela, por agente e por run)`,
    `- Humanizador: reação ${short(hr.reactionMeanMs)} ms (desvio ${short(hr.reactionSdMs)} ms), probabilidade de lapso ${short(hr.lapseProb)}, ruído de mira ${short(hr.aimNoiseRad)} rad`,
    `- Passo da simulação: ${md(config.stepMs)} ms`,
    `- Teto de tempo simulado por run: ${config.runCapMs} ms`,
    `- Runs por agente: ${config.runsPerAgent}; runs por sessão: ${config.runsPerSession}`,
    `- Gerado em: ${input.generatedAtIso}`,
    `- Tempo decorrido: ${md(input.elapsedMs / 1000, 1)} s`,
    `- Hipóteses H1–H12 e H1u, H2u (14 itens) pré-registradas; revisadas pelo autor ANTES da execução completa: ${reviewed}`,
    '- A revisão das hipóteses pelo autor aconteceu DEPOIS do piloto de calibração dos agentes.',
    '',
    'Parâmetros dos estilos (pesos relativos; distâncias em px):',
    '',
    table(
      ['Agente', 'Armas', 'Trocas/min', 'Ações', 'Cooldown (ms)', 'Distância ± tolerância', 'Defesa', 'Espera abertura'],
      styles.map((s) => {
        const p = AGENT_STYLES[s];
        const d = p.defenseWeights;
        return [
          s,
          weights(p.weaponWeights),
          short(p.weaponSwitchPerMin),
          weights(p.actionWeights),
          short(p.attackCooldownMs),
          `${short(p.preferredDistance)} ± ${short(p.distanceTolerance)}`,
          `esquiva ${short(d.dodge)}; bloqueio ${short(d.block)}; parry ${short(d.parry)}; nada ${short(d.none)}`,
          p.waitForOpening ? 'sim' : 'não',
        ];
      }),
    ),
    '',
  );

  // 2
  out.push(
    '## 2. Perfil final por agente',
    '',
    'Runs vazias (iniciadas pelo diretor depois de uma morte que encerra a sessão, sem evidência) são DESCARTADAS de todas as tabelas e só contadas aqui. Identidade: run.start = completas + truncadas + vazias.',
    '',
    table(
      ['Agente', 'Run.start', 'Completas', 'Truncadas', 'Vazias (descartadas)', 'Sessões', 'Tempo simulado (s)'],
      styles.flatMap((s) => {
        const l = logOf(s);
        if (!l) return [[s, '—', '—', '—', '—', '—', '—']];
        const n = l.completedRuns + l.truncatedRuns + l.emptyRuns.length;
        return [[s, `${n}`, `${l.completedRuns}`, `${l.truncatedRuns}`, `${l.emptyRuns.length}`, `${l.sessions}`, md(l.simulatedMs / 1000, 1)]];
      }),
    ),
    '',
    'Perfil final (acumulador ao vivo, relógio de traço; déficit = 1 − domínio; — quando indefinido):',
    '',
    table(
      ['Agente', 'Dimensão', 'Domínio', 'Confiança', 'Déficit'],
      styles.flatMap((s) => {
        const live = logOf(s)?.live;
        return REPORT_SKILLS.map((k) => [
          s,
          k,
          md(live?.domain(k, 'trait')),
          md(live ? live.confidence(k, 'trait') : null),
          md(live?.deficit(k, 'trait')),
        ]);
      }),
    ),
    '',
  );

  // 3
  out.push(
    '## 3. Separação de estilos',
    '',
    `Veredito: confirmada (IC 95% bootstrap do delta de Cliff acima de 0 e delta ≥ ${md(MIN_DELTA, 2)}, ou a taxa de indefinição pedida); refutada; indefinida (dados insuficientes: menos de ${MIN_VALUES} valores definidos por grupo, ou menos de ${MIN_VALUES} runs nas hipóteses de taxa de indefinição). Hipótese refutada ou indefinida é resultado, não defeito.`,
    '',
    'Linhas H1u e H2u (taxa de indefinição): as colunas Estilo, Indef. estilo e N runs substituem Maior/Menor, delta e IC. H5 e H12 também são confirmadas se o grupo menor for indefinido em pelo menos 95% das runs; H6 NÃO tem a cláusula "ou indefinido".',
    '',
    table(
      ['Id', 'Dimensão', 'Maior', 'Menor', 'Estilo', 'Delta', 'IC 95%', 'N maior', 'N menor', 'Indef. menor', 'Indef. estilo', 'N runs estilo', 'Veredito'],
      input.hypotheses.map((r) => {
        const h = HYPOTHESES.find((x) => x.id === r.id);
        const rate = r.style !== undefined;
        return [
          r.id,
          r.skill,
          h?.higher ?? '—',
          h?.lower ?? '—',
          r.style ?? '—',
          md(r.delta),
          r.lo === null && r.hi === null ? '—' : `[${md(r.lo)}; ${md(r.hi)}]`,
          rate ? '—' : `${r.nHigher}`,
          rate ? '—' : `${r.nLower}`,
          rate ? '—' : mdPct(r.undefinedRateLower),
          rate ? mdPct(r.undefinedRate) : '—',
          rate ? (r.nRuns === null ? '—' : `${r.nRuns}`) : '—',
          r.verdict,
        ];
      }),
    ),
    '',
    'Matriz estilo × dimensão: mediana dos valores definidos por run (entre parênteses, fração de runs indefinidas).',
    '',
    table(
      ['Estilo', ...REPORT_SKILLS],
      styles.map((s) => [
        s,
        ...REPORT_SKILLS.map((k) => {
          const runs = kept(input.runValues, s).filter((v) => v.roomIdx === null && v.skill === k);
          if (runs.length === 0) return '—';
          const defined = runs.filter((v) => v.domain !== null).map((v) => v.domain as number);
          return `${md(median(defined))} (${mdPct((runs.length - defined.length) / runs.length)})`;
        }),
      ]),
    ),
    '',
  );

  // 4
  out.push(
    '## 4. Estabilidade (limite superior)',
    '',
    'ICC(1,1) por dimensão, com os agentes como grupos e os valores por sala como medidas. É um limite superior: as políticas são estacionárias.',
    '',
    'IC condicional aos agentes: reamostra runs, não agentes; não é IC de população.',
    '',
    `O sinalizador "< ${md(ICC_CRITERION, 2)}" é apenas mostrado, NÃO aplicado (nenhuma conclusão foi condicionada a ele).`,
    '',
    table(
      ['Dimensão', 'ICC', 'IC 95%', 'N agentes', `< ${md(ICC_CRITERION, 2)} (não aplicado)`],
      input.icc.map((r) => [
        r.skill,
        md(r.icc),
        r.lo === null && r.hi === null ? '—' : `[${md(r.lo)}; ${md(r.hi)}]`,
        `${r.nAgents}`,
        r.belowCriterion === null ? '—' : r.belowCriterion ? 'sim' : 'não',
      ]),
    ),
    '',
  );

  // 5
  out.push(
    '## 5. Verificações do pipeline',
    '',
    table(
      ['Agente', 'Verificação', 'Resultado', 'Detalhe'],
      styles.flatMap((s) =>
        (input.checks[s] ?? []).map((c) => [s, c.id, c.ok ? 'ok' : '**FALHOU**', c.detail]),
      ),
    ),
    '',
  );

  // 6
  out.push(
    '## 6. Limitações',
    '',
    '- Política estacionária: cada agente joga sempre do mesmo jeito; a estabilidade medida é um limite superior.',
    '- Os agentes têm atraso de reação, mas não aprendem nem se adaptam ao jogo.',
    '- As hipóteses e a calibração são decisões do autor e do Claude; a calibração piloto usou só comportamento cru, com seeds diferentes da do experimento.',
    '- A dimensão 7 está fora do experimento.',
    '- Validade discriminante entre agentes sintéticos não é validade em humanos.',
    '- Agentes com ataque carregado em curso defendem até cerca de 180 ms depois do planejado (afeta sobretudo agressivo e aleatório).',
    '- Alguns critérios de calibração acompanham as dimensões que precedem (teto de 35% para o variado, regra de menos de 10% do paciente, distância do evasivo).',
    '- A distância média e a cadência são afetadas pela caminhada até cada novo inimigo (spawn a pelo menos 300 px).',
    '- A paciência pode separar mal paciente, bloqueador e evasivo.',
    '- A razão da janela de esquiva (`taken`) também premia parries.',
    '- Dados por sala desiguais entre agentes (o evasivo tem cerca de 10 vezes os dos outros); para os demais, por sala ≈ por run.',
    '- Runs vazias são descartadas (contadas só na seção 2).',
    '',
  );

  return out.join('\n');
}
