// src/experiments/v0/report.ts
// The V0 report as Markdown + CSV (spec §4.6). PURE: no clock, no I/O; the date
// and the elapsed time come from the caller.
import { HYPOTHESES, M_HYPOTHESES } from './hypotheses';
import type { HypothesisResult, IccResult, MHypothesisResult, Verdict } from './evaluate';
import { RUN_METRIC_IDS, type RunMetricId, type RunMetrics, type RunReactions } from './runMetrics';
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
  /** Filled by the CLI from a flag: did the author review H1-H11/H1u/H2u BEFORE the full run? */
  hypothesesReviewedBeforeFullRun?: boolean | null;
  /** Changes made to the hypotheses after the first full run (spec §2); none when omitted or empty. */
  hypothesisChanges?: readonly string[];
  /** Per-run M family values (prepareRunMetrics(logs).metrics); empty runs are dropped again here, defensively. */
  runMetrics: Record<StyleId, readonly RunMetrics[]>;
  /** evaluateMHypotheses results. */
  mHypotheses: MHypothesisResult[];
  /** Per-run reaction by attack kind (prepareRunMetrics(logs).reactions); descriptive only. */
  reactions: Record<StyleId, readonly RunReactions[]>;
  /** Verdicts of H1-H11/H1u/H2u in the 0.0.3 pilot, by id; absent/null: the appendix is omitted with a warning. */
  pilotVerdicts?: Record<string, Verdict> | null;
}

export interface ReportFiles {
  'relatorio.md': string;
  'runs.csv': string;
  'rooms.csv': string;
  'hipoteses.csv': string;
  'icc.csv': string;
  'perfil_final.csv': string;
  'events_by_type.csv': string;
  'metricas_run.csv': string;
  'hipoteses_m.csv': string;
  'reacao_por_tipo.csv': string;
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

/** Event counts by `type` for one log: sorted by type (code-unit order), deterministic. */
function eventCounts(log: AgentLog | undefined): [string, number][] {
  const m = new Map<string, number>();
  for (const e of log?.events ?? []) m.set(e.type, (m.get(e.type) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Mean and sample standard deviation (n - 1) of the finite values; sd null with fewer than 2. */
interface Summary {
  nRuns: number;
  nDefined: number;
  mean: number | null;
  sd: number | null;
}

function summarize(values: readonly (number | null)[]): Summary {
  const xs = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const n = xs.length;
  const mean = n === 0 ? null : xs.reduce((a, x) => a + x, 0) / n;
  const sd = n < 2 || mean === null ? null : Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1));
  return { nRuns: values.length, nDefined: n, mean, sd };
}

/** Reaction per attack kind over all runs, weighted by n; kinds in code-unit order. */
function pooledReactions(runs: readonly RunReactions[]): [kind: string, n: number, meanMs: number | null][] {
  const m = new Map<string, { n: number; sum: number }>();
  for (const r of runs) {
    for (const [kind, k] of Object.entries(r.byKind)) {
      if (!(k.n > 0) || !Number.isFinite(k.meanMs)) continue;
      const acc = m.get(kind) ?? { n: 0, sum: 0 };
      acc.n += k.n;
      acc.sum += k.n * k.meanMs;
      m.set(kind, acc);
    }
  }
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([kind, a]) => [kind, a.n, a.n > 0 ? a.sum / a.n : null]);
}

/** Data of the V0.1 sections, derived once in buildReport (empty runs dropped). */
interface V01Data {
  keptMetrics: (s: StyleId) => RunMetrics[];
  reactionsOf: (s: StyleId) => ReturnType<typeof pooledReactions>;
}

export function buildReport(input: ReportInput): ReportFiles {
  const styles = input.config.agents;
  const logOf = (s: StyleId): AgentLog | undefined => input.logs.find((l) => l.styleId === s);
  const agentName = (s: StyleId): string => logOf(s)?.playerId ?? s;
  const kept = (values: Record<StyleId, WindowValue[]>, s: StyleId | undefined): WindowValue[] =>
    s === undefined ? [] : dropEmptyRuns(values[s] ?? [], logOf(s)?.emptyRuns ?? []);
  const notEmpty = (s: StyleId) => {
    const drop = new Set(logOf(s)?.emptyRuns ?? []);
    return (r: { runIdx: number }): boolean => !drop.has(r.runIdx);
  };
  const v01: V01Data = {
    keptMetrics: (s) => (input.runMetrics[s] ?? []).filter(notEmpty(s)),
    reactionsOf: (s) => pooledReactions((input.reactions[s] ?? []).filter(notEmpty(s))),
  };

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
        v.sampleSize,
      ]),
    );
  const roomMeasures = (skill: string): number =>
    styles.reduce((n, st) => n + kept(input.roomValues, st).filter((v) => v.skill === skill && v.domain !== null).length, 0);
  const tail = ['skill', 'domain', 'confidence', 'sampleSize'];

  const hypRows = input.hypotheses.map((r) => {
    const h = HYPOTHESES.find((x) => x.id === r.id);
    const rate = r.style !== undefined;
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
      rate ? null : int(r.nHigher),
      rate ? null : int(r.nLower),
      rate ? null : undefShare(kept(input.runValues, h?.higher), r.skill),
      r.undefinedRateLower,
      r.undefinedRate,
      int(r.nRuns),
      r.verdict,
    ] satisfies CsvCell[];
  });

  const mHypRows = input.mHypotheses.map((r) => {
    const h = M_HYPOTHESES.find((x) => x.id === r.id);
    return [
      r.id,
      r.metric,
      h?.higher ?? null,
      h?.lower ?? null,
      r.delta,
      r.lo,
      r.hi,
      int(r.nHigher),
      int(r.nLower),
      r.undefinedRateHigher,
      r.undefinedRateLower,
      r.verdict,
    ] satisfies CsvCell[];
  });

  return {
    'relatorio.md': markdown(input, logOf, kept, v01),
    'runs.csv': csv(['agent', 'style', 'runIdx', ...tail], windowRows(input.runValues, false)),
    'rooms.csv': csv(['agent', 'style', 'runIdx', 'roomIdx', ...tail], windowRows(input.roomValues, true)),
    'hipoteses.csv': csv(
      [
        'id', 'skill', 'kind', 'higher', 'lower', 'style', 'delta', 'ci_lo', 'ci_hi',
        'n_higher', 'n_lower', 'undefined_rate_higher', 'undefined_rate_lower', 'undefined_rate', 'n_runs', 'verdict',
      ],
      hypRows,
    ),
    'icc.csv': csv(
      ['skill', 'n_agents', 'n_room_measures', 'icc', 'ci_lo', 'ci_hi', 'below_criterion', 'criterion'],
      input.icc.map((r) => [r.skill, int(r.nAgents), int(roomMeasures(r.skill)), r.icc, r.lo, r.hi, r.belowCriterion, ICC_CRITERION]),
    ),
    'events_by_type.csv': csv(
      ['agent', 'type', 'count'],
      styles.flatMap((s) => eventCounts(logOf(s)).map(([type, n]) => [agentName(s), type, int(n)])),
    ),
    'perfil_final.csv': csv(
      ['agent', 'style', 'skill', 'domain', 'confidence', 'deficit', 'sampleSize'],
      styles.flatMap((s) => {
        const live = logOf(s)?.live;
        return REPORT_SKILLS.map((k) => {
          const prior = live !== undefined && live.sampleSize(k, 'trait') === 0;
          return [
            agentName(s),
            s,
            k,
            prior ? null : (live?.domain(k, 'trait') ?? null),
            live ? live.confidence(k, 'trait') : null,
            prior ? null : (live?.deficit(k, 'trait') ?? null),
            live ? live.sampleSize(k, 'trait') : null,
          ];
        });
      }),
    ),
    'metricas_run.csv': csv(
      ['agent', 'style', 'run', 'metric', 'value'],
      styles.flatMap((s) =>
        v01.keptMetrics(s).flatMap((r) => RUN_METRIC_IDS.map((k) => [agentName(s), s, int(r.runIdx), k, r[k]])),
      ),
    ),
    'hipoteses_m.csv': csv(
      [
        'id', 'metric', 'higher', 'lower', 'delta', 'ci_lo', 'ci_hi',
        'n_higher', 'n_lower', 'undefined_rate_higher', 'undefined_rate_lower', 'verdict',
      ],
      mHypRows,
    ),
    'reacao_por_tipo.csv': csv(
      ['agent', 'style', 'kind', 'n', 'mean_ms'],
      styles.flatMap((s) => v01.reactionsOf(s).map(([kind, n, mean]) => [agentName(s), s, kind, int(n), mean])),
    ),
  };
}

// --------------------------------------------------------------- markdown

/** Fraction of the skill's run windows (roomIdx null) with domain null; null when there is none. */
function undefShare(values: readonly WindowValue[], skill: string): number | null {
  const runs = values.filter((v) => v.roomIdx === null && v.skill === skill);
  return runs.length === 0 ? null : runs.filter((v) => v.domain === null).length / runs.length;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function markdown(
  input: ReportInput,
  logOf: (s: StyleId) => AgentLog | undefined,
  kept: (v: Record<StyleId, WindowValue[]>, s: StyleId | undefined) => WindowValue[],
  v01: V01Data,
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
  const changes = input.hypothesisChanges ?? [];
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
    `- Tempo decorrido: ${Math.round(input.elapsedMs)} ms`,
    `- Hipóteses H1–H11 e H1u, H2u (${HYPOTHESES.length} itens) pré-registradas; revisadas pelo autor ANTES da execução completa: ${reviewed}`,
    '- Versão final do pré-registro (revisão do autor em 2026-10-20, depois do piloto e antes da execução completa): H1 recebeu a cláusula "ou indefinido"; H12 foi retirada por redundância com H2u.',
    '- A revisão das hipóteses pelo autor aconteceu DEPOIS do piloto de calibração dos agentes.',
    `- Alterações nas hipóteses depois da primeira execução completa: ${changes.length === 0 ? 'nenhuma registrada' : changes.join('; ')}`,
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
      ['Agente', 'Run.start (soma)', 'Completas', 'Truncadas', 'Vazias (descartadas)', 'Sessões', 'Tempo simulado (s)'],
      styles.flatMap((s) => {
        const l = logOf(s);
        if (!l) return [[s, '—', '—', '—', '—', '—', '—']];
        const n = l.completedRuns + l.truncatedRuns + l.emptyRuns.length;
        return [[s, `${n}`, `${l.completedRuns}`, `${l.truncatedRuns}`, `${l.emptyRuns.length}`, `${l.sessions}`, md(l.simulatedMs / 1000, 1)]];
      }),
    ),
    '',
    'Perfil final (acumulador ao vivo, relógio de traço; déficit = 1 − domínio). Linhas com amostra 0 estão "a priori (sem dados)": o domínio e o déficit são o prior da Beta (ou indefinidos) e aparecem como —, sem leitura como desempenho; a confiança é 0. — também marca o indefinido.',
    '',
    table(
      ['Agente', 'Dimensão', 'Amostra', 'Domínio', 'Confiança', 'Déficit', 'Observação'],
      styles.flatMap((s) => {
        const live = logOf(s)?.live;
        return REPORT_SKILLS.map((k) => {
          const prior = live !== undefined && live.sampleSize(k, 'trait') === 0;
          return [
            s,
            k,
            md(live ? live.sampleSize(k, 'trait') : null),
            prior ? '—' : md(live?.domain(k, 'trait')),
            md(live ? live.confidence(k, 'trait') : null),
            prior ? '—' : md(live?.deficit(k, 'trait')),
            prior ? 'a priori (sem dados)' : '',
          ];
        });
      }),
    ),
    '',
  );

  // 3
  out.push(
    '## 3. Separação de estilos',
    '',
    `Veredito: confirmada (IC 95% bootstrap do delta de Cliff acima de 0 e delta ≥ ${md(MIN_DELTA, 2)}, ou a taxa de indefinição pedida); refutada; indefinida (dados insuficientes: menos de ${MIN_VALUES} valores definidos por grupo, ou menos de ${MIN_VALUES} runs nas hipóteses de taxa de indefinição). Hipótese refutada ou indefinida é resultado, não defeito. N definidos = valores por run com domínio definido em cada grupo; Indef. = fração das runs do grupo com domínio indefinido.`,
    '',
    'Linhas H1u e H2u (taxa de indefinição): as colunas Estilo, Indef. estilo e N runs substituem Maior/Menor, delta e IC. H1 e H5 também são confirmadas se o grupo menor tiver pelo menos 10 runs e for indefinido em pelo menos 95% delas (isto substitui só o teste do delta: o grupo maior ainda precisa de pelo menos 10 valores definidos); H6 NÃO tem a cláusula "ou indefinido".',
    '',
    table(
      ['Id', 'Dimensão', 'Maior', 'Menor', 'Estilo', 'Delta', 'IC 95%', 'N definidos (maior)', 'N definidos (menor)', 'Indef. maior', 'Indef. menor', 'Indef. estilo', 'N runs estilo', 'Veredito'],
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
          rate ? '—' : mdPct(undefShare(kept(input.runValues, h?.higher), r.skill)),
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
      ['Dimensão', 'ICC', 'IC 95%', 'N agentes', 'N medidas por sala', `< ${md(ICC_CRITERION, 2)} (não aplicado)`],
      input.icc.map((r) => [
        r.skill,
        md(r.icc),
        r.lo === null && r.hi === null ? '—' : `[${md(r.lo)}; ${md(r.hi)}]`,
        `${r.nAgents}`,
        `${styles.reduce((n, st) => n + kept(input.roomValues, st).filter((v) => v.skill === r.skill && v.domain !== null).length, 0)}`,
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
    'Contagens por tipo de evento (todos os eventos do log de cada agente, em ordem alfabética do tipo):',
    '',
    table(
      ['Agente', 'Tipo de evento', 'Contagem'],
      styles.flatMap((s) => {
        const counts = eventCounts(logOf(s));
        const total = counts.reduce((a, [, n]) => a + n, 0);
        return [...counts.map(([t, n]) => [(logOf(s)?.playerId ?? s), t, String(n)]), [(logOf(s)?.playerId ?? s), '**total**', String(total)]];
      }),
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
    '- Viés de seleção em defensive_repertoire (H5, H6): só entram runs com pelo menos 2 rótulos de defesa; o agressivo defende pouco, então o grupo medido pode não representar todas as suas runs.',
    `- As ${HYPOTHESES.length} hipóteses são testadas sem correção para comparações múltiplas (V0 exploratório; com Bonferroni o alfa seria 0,05/${HYPOTHESES.length}).`,
    '- A elite não adapta (peso fixo).',
    '',
  );

  // 7
  out.push(
    '## 7. Métricas de estamina e de itens por estilo',
    '',
    'Valores por run calculados com o mesmo acumulador do painel de análise (`WindowAccumulator`), sobre os eventos de cada run (runs vazias descartadas). Média e desvio-padrão amostral dos valores definidos; — marca o indefinido (sem amostra, ou total de gasto 0 nas participações).',
    '',
    ...RUN_METRIC_IDS.map((k) => `- \`${k}\`: ${METRIC_LABELS[k]}`),
    '',
    table(
      ['Estilo', 'Métrica', 'N runs', 'N definidos', 'Média', 'Desvio'],
      styles.flatMap((s) => {
        const runs = v01.keptMetrics(s);
        return RUN_METRIC_IDS.map((k) => {
          const sm = summarize(runs.map((r) => r[k]));
          return [s, k, `${sm.nRuns}`, `${sm.nDefined}`, md(sm.mean), md(sm.sd)];
        });
      }),
    ),
    '',
  );

  // 8
  out.push(
    '## 8. Família M (métricas novas)',
    '',
    `Unidade: valor da métrica por run (seção 7). Critério igual ao da família P: confirmada se o IC 95% bootstrap do delta de Cliff (maior vs menor) fica acima de 0 e delta ≥ ${md(MIN_DELTA, 2)}; indefinida com menos de ${MIN_VALUES} valores definidos em algum grupo (valor indefinido = métrica sem amostra na run); refutada nos demais casos. A família M é palpite do Claude revisado pelo autor; hipótese refutada ou indefinida é resultado, não defeito.`,
    '',
    table(
      ['Id', 'Métrica', 'Maior', 'Menor', 'Delta', 'IC 95%', 'N definidos (maior)', 'N definidos (menor)', 'Indef. maior', 'Indef. menor', 'Veredito'],
      input.mHypotheses.map((r) => {
        const h = M_HYPOTHESES.find((x) => x.id === r.id);
        return [
          r.id,
          r.metric,
          h?.higher ?? '—',
          h?.lower ?? '—',
          md(r.delta),
          r.lo === null && r.hi === null ? '—' : `[${md(r.lo)}; ${md(r.hi)}]`,
          `${r.nHigher}`,
          `${r.nLower}`,
          mdPct(r.undefinedRateHigher),
          mdPct(r.undefinedRateLower),
          r.verdict,
        ];
      }),
    ),
    '',
  );

  // 9
  out.push(
    '## 9. Reação por tipo de ataque (descritiva)',
    '',
    'Tempo do início do ataque do inimigo até a primeira esquiva dentro da janela de esquiva (`reaction.byKind` do painel), por tipo de ataque como registrado no log, somado sobre as runs e ponderado pelo número de reações. Descritiva, sem hipótese: as telegraphs têm durações diferentes, então só se compara dentro de um mesmo tipo.',
    '',
    table(
      ['Estilo', 'Tipo de ataque', 'N reações', 'Média (ms)'],
      styles.flatMap((s) => {
        const rows = v01.reactionsOf(s);
        return rows.length === 0 ? [[s, '—', '0', '—']] : rows.map(([kind, n, mean]) => [s, kind, `${n}`, md(mean, 1)]);
      }),
    ),
    '',
  );

  // appendix
  out.push('## Apêndice A. Comparação com o piloto 0.0.3 (descritiva)', '');
  const pilot = input.pilotVerdicts;
  if (pilot === undefined || pilot === null) {
    out.push('Aviso: piloto 0.0.3 não encontrado; a comparação foi omitida.', '');
  } else {
    out.push(
      'Veredito de cada hipótese da família P no piloto 0.0.3 e nesta execução, lado a lado. Apenas descritivo (versões não comparáveis: as mecânicas e os agentes mudaram); as hipóteses da família P já tinham sido vistas na 0.0.3.',
      '',
      table(
        ['Id', 'Dimensão', 'Veredito 0.0.3 (piloto)', 'Veredito atual'],
        HYPOTHESES.map((h) => [
          h.id,
          h.skill,
          pilot[h.id] ?? '—',
          input.hypotheses.find((r) => r.id === h.id)?.verdict ?? '—',
        ]),
      ),
      '',
    );
  }

  return out.join('\n');
}

const METRIC_LABELS: Record<RunMetricId, string> = {
  staminaSpentPerMinute: 'gasto de estamina por minuto',
  staminaHighFraction: 'fração do tempo com estamina ≥ 80% (120 de 150)',
  dodgeSpendShare: 'participação da esquiva no gasto de estamina (dodge / total)',
  blockSpendShare: 'participação do bloqueio no gasto de estamina (block / total)',
  itemPickRate: 'taxa de coleta de itens (coletados / (coletados + expirados por tempo))',
};
