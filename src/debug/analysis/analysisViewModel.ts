// Pure view model for the analysis HUD: all formatting and the '—' rule live here. No Phaser, no DOM.
import type { MetricsSnapshot, WindowMetrics, Distribution, OppStats } from './metricsTypes';
import { WINDOW_IDS } from './metricsTypes';
import type { ProfileView } from '../../profile/profileView';
import { PROFILE_SKILLS } from '../../profile/profileView';
import type { TapeEntry } from './eventTape';
import type { SessionStatus } from '../../scenes/session/sessionController';
import { DASH, fmtNum, fmtMs, fmtPercent, fmtSample } from './format';

export interface LiveState {
  keysDown: string[];
  move: { dx: number; dy: number };
  aimDeg: number;
  weaponId: string;
  playerState: string;
  enemyState: string;
  playerHp: number;
  enemyHp: number;
  stamina: number;
}

export interface PerfStats { fps: number; stepMs: number }

export interface AnalysisInput {
  metrics: MetricsSnapshot;
  profile: ProfileView;
  live: LiveState;
  tape: readonly TapeEntry[];
  status: SessionStatus;
  perf: PerfStats;
}

export interface ViewRow { id: string; cells: string[] }

export interface ViewSection {
  id: 'inputs' | 'events' | 'metrics' | 'stamina' | 'items' | 'profile' | 'registry' | 'predictor' | 'perf';
  title: string;
  columns: string[];
  rows: ViewRow[];
}

export type AnalysisView = ViewSection[];

export interface CellPatch { sectionId: string; rowId: string; cell: number; text: string }

const CONFIDENCE_TARGET = 0.6;

const dist = (d: Distribution): string => {
  const parts = Object.keys(d.counts).sort().map((k) => `${k}:${d.counts[k]}`);
  return `${parts.length ? parts.join(' ') : DASH} H=${fmtNum(d.entropy)}`;
};

const oppN = (o: OppStats): number => o.taken + o.missed + o.expired;
const oppBoth = (w: WindowMetrics): number => oppN(w.opportunities.dodge) + oppN(w.opportunities.punish);
const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);

const METRIC_ROWS: { id: string; name: string; cell: (w: WindowMetrics) => string }[] = [
  { id: 'm1', name: 'M1 velocidade méd/mov (u/s, 4 Hz)', cell: (w) => `${fmtNum(w.speed.avg)}/${fmtNum(w.speed.moving)} ${fmtSample(w.samples)}` },
  { id: 'm2', name: 'M2 distância média (u, 4 Hz)', cell: (w) => `${fmtNum(w.meanDistance)} ${fmtSample(w.samples)}` },
  { id: 'm4', name: 'M4 ações/min · intervalo (ms)', cell: (w) => `${fmtNum(w.actions.perMinute)} · ${fmtMs(w.actions.meanIntervalMs)} ${fmtSample(w.actions.count)}` },
  { id: 'm5', name: 'M5 ações | armas (cru)', cell: (w) => `${dist(w.actions.byType)} | ${dist(w.actions.byWeapon)} ${fmtSample(w.actions.count)}` },
  { id: 'm6', name: 'M6 defesas (cru)', cell: (w) => `${dist(w.defenses)} ${fmtSample(sum(w.defenses.counts))}` },
  { id: 'm7', name: 'M7 aproveitamento esq/pun', cell: (w) => `${fmtPercent(w.opportunities.dodge.rate)}/${fmtPercent(w.opportunities.punish.rate)} ${fmtSample(oppBoth(w))}` },
  { id: 'm8', name: 'M8 omissão esq/pun', cell: (w) => `${fmtPercent(w.opportunities.dodge.omission)}/${fmtPercent(w.opportunities.punish.omission)} ${fmtSample(oppBoth(w))}` },
  { id: 'm9', name: 'M9 reação à esquiva méd/med (ms)', cell: (w) => `${fmtMs(w.reaction.meanMs)}/${fmtMs(w.reaction.medianMs)} ${fmtSample(w.reaction.n)}` },
  { id: 'm10', name: 'M10 cancelamentos (por ação)', cell: (w) => `${w.cancels.total} (${fmtNum(w.cancels.perAction)}) ${fmtSample(w.actions.count)}` },
  { id: 'm11', name: 'M11 dano causado/sofrido (razão)', cell: (w) => `${fmtNum(w.damage.dealt, 0)}/${fmtNum(w.damage.taken, 0)} (${fmtNum(w.damage.ratio)}) ${DASH}` },
  { id: 'm12', name: 'M12 ciclo encontro/run', cell: (w) => `${fmtMs(w.cycle.meanEncounterMs)}/${fmtMs(w.cycle.meanRunMs)} ${fmtSample(w.cycle.encounters)}` },
  { id: 'm14', name: 'M14 ociosidade (4 Hz)', cell: (w) => `${fmtPercent(w.idleFraction)} ${fmtSample(w.samples)}` },
  { id: 'm15', name: 'M15 cobertura (4 Hz)', cell: (w) => `${fmtPercent(w.coverage)} ${fmtSample(w.samples)}` },
];

// The profile clocks are not the metric windows (state decays per encounter, trait per room), so each
// cell names its clock and the window columns stay '—'.
function profileMetricRow(id: string, name: string, skill: string, p: ProfileView): ViewRow {
  const c = (clock: 'trait' | 'state'): string =>
    `${clock === 'state' ? 'estado' : 'traço'} ${fmtPercent(p.domain(skill, clock))} ${fmtSample(p.sampleSize(skill, clock))}`;
  return { id, cells: [name, DASH, DASH, c('state'), c('trait')] };
}

function metricsSection(m: MetricsSnapshot, p: ProfileView): ViewSection {
  const rows: ViewRow[] = METRIC_ROWS.map((r) => ({
    id: r.id,
    cells: [r.name, ...WINDOW_IDS.map((w) => r.cell(m.windows[w]))],
  }));
  rows.push(profileMetricRow('m3', 'M3 fração ao alcance (decaído)', 'distance', p));
  rows.push(profileMetricRow('m13', 'M13 pacientes (decaído)', 'patience', p));
  rows.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  return { id: 'metrics', title: 'Métricas', columns: ['métrica', 'encontro', 'run', 'sessão', 'histórico'], rows };
}

const SPEND_LABEL: [string, 'attack' | 'sprint' | 'dodge' | 'block'][] = [
  ['atq', 'attack'], ['corr', 'sprint'], ['esq', 'dodge'], ['def', 'block'],
];
const USE_LABEL: [string, 'heal' | 'power' | 'bomb'][] = [['cura', 'heal'], ['poder', 'power'], ['bomba', 'bomb']];
const SAMPLE_OF = (w: WindowMetrics): string => fmtSample(w.samples);

const STAMINA_ROWS: { id: string; name: string; cell: (w: WindowMetrics) => string }[] = [
  { id: 's1', name: 'estamina média', cell: (w) => `${fmtNum(w.stamina.meanLevel, 1)} ${SAMPLE_OF(w)}` },
  { id: 's2', name: 'estamina ≥ 80%', cell: (w) => `${fmtPercent(w.stamina.highFraction)} ${SAMPLE_OF(w)}` },
  { id: 's3', name: 'tempo exausto', cell: (w) => `${fmtPercent(w.stamina.exhaustedFraction)} ${SAMPLE_OF(w)}` },
  { id: 's4', name: 'gasto/min', cell: (w) => `${fmtNum(w.stamina.spentPerMinute, 1)} ${SAMPLE_OF(w)}` },
  { id: 's5', name: 'gasto por tipo', cell: (w) => SPEND_LABEL.map(([l, k]) => `${l}:${fmtNum(w.stamina.spentByKind[k], 0)}`).join(' ') },
  { id: 's6', name: 'negadas', cell: (w) => String(w.stamina.denied) },
  { id: 's7', name: 'guard breaks', cell: (w) => String(w.stamina.guardBreaks) },
  { id: 's8', name: 'perfect dodges', cell: (w) => `${w.stamina.perfectDodges}/${w.stamina.dodges} (${fmtPercent(w.stamina.perfectRate)}) ${fmtSample(w.stamina.dodges)}` },
];

const ITEM_ROWS: { id: string; name: string; cell: (w: WindowMetrics) => string }[] = [
  { id: 'i1', name: 'itens oferecidos/pegos', cell: (w) => `${w.items.spawned}/${w.items.picked} (expirados ${w.items.expired})` },
  { id: 'i2', name: 'itens taxa de coleta', cell: (w) => `${fmtPercent(w.items.pickRate)} ${fmtSample(w.items.picked + w.items.expired)}` },
  { id: 'i3', name: 'itens espera média', cell: (w) => `${fmtMs(w.items.meanWaitMs)} ${fmtSample(w.items.picked)}` },
  { id: 'i4', name: 'usos por tipo', cell: (w) => USE_LABEL.map(([l, k]) => `${l}:${w.items.uses[k]}`).join(' ') },
  { id: 'i5', name: 'usos desperdiçados', cell: (w) => `${w.items.wastedUses} ${fmtSample(sum(w.items.uses))}` },
  { id: 'i6', name: 'itens retenção média', cell: (w) => `${fmtMs(w.items.meanHeldMs)} ${fmtSample(sum(w.items.uses))}` },
];

function windowSection(
  id: 'stamina' | 'items', title: string,
  defs: { id: string; name: string; cell: (w: WindowMetrics) => string }[], m: MetricsSnapshot,
): ViewSection {
  return {
    id, title, columns: ['métrica', 'encontro', 'run', 'sessão', 'histórico'],
    rows: defs.map((r) => ({ id: r.id, cells: [r.name, ...WINDOW_IDS.map((w) => r.cell(m.windows[w]))] })),
  };
}

function profileSection(p: ProfileView): ViewSection {
  const rows: ViewRow[] = [];
  for (const skill of PROFILE_SKILLS) {
    for (const clock of ['trait', 'state'] as const) {
      const conf = p.confidence(skill, clock);
      rows.push({
        id: `${skill}.${clock}`,
        cells: [
          skill,
          clock === 'trait' ? 'traço' : 'estado',
          fmtNum(p.domain(skill, clock)),
          fmtNum(conf),
          fmtNum(p.deficit(skill, clock)),
          fmtNum(p.omission(skill, clock)),
          fmtSample(p.sampleSize(skill, clock)),
          fmtPercent(Math.min(1, conf / CONFIDENCE_TARGET)),
        ],
      });
    }
  }
  rows.push({ id: 'dim7', cells: ['dimensão 7', 'não ligada', DASH, DASH, DASH, DASH, DASH, DASH] });
  return {
    id: 'profile', title: 'Perfil',
    columns: ['dimensão', 'relógio', 'domínio', 'confiança', 'déficit', 'omissão', 'amostra', 'progresso'],
    rows,
  };
}

const short = (id: string): string => id.slice(0, 8);

function registrySection(s: SessionStatus): ViewSection {
  const r = (id: string, label: string, v: string | number): ViewRow => ({ id, cells: [label, String(v)] });
  return {
    id: 'registry', title: 'Registro', columns: ['campo', 'valor'],
    rows: [
      r('version', 'versão', s.gameVersion),
      r('schema', 'schema_v', s.schemaV),
      r('player', 'jogador', short(s.playerId)),
      r('session', 'sessão', short(s.sessionId)),
      r('run', 'run', s.runIdx),
      r('room', 'sala', s.roomIdx),
      r('enc', 'encontro', s.encIdx),
      r('seq', 'seq', s.nextSeq),
      r('buffered', 'no buffer', s.buffered),
      r('store', 'armazenamento', s.store === 'indexeddb' ? 'IndexedDB' : 'memória'),
      r('persistent', 'persistente', s.persistent ? 'sim' : 'não'),
      r('failures', 'falhas de gravação (episódios)', s.writeFailures),
    ],
  };
}

function inputsSection(l: LiveState): ViewSection {
  const r = (id: string, label: string, v: string): ViewRow => ({ id, cells: [label, v] });
  return {
    id: 'inputs', title: 'Entradas', columns: ['campo', 'valor'],
    rows: [
      r('keys', 'teclas', l.keysDown.length ? l.keysDown.join(' ') : DASH),
      r('move', 'movimento', `${fmtNum(l.move.dx)}, ${fmtNum(l.move.dy)}`),
      r('aim', 'mira (graus)', fmtNum(l.aimDeg, 0)),
      r('weapon', 'arma', l.weaponId),
      r('pstate', 'estado jogador', l.playerState),
      r('estate', 'estado inimigo', l.enemyState),
      r('php', 'vida jogador', fmtNum(l.playerHp, 0)),
      r('ehp', 'vida inimigo', fmtNum(l.enemyHp, 0)),
      r('stamina', 'estamina', fmtNum(l.stamina, 0)),
    ],
  };
}

function eventsSection(m: MetricsSnapshot, tape: readonly TapeEntry[]): ViewSection {
  const rows: ViewRow[] = [];
  for (const type of Object.keys(m.eventCounts).sort()) {
    rows.push({ id: `count.${type}`, cells: ['contagem', type, String(m.eventCounts[type]), ''] });
  }
  for (const o of m.openWindows) {
    rows.push({ id: `open.${o.opp_id}`, cells: ['janela aberta', o.opp_type, o.src, fmtMs(o.window_ms)] });
  }
  for (const e of tape) {
    rows.push({ id: `tape.${e.seq}`, cells: [`#${e.seq}`, fmtNum(e.t_ms, 0), e.type, e.summary || DASH] });
  }
  return { id: 'events', title: 'Eventos', columns: ['item', 'a', 'b', 'c'], rows };
}

export function buildAnalysisView(input: AnalysisInput): AnalysisView {
  const { metrics, profile, live, tape, status, perf } = input;
  return [
    inputsSection(live),
    eventsSection(metrics, tape),
    metricsSection(metrics, profile),
    windowSection('stamina', 'Estamina', STAMINA_ROWS, metrics),
    windowSection('items', 'Itens', ITEM_ROWS, metrics),
    profileSection(profile),
    registrySection(status),
    { id: 'predictor', title: 'Preditor', columns: ['estado'], rows: [{ id: 'status', cells: ['não implementado (5b)'] }] },
    {
      id: 'perf', title: 'Desempenho', columns: ['campo', 'valor'],
      rows: [
        { id: 'fps', cells: ['quadros/s', fmtNum(perf.fps, 0)] },
        { id: 'step', cells: ['passo (ms)', fmtNum(perf.stepMs)] },
      ],
    },
  ];
}

/** Only the cells whose text changed; every cell of new rows; everything when prev is null. */
export function diffView(prev: AnalysisView | null, next: AnalysisView): CellPatch[] {
  const patches: CellPatch[] = [];
  for (const sec of next) {
    const before = new Map<string, ViewRow>();
    prev?.find((s) => s.id === sec.id)?.rows.forEach((r) => before.set(r.id, r));
    for (const row of sec.rows) {
      const old = before.get(row.id);
      row.cells.forEach((text, cell) => {
        if (old === undefined || old.cells[cell] !== text) {
          patches.push({ sectionId: sec.id, rowId: row.id, cell, text });
        }
      });
    }
  }
  return patches;
}
