# E1: HUD de análise e cena modularizada — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a HUD de análise (entradas, saídas e métricas derivadas do log) e dividir `ArenaScene` em módulos testáveis, sem mudar nenhuma regra de jogo.

**Architecture:** Um `MetricsAggregator` puro dobra o fluxo de `LoggedEvent` (o mesmo que o gravador grava) em quatro janelas (encontro, run, sessão, histórico); um *view model* puro formata; um painel HTML só desenha. A lógica de boot, persistência, exportar e importar sai da cena para um `SessionController` testado com plataforma falsa.

**Tech Stack:** TypeScript 5.9 estrito, Vitest 2 (ambiente `node`), Phaser 3.90 (só na camada de cena). Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-16-e1-hud-analise-design.md` (ler junto). Definições exatas das métricas: spec §4.3. Catálogo: `Contexto_pesquisa/documento-tecnico-mestre.md` §4.7.

**Branch:** `e1-hud-analise` (criada de `master` em `f9df2fb`).

## Global Constraints

- **A lógica não muda.** `GAME_VERSION` continua `0.0.2+combatB`. `replay.test.ts`, `bootstrap.test.ts`, `encounter.test.ts` e `runDirector.test.ts` passam **sem alteração de asserções** (só se acrescentam testes).
- Sem dependência nova (nem `happy-dom`). Módulos puros **não** importam Phaser nem tocam o DOM; só `src/scenes/**` e `src/debug/analysis/analysisPanel.ts` usam Phaser ou DOM.
- Constantes: `MOVING_SPEED_EPS = 5` u/s; `IDLE_THRESHOLD_MS = 3000`; `CELL_SIZE = 64`; `ARENA_CELLS = ceil(1600/64) × ceil(1200/64) = 25 × 19 = 475` (derivar de `ARENA_BOUNDS`); fita com **40** entradas; painel atualiza a **10 Hz** (100 ms) e só visível; gravação a cada **2000 ms**.
- Valor ausente é `—`, nunca `0` nem `NaN`. Números em pt-BR (`0,85`), formatados por função própria (sem `Intl`).
- **Tab** alterna o painel (começa oculto, capturada do navegador, `pointer-events: none`); **`H`** alterna a ajuda de controles. `ArenaScene.ts` termina com **≤ 200 linhas**.
- Commits: Conventional Commits em inglês, **sem** linha `Co-Authored-By` nem menção a Claude/Anthropic. As mensagens deste plano são as que o autor aprova ao aprovar o plano.
- Testes rodam com `npm test`; antes de cada commit: `npm test` e `npm run typecheck` limpos.

## Review Focus

1. **Eventos malformados ou de outro jogador** (NaN, posições com aridade errada, tipo desconhecido, log importado): ignorados e **contados**, nunca lançam exceção e nunca imprimem `NaN` no painel. → Tasks 2 e 8.
2. **Primeira abertura e janelas vazias**: todo valor derivado é `null` e aparece como `—`; nenhuma divisão por zero. → Tasks 2, 3, 4 e 8.
3. **Troca de sessão**: `t_ms` reinicia em 0; velocidade, ociosidade e tempo decorrido não usam deltas entre sessões. → Tasks 2 e 3.
4. **Reinício da cena durante importação**: sem assinaturas duplicadas e sem perder eventos. → Task 7.
5. **Histórico grande no boot**: dobrar 200 000 eventos não pode travar nem estourar a memória; custo O(1) por evento. → Task 2.

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/profile/profileView.ts` | criar | `ProfileView` (leitura) e `PROFILE_SKILLS` |
| `src/telemetry/telemetryRecorder.ts`, `profile/profileAccumulator.ts`, `telemetry/bootstrap.ts` | alterar (aditivo) | `subscribe`, `bufferedCount`, `nextSeq`; `sampleSize`; `history` |
| `src/debug/analysis/metricsTypes.ts` | criar | Tipos e constantes das métricas |
| `src/debug/analysis/eventGuards.ts` | criar | `isWellFormed(ev)` |
| `src/debug/analysis/streamTracker.ts` | criar | Estado compartilhado entre janelas; devolve `Derived` por evento |
| `src/debug/analysis/windowAccumulator.ts` | criar | Somas por janela e `snapshot()` |
| `src/debug/analysis/metricsAggregator.ts` | criar | Quatro janelas, contadores, janelas abertas; `metricsFromLog` |
| `src/debug/analysis/eventTape.ts` | criar | Fita dos últimos 40 eventos |
| `src/debug/analysis/format.ts`, `analysisViewModel.ts` | criar | Formatação e *view model* puros; `diffView` |
| `src/debug/analysis/analysisPanel.ts` | criar | Painel em DOM e `RefreshGate` |
| `src/debug/analysis/testing/events.ts` | criar | Fábrica `mk` de eventos de teste |
| `src/telemetry/testing/scriptedBot.ts` | criar | Bot roteirizado extraído de `replay.test.ts` |
| `src/scenes/session/{platform,sessionController,browserPlatform}.ts` | criar | Boot, gravação, exportar e importar |
| `src/scenes/input/{mapMovement,playerInput,hotkeys}.ts` | criar | Entrada |
| `src/scenes/view/{debugDraw,cameraRig,worldView}.ts`, `scenes/hud/gameplayHud.ts` | criar | Visual |
| `src/scenes/ArenaScene.ts` | reescrever | Orquestrador (≤ 200 linhas) |
| `src/debug/{hudState,opportunityOverlay}.ts` (+ testes) | remover | Substituídos pelo painel |
| `src/ai/rules/assaltanteRules.test.ts`, `public/assets/{README,LICENSES}.md`, `public/assets/_unused/` | criar / atualizar / remover | Limpeza |

---

### Task 1: Ganchos aditivos de leitura e assinatura

**Files:**
- Create: `src/profile/profileView.ts`
- Modify: `src/telemetry/telemetryRecorder.ts`, `src/profile/profileAccumulator.ts`, `src/telemetry/bootstrap.ts`
- Test: `src/telemetry/telemetryRecorder.test.ts`, `src/profile/profileAccumulator.test.ts`, `src/telemetry/bootstrap.test.ts` (acrescentar casos)

**Interfaces:**
- Produces: `TelemetryRecorder.subscribe(listener: (e: LoggedEvent) => void): () => void` (chamado ao fim de `log()`, para todo evento, inclusive `obs.*` e `pos.sample`); `get bufferedCount(): number`; `get nextSeq(): number`.
- Produces: `ProfileView { domain, confidence, deficit, omission(skill, clock), sampleSize(skill, clock): number }`; `PROFILE_SKILLS: readonly SkillId[] = ['weapon_repertoire','action_repertoire','punish','defensive_repertoire','distance','patience']`; `ProfileAccumulator implements ProfileView`.
- Produces: `BootState.history: LoggedEvent[]`.

- [ ] **Step 1: Escrever os testes que falham**
  - recorder: `'subscribe delivers every logged event in order and unsubscribe stops it'`: dois `rec.log('x', {})`; o ouvinte recebe `seq` 0 e 1; após `unsubscribe()` um terceiro log não chega.
  - recorder: `'bufferedCount and nextSeq follow log, drain and requeue'`: após 2 logs `bufferedCount === 2` e `nextSeq === 2`; após `drain()` `bufferedCount === 0` e `nextSeq === 2`; `requeue(lote)` volta a 2.
  - perfil: `'sampleSize is the folded denominator for ratios and the total count for entropy skills, per clock'`: `record('punish',1,1)` ×2 → `sampleSize('punish','trait') === 0` antes da fronteira; após `applyRoomBoundary()` → `2`; `sampleSize('punish','state') === 0` até `applyEncounterBoundary()`; `recordAction('light','sword_shield')` ×3 + `applyRoomBoundary()` → `sampleSize('action_repertoire','trait') === 3`; skill desconhecida → `0`.
  - bootstrap: `'history holds only the current player events and is empty on fallback'`: armazenamento com eventos de `'me'` e `'other'` → `boot.history.every(e => e.player_id === 'me')` e `length` igual ao de `'me'`; armazenamento que lança em `readAll` → `history` é `[]`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/telemetry/telemetryRecorder.test.ts src/profile/profileAccumulator.test.ts src/telemetry/bootstrap.test.ts` → FAIL (membros inexistentes).
- [ ] **Step 3: Implementar** as assinaturas acima. `sampleSize`: entropia → `acc.totalCount(clock)`; razão → `domain.den` do relógio, `0` se ausente. `history`: o `events` já lido, filtrado por `playerId` (também no ramo de fallback: `[]`).
- [ ] **Step 4: Rodar a suíte inteira** — `npm test` → todos passam (os testes de replay e bootstrap existentes sem alteração).
- [ ] **Step 5: Commit** — `git add src/profile src/telemetry && git commit -m "feat: add recorder subscription, profile read view and boot history"`

---

### Task 2: Núcleo do agregador (janelas, ciclo, contadores, guardas)

**Files:**
- Create: `src/debug/analysis/{metricsTypes,eventGuards,streamTracker,windowAccumulator,metricsAggregator}.ts`, `src/debug/analysis/testing/events.ts`
- Test: `src/debug/analysis/eventGuards.test.ts`, `src/debug/analysis/metricsAggregator.test.ts`

**Interfaces:**
- Consumes: `LoggedEvent` (`telemetry/schema.ts`), `ARENA_BOUNDS`.
- Produces: `WINDOW_IDS = ['encounter','run','session','history'] as const`, `WindowId`; `WindowMetrics` com **todos** os campos da spec §4.1–§4.3 (`elapsedMs`, `events`, `samples`, `speed {avg,moving}`, `meanDistance`, `actions {count,perMinute,meanIntervalMs,byType,byWeapon}`, `defenses`, `opportunities {dodge,punish}`, `reaction {n,meanMs,medianMs}`, `cancels`, `damage`, `cycle {encounters,meanEncounterMs,runs,meanRunMs,meanRoomsPerRun}`, `idleFraction`, `coverage`) — os campos das Tasks 3 e 4 existem aqui com valor neutro (`0` ou `null`); `MetricsSnapshot { windows, eventCounts, openWindows, malformed }`; `OpenOpportunity { opp_id, opp_type, src, window_ms, openedAtMs }`.
- Produces: `isWellFormed(ev: LoggedEvent): boolean`; `StreamTracker.observe(ev): Derived` (nesta task só `encounterMs: number | null`); `WindowAccumulator { apply(ev, d: Derived): void; reset(): void; snapshot(): WindowMetrics }`; `MetricsAggregator { apply(ev), applyAll(evs), snapshot(): MetricsSnapshot }`; `metricsFromLog(events): MetricsSnapshot`; `mk(type: string, t_ms: number, payload?: Record<string, unknown>, env?: Partial<Envelope>): LoggedEvent` (padrões: `v:2`, `player_id:'p'`, `session_id:'s'`, índices 0, `seq` crescente).

- [ ] **Step 1: Escrever os testes que falham**
  - guardas: `'accepts a well-formed pos.sample and rejects NaN, wrong arity and non-array positions'` (`p:[1,2]`, `e:[3,4]` ok; `p:[NaN,2]`, `p:[1]`, `p:'x'` → false); `'rejects player.action without string actionType and weaponId'`; `'rejects opp.close with unknown outcome or opp_type'`; `'rejects player.cancel with unknown by'`; `'passes event types the metrics do not read'` (`obs.record` → true).
  - agregador: `'windows restart on their own boundary events and history never restarts'`: sessão com `session.start`, `run.start`, `encounter.start`, 2 ações, outro `encounter.start`, 1 ação → `windows.encounter.actions.count === 1`, `windows.run.actions.count === 3`, `windows.history.actions.count === 3`; novo `run.start` → `windows.run` zera.
  - `'elapsedMs sums t_ms deltas inside a session and skips the jump across sessions'`: sessão `s1` com eventos em 0, 1000, 2000 e `s2` com 0, 500 → `windows.history.elapsedMs === 2500`.
  - `'cycle metrics: encounter duration, run duration and rooms per run'`: `encounter.start` t=1000 e `encounter.end` t=4000 → `meanEncounterMs === 3000`, `cycle.encounters === 1`; `run.end {duration_ms:60000, rooms_cleared:2, encounters_cleared:6}` → `meanRunMs === 60000`, `meanRoomsPerRun === 2`.
  - `'eventCounts by type; malformed events are ignored and counted'`: um `pos.sample` com `p:[NaN,0]` → `malformed === 1` e `eventCounts['pos.sample']` não o conta.
  - `'openWindows follows opp.open and opp.close'`.
  - `'an empty aggregator has only null or zero values, never NaN'` (varrer o objeto recursivamente).
  - `'applyAll(history) then apply(live) equals metricsFromLog(history + live)'`.
  - `'folds 200000 synthetic events without throwing'` (eventos `pos.sample` sintéticos; sem asserção de tempo).
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/debug/analysis` → FAIL (módulos inexistentes).
- [ ] **Step 3: Implementar** os tipos, `isWellFormed` (valida só os tipos que as métricas leem: `pos.sample`, `player.action`, `player.cancel`, `player.defense`, `player.hurt`, `enemy.hurt`, `opp.open`, `opp.close`, `run.end`, `encounter.start`, `encounter.end`; os demais passam), `StreamTracker`, `WindowAccumulator` e `MetricsAggregator`. Regras fixas: o aplicador reinicia a janela **antes** de aplicar o evento de fronteira (`session.start`, `run.start`, `encounter.start`), para ele ser o primeiro da janela nova; cada evento vai às quatro janelas; `elapsedMs` soma `max(0, t − t_anterior)` só dentro da mesma `session_id`; `encounterMs` vem do `StreamTracker` (guarda o `t_ms` do último `encounter.start`).
- [ ] **Step 4: Rodar** — `npx vitest run src/debug/analysis` → PASS.
- [ ] **Step 5: Commit** — `git add src/debug && git commit -m "feat: add the metrics aggregator core (windows, cycle metrics, event guards)"`

---

### Task 3: Métricas de posição (M1, M2, M14, M15)

**Files:**
- Modify: `src/debug/analysis/{streamTracker,windowAccumulator}.ts`
- Test: `src/debug/analysis/metricsPosition.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces: `Derived` ganha `dtMs`, `stepDistance`, `distance`, `idle` (todos `number | boolean | null` conforme a spec §4.3); o estado compartilhado (`prevSample`, `lastActivityT`) vive no `StreamTracker`, **não** nas janelas: o intervalo pertence à janela em que **termina**.

- [ ] **Step 1: Escrever os testes que falham** (usar `mk`; `pos.sample` com `p`, `e`, `p_state:'idle'`, `e_state:'idle'`)
  - `'M1 average speed is path length over time between consecutive samples of the same run'`: amostras t=0,250,500 com `p` = (0,0),(25,0),(25,50) → `speed.avg === 150`; uma quarta amostra parada em t=750 → `speed.avg === 100` e `speed.moving === 150`.
  - `'run.start and session.start break continuity: no interval across them'`: amostra longe após `run.start` não soma percurso; idem após `session.start` (Review Focus 3).
  - `'M2 mean distance weights each interval by its duration'`: dist 100 por 250 ms e 200 por 500 ms → `meanDistance` ≈ 166,667 (`toBeCloseTo(166.667, 2)`).
  - `'M14 idle fraction counts intervals ending more than 3000 ms after the last player.action or run start'`: `run.start` t=0, amostras de 250 a 4000, sem ação → `idleFraction` = 1000/3750 (`toBeCloseTo(0.2667, 3)`); com `player.action` em t=3000 → `0`.
  - `'M15 coverage counts distinct 64-unit cells per window'`: amostras em duas células → `2/475`; revisitar não soma; nova janela `encounter` recomeça.
  - `'window with no samples reports null, not 0'`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/debug/analysis/metricsPosition.test.ts` → FAIL.
- [ ] **Step 3: Implementar** os campos de `Derived` no `StreamTracker` e as somas (`pathLen`, `dtSum`, `movingPath`, `movingDt`, `distWeighted`, `idleDt`, conjunto de células) no `WindowAccumulator`; `snapshot()` devolve `null` quando o denominador é 0.
- [ ] **Step 4: Rodar** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add src/debug && git commit -m "feat: derive speed, distance, idleness and coverage metrics from position samples"`

---

### Task 4: Métricas de ação, defesa, oportunidade, reação, cancelamento e dano (M4 a M11)

**Files:**
- Modify: `src/debug/analysis/{streamTracker,windowAccumulator}.ts`
- Test: `src/debug/analysis/metricsActions.test.ts`

**Interfaces:**
- Consumes: Tasks 2 e 3.
- Produces: `Derived.reactionMs: number | null`; estado compartilhado `attackStartT`, `dodgeWindowOpen` no `StreamTracker`.

- [ ] **Step 1: Escrever os testes que falham**
  - `'M4 action rate per minute and mean interval'`: 3 `player.action` com `ctx.ms_since_last_action` = `null`, 400, 600 e um evento de preenchimento em t=60000 (mesma sessão) → `actions.perMinute === 3`, `actions.meanIntervalMs === 500`.
  - `'M5 distributions and normalized entropy'`: 2 `light` e 2 `heavy` → `byType.entropy` ≈ `ln2/ln5` (0,4307); só uma arma usada → `byWeapon.entropy === null`.
  - `'M6 defensive distribution'`: `dodge`×2 e `block`×2 → `defenses.entropy === 0.5`.
  - `'M7 and M8 per opportunity type; invalid stays out of the denominator'`: `dodge` com `taken`=1, `missed`=1, `expired`=2, `invalid`=3 → `rate === 0.25`, `omission` ≈ 0,6667; `punish` sem fechamentos → ambos `null`.
  - `'M9 counts the first dodge while a dodge window is open, not earlier or later ones'`: `enemy.attack_start` t=1000, `opp.open` (dodge) t=1000, `player.dodge` t=1300 → reação 300; segundo `player.dodge` t=1400 na mesma janela não conta; `player.dodge` t=5000 sem janela não conta; com reações 300, 500, 100 → `meanMs === 300` e `medianMs === 300`.
  - `'M10 cancels by kind and per action'`: `move`×2, `dash`×1 e 3 ações → `cancels.total === 3`, `perAction === 1`.
  - `'M11 damage totals, ratio and per minute; ratio is null when nothing was taken'`.
  - `'malformed action events do not change the sums'` (Review Focus 1).
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/debug/analysis/metricsActions.test.ts` → FAIL.
- [ ] **Step 3: Implementar** as somas e o rastreio da reação; entropia normalizada com a mesma regra do perfil (`null` com menos de 2 rótulos usados; `n` = 5 tipos, 3 armas, 4 rótulos defensivos); a mediana é calculada no `snapshot()` e **guardada em cache** até entrar nova reação.
- [ ] **Step 4: Rodar** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add src/debug && git commit -m "feat: derive action, defense, opportunity, reaction, cancel and damage metrics"`

---

### Task 5: Equivalência ao vivo × offline e leitura somente

**Files:**
- Create: `src/telemetry/testing/scriptedBot.ts`, `src/debug/analysis/metricsEquivalence.test.ts`, `src/debug/analysis/metricsReadOnly.test.ts`
- Modify: `src/telemetry/replay.test.ts` (importar o bot em vez de defini-lo)

**Interfaces:**
- Produces: `makeBotStack(opts?: { sessionId?: string; firstRunIdx?: number; seedStart?: number }): { stack: TelemetryStack; runEnds: { count: number } }` (**sem** chamar `director.start()`) e `runBot(stack: TelemetryStack, ticks: number): void`, ambos movidos sem mudança de comportamento de `replay.test.ts`.

- [ ] **Step 1: Escrever os testes**
  - equivalência: `'live aggregator equals metricsFromLog over the drained log across several runs, rooms and an abandoned run'`. Sessão 1: pilha com `sessionId:'s1'`, `startSession`, `runBot(…, 30000)`, `drain()` → `log1` (termina no meio de uma run, sem `run.end`). Sessão 2: nova pilha `sessionId:'s2'`, `firstRunIdx = nextRunIdx(log1,'p')`; `agg.applyAll(log1)`; `stack2.recorder.subscribe(e => agg.apply(e))` **antes** de `startSession(info, findAbandonedRun(log1,'p'))`; `runBot(stack2, 30000)`; `log2 = drain()`. Asserção: `expect(agg.snapshot()).toEqual(metricsFromLog([...log1, ...log2]))`.
  - leitura somente: `'recording with the aggregator, tape and view model subscribed yields exactly the same log as without them'`: dois `makeBotStack()` idênticos (mesma seed); em um, ligar `MetricsAggregator`, `EventTape` e chamar `snapshot()` a cada 600 ticks; `runBot` igual; `expect(logComObservadores).toEqual(logSemObservadores)`.
  - guardas de cobertura do cenário: `log` contém ao menos 2 `run.end`, um `run.end` com `cause:'abandoned'`, `player.cancel`, `player.dodge` e `opp.close` (`expect(...).toBeGreaterThanOrEqual(1)`). Se falharem, ajustar as cadências do bot — **nunca** afrouxar a equivalência.
- [ ] **Step 2: Extrair o bot** para `scriptedBot.ts` e atualizar `replay.test.ts` (as asserções de `replay` não mudam).
- [ ] **Step 3: Rodar** — `npx vitest run src/telemetry/replay.test.ts src/debug/analysis` → PASS. Se `metricsEquivalence` falhar, **parar e diagnosticar** (diferença entre `apply` ao vivo e `metricsFromLog` é defeito do agregador, não do teste).
- [ ] **Step 4: Rodar** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add src && git commit -m "test: prove live metrics equal the offline fold and that observers do not change the log"`

---

### Task 6: Fita de eventos

**Files:**
- Create: `src/debug/analysis/eventTape.ts`
- Test: `src/debug/analysis/eventTape.test.ts`

**Interfaces:**
- Produces: `TapeEntry { seq: number; t_ms: number; type: string; summary: string }`; `EventTape { constructor(capacity = 40); push(ev: LoggedEvent): void; entries(): TapeEntry[] /* mais antigo → mais novo */; clear(): void }`; `summarize(ev: LoggedEvent): string`.

- [ ] **Step 1: Escrever os testes que falham**
  - `'keeps only the last 40 entries in order'`: 50 eventos → 40 entradas, a primeira com `seq` 10.
  - resumos exatos: `player.action {actionId:'sword_shield.light'}` → `'sword_shield.light'`; `player.cancel {by:'move', actionId:'sword_shield.light'}` → `'move (sword_shield.light)'`; `opp.close {opp_type:'dodge', outcome:'taken'}` → `'dodge taken'`; `opp.close` com `reason:'out_of_range'` → `'punish invalid (out_of_range)'`; `player.hurt {dmg:20, hp_after:80}` → `'dmg=20 hp=80'`; `pos.sample` → `'pos'`; tipo desconhecido ou carga inválida → `''` (sem lançar).
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/debug/analysis/eventTape.test.ts` → FAIL.
- [ ] **Step 3: Implementar** (anel de tamanho fixo; `summarize` defensivo).
- [ ] **Step 4: Rodar** — PASS.
- [ ] **Step 5: Commit** — `git add src/debug && git commit -m "feat: add the event tape"`

---

### Task 7: `SessionController` (boot, gravação, exportar, importar, encerramento)

**Files:**
- Create: `src/scenes/session/{platform,sessionController,browserPlatform}.ts`
- Test: `src/scenes/session/sessionController.test.ts`

**Interfaces:**
- Consumes: `createTelemetryStack`, `loadProfileState`, `EventStore`, `MemoryEventStore`, `toNdjson`, `importInto`, `GAME_VERSION`, `SCHEMA_VERSION`.
- Produces (`platform.ts`): `Platform { newUuid(): string; nowIso(): string; openStore(): Promise<{ store: EventStore; persistent: boolean }>; downloadText(filename: string, text: string): void; pickFile(): Promise<string | null>; onHide(listener: () => void): () => void }`.
- Produces (`sessionController.ts`): `SessionStatus { gameVersion: string; schemaV: number; playerId: string; sessionId: string; runIdx: number; roomIdx: number; encIdx: number; nextSeq: number; buffered: number; store: 'indexeddb' | 'memory'; persistent: boolean; writeFailures: number }` e `class SessionController { constructor(opts: { platform: Platform; entitySize: number; nextSeed: () => number }); get ready(): boolean; get stack(): TelemetryStack; get history(): readonly LoggedEvent[]; start(opts?: { after?: Promise<void>; onStackReady?: (stack: TelemetryStack, history: readonly LoggedEvent[]) => void }): Promise<void>; persist(): Promise<void>; flushAndPersist(): void; resetProfile(): void; exportHistory(): Promise<void>; importHistory(): Promise<'restart' | 'kept'>; shutdown(): Promise<void>; status(): SessionStatus }`.
- `browserPlatform.ts`: `createBrowserPlatform(): Platform` (`crypto.randomUUID` com *fallback* `getRandomValues`, `Blob`/`<a download>` com remoção e revogação adiada, seletor de arquivo, `visibilitychange`→`hidden` e `pagehide`, `IndexedDbEventStore.open()` com `persistent: true`).

- [ ] **Step 1: Escrever os testes que falham** (plataforma falsa; `MemoryEventStore`; `vi.spyOn(console, 'warn')`)
  - `'start on an empty store creates a player, starts run 0 and logs session.start with persistent=false for a memory store'`.
  - `'start with history rebuilds the profile and continues run numbering'` (primeiro controller grava e faz `shutdown`; o segundo abre o mesmo armazenamento e `history.length > 0`, `stack.director.runIdx` continua).
  - `'onStackReady runs before session.start so subscribers see the first events'` (assinatura no `onStackReady` recebe `session.start` e `run.start`).
  - `'persist drains the recorder buffer into the store and is serialized'`.
  - `'a failing append puts the batch back and the next persist retries it, warning once'` (`writeFailures === 1` após duas falhas seguidas com um só aviso).
  - `'exportHistory downloads tcc-historico-<8 chars>-<yyyy-mm-dd>.ndjson with every stored event'`.
  - `'importHistory merges, adopts the file player and returns restart; a cancelled picker returns kept'`; arquivo de outro jogador gera aviso e é mesclado (`importInto`).
  - `'shutdown flushes pending evidence and closes the store only after in-flight writes settle'`.
  - `'a restart (shutdown then a new controller with after=previous shutdown) loses no event'` (Review Focus 4): contar `seq` contíguos no armazenamento.
  - `'openStore failure falls back to a memory store, and a boot failure starts a fresh in-memory profile'` (nunca rejeita).
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/scenes/session` → FAIL.
- [ ] **Step 3: Mover a lógica** de `ArenaScene.ts` (`boot`, `startGame`, `persist`, `flushAndPersist`, `exportHistory`, `importHistory`, `newUuid`, `downloadText`) para o controlador, **preservando o comportamento** (inclusive: parar a simulação com `ready=false` antes dos `await` da importação, descarregar o buffer duas vezes, `persist` sem rejeitar). `persistent = persistent do openStore && boot.restored`.
- [ ] **Step 4: Rodar** — `npm test` e `npm run typecheck` → limpos (a cena ainda usa o código antigo nesta task; a troca é a Task 12).
- [ ] **Step 5: Commit** — `git add src/scenes && git commit -m "refactor: extract the session controller (boot, persistence, export/import) from the scene"`

---

### Task 8: *View model* e formatação

**Files:**
- Create: `src/debug/analysis/format.ts`, `src/debug/analysis/analysisViewModel.ts`
- Test: `src/debug/analysis/format.test.ts`, `src/debug/analysis/analysisViewModel.test.ts`

**Interfaces:**
- Consumes: `MetricsSnapshot`, `ProfileView`, `PROFILE_SKILLS`, `TapeEntry`, `SessionStatus`.
- Produces: `fmtNum(n: number | null, digits = 2): string` (`null`, `NaN` e `±Infinity` → `—`; vírgula decimal; sem separador de milhar); `fmtMs(n)`, `fmtPercent(fraction)`, `fmtSample(n)` → `n=…`.
- Produces: `LiveState { keysDown: string[]; move: { dx: number; dy: number }; aimDeg: number; weaponId: string; playerState: string; enemyState: string; playerHp: number; enemyHp: number; poise: number }`; `PerfStats { fps: number; stepMs: number }`; `AnalysisInput { metrics; profile: ProfileView; live: LiveState; tape: readonly TapeEntry[]; status: SessionStatus; perf: PerfStats }`; `ViewRow { id: string; cells: string[] }`; `ViewSection { id: 'inputs'|'events'|'metrics'|'profile'|'registry'|'predictor'|'perf'; title: string; columns: string[]; rows: ViewRow[] }`; `AnalysisView = ViewSection[]`; `buildAnalysisView(input): AnalysisView`; `CellPatch { sectionId: string; rowId: string; cell: number; text: string }`; `diffView(prev: AnalysisView | null, next: AnalysisView): CellPatch[]`.

- [ ] **Step 1: Escrever os testes que falham**
  - formato: `fmtNum(0.85) === '0,85'`; `fmtNum(null) === '—'`; `fmtNum(NaN) === '—'`; `fmtNum(1234.5, 1) === '1234,5'`.
  - `'metrics section has one row per metric M1–M15 and four value columns plus the metric name'`.
  - `'absent values render as — and nothing renders NaN'`: snapshot de agregador vazio → nenhuma célula contém `NaN` nem `undefined` (Review Focus 1 e 2).
  - `'profile section lists the six dimensions on both clocks, dimension 7 as "não ligada", and progress = min(1, confidence/0.6)'`: confiança 0,3 → `50%`; 0,9 → `100%`.
  - `'registry shows the short ids (8 chars), version, run/room/encounter and write failures'`.
  - `'events section lists open windows and the tape oldest to newest'`.
  - `'predictor section says não implementado (5b)'`.
  - `'diffView returns only the cells whose text changed, and every cell when prev is null'`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/debug/analysis/format.test.ts src/debug/analysis/analysisViewModel.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Linhas de métricas com rótulos curtos em pt-BR e unidade (`u/s`, `ms`, `u`); M5 e M6 mostram contagem **crua**; as linhas M3, M13 e M17 vêm do `ProfileView`, rotuladas "decaído" onde aplicável.
- [ ] **Step 4: Rodar** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add src/debug && git commit -m "feat: add the analysis view model and pt-BR formatting"`

---

### Task 9: Painel em DOM e *gate* de atualização

**Files:**
- Create: `src/debug/analysis/analysisPanel.ts`
- Test: `src/debug/analysis/refreshGate.test.ts`

**Interfaces:**
- Consumes: `AnalysisView`, `diffView`.
- Produces: `RefreshGate { constructor(intervalMs = 100); due(nowMs: number, visible: boolean): boolean }` (pura); `class AnalysisPanel { constructor(parent: HTMLElement); get visible(): boolean; setVisible(v: boolean): void; toggle(): void; render(view: AnalysisView): void; destroy(): void }`.

- [ ] **Step 1: Escrever o teste que falha** — `'RefreshGate is never due when hidden and due at most once per interval when visible'`: `due(0,false) === false`; `due(0,true) === true`; `due(50,true) === false`; `due(100,true) === true`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/debug/analysis/refreshGate.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `RefreshGate` e `AnalysisPanel`: um `<div>` fixo (`position: fixed`, `pointer-events: none`, monoespaçado, fundo semitransparente, três colunas: Entradas e Eventos / Métricas / Perfil, Registro, Preditor e Desempenho), estilo injetado por `<style>` (sem arquivo CSS); `render` cria as tabelas na primeira vez e depois aplica só os `CellPatch` de `diffView`. O DOM só é tocado em `constructor`, `render`, `setVisible` e `destroy`.
- [ ] **Step 4: Rodar** `npm test` e `npm run typecheck` → limpos.
- [ ] **Step 5: Commit** — `git add src/debug && git commit -m "feat: add the analysis panel (DOM) with throttled refresh"`

---

### Task 10: Entrada do jogador e teclas de atalho

**Files:**
- Create: `src/scenes/input/{mapMovement,playerInput,hotkeys}.ts`
- Test: `src/scenes/input/mapMovement.test.ts`

**Interfaces:**
- Produces: `mapMovement(ix: number, iy: number): { dx: number; dy: number }` = `{ dx: ix + iy, dy: iy − ix }`; `mapAim(pointerWorld: Vec2, playerScreen: Vec2): Vec2` (`fromScreen` da diferença, com `ISO_CONFIG`).
- Produces: `PlayerIntents { setMoveInput(dx, dy): void; setAimDirection(v: Vec2): void; switchWeapon(id: string): void; releaseAction(): void; tryDodge(): void; startBlock(): void; stopBlock(): void; tryEquippedAction(type: ActionType): boolean; readonly equippedWeaponId: string; readonly position: Vec2 }`; `InputSnapshot { keysDown: string[]; move: { dx: number; dy: number }; aim: Vec2 }`; `class PlayerInput { constructor(scene: Phaser.Scene, intents: () => PlayerIntents | null); update(): void; snapshot(): InputSnapshot; destroy(): void }`; `bindHotkeys(keyboard: Phaser.Input.Keyboard.KeyboardPlugin, h: { resetProfile(): void; exportHistory(): void; importHistory(): void; togglePanel(): void; toggleHelp(): void }): void` (F2, F8, F9, Tab, H; captura F2, F8, F9 e Tab).

- [ ] **Step 1: Escrever os testes que falham** — `mapMovement`: `(1,0) → {dx:1, dy:-1}`; `(0,-1) → {dx:-1, dy:-1}`; `(-1,0) → {dx:-1, dy:1}`; `(0,1) → {dx:1, dy:1}`; `(1,1) → {dx:2, dy:0}`; `(0,0) → {dx:0, dy:0}`. `mapAim`: ponteiro sobre o jogador → vetor nulo; ponteiro à direita no losango → componente `x` positivo.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/scenes/input` → FAIL.
- [ ] **Step 3: Implementar**, movendo de `ArenaScene.ts` o mapeamento de teclas (W/A/S/D, 1/2/3, Q, Espaço, E), o ponteiro (esquerdo: leve, senão disparo; direito: pesado) e a mira. Quando `intents()` devolve `null`, **nada** é executado (equivale ao `ready` atual). O roteamento de teclas fica idêntico ao atual.
- [ ] **Step 4: Rodar** — `npm test` e `npm run typecheck` → limpos.
- [ ] **Step 5: Commit** — `git add src/scenes && git commit -m "refactor: extract player input and hotkeys from the scene"`

---

### Task 11: Módulos de visual (câmera, mundo, depuração, HUD de jogador)

**Files:**
- Create: `src/scenes/view/{debugDraw,cameraRig,worldView}.ts`, `src/scenes/hud/gameplayHud.ts`
- Test: `src/scenes/view/debugDraw.test.ts`

**Interfaces:**
- Produces: `sectorPoints(sector: AttackSector, iso: IsoConfig, samples = 10): Vec2[]` (origem projetada primeiro, depois `samples + 1` pontos do arco) e `boxCorners(box: AABB, iso: IsoConfig): Vec2[]` (4 cantos projetados) — puras; `class DebugDraw { constructor(scene: Phaser.Scene); draw(encounter: Encounter<ProfileSink>): void; destroy(): void }`; `class CameraRig { constructor(scene: Phaser.Scene); attach(follow: Phaser.GameObjects.Container, uiObjects: Phaser.GameObjects.GameObject[]): void }` (limites da arena, zoom padrão e roda do mouse via `zoomAfterWheel`, câmera de interface); `class WorldView { constructor(scene: Phaser.Scene); readonly playerSprite; readonly assaltanteSprite; sync(encounter, playerMoving: boolean): void }` (tilemap, sprites, tons de i-frames e de ataque); `class GameplayHud { constructor(scene: Phaser.Scene); update(m: { hp: number; maxHp: number; enemyHp: number; enemyMaxHp: number; poise: number; weaponLabel: string; run: number; room: number; enc: number; encTotal: number }): void; toggleHelp(): void; readonly objects: Phaser.GameObjects.GameObject[] }` (mínima: vida, postura, arma, run/sala/encontro, dica "Tab: painel · H: controles"; ajuda com a lista de controles atual, **oculta** por padrão).

- [ ] **Step 1: Escrever o teste que falha** — `'sectorPoints starts at the projected origin and samples the arc'`: setor com origem `{x:0,y:0}`, direção `{x:1,y:0}`, alcance 64, meio-ângulo `π/4`, `samples = 2` e `ISO_CONFIG` → 4 pontos; `[0]` ≈ (0, 0); `[1]` ≈ (45,25; 0); `[2]` ≈ (32; 16); `[3]` ≈ (0; 22,63) (`toBeCloseTo(…, 1)`). `'boxCorners projects the four corners in order'`: caixa `{x:0,y:0,width:64,height:64}` → (0,0), (32,16), (0,32), (−32,16).
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/scenes/view` → FAIL.
- [ ] **Step 3: Mover o código** correspondente de `ArenaScene.ts` (`drawDebugHitboxes`, `sectorAsPoints`, `cornersAsPoints`, câmera, tilemap, sprites, textos) **sem mudar o comportamento visual**. A câmera de interface continua ignorando os objetos de mundo e vice-versa.
- [ ] **Step 4: Rodar** — `npm test`, `npm run typecheck` e `npm run build` → limpos.
- [ ] **Step 5: Commit** — `git add src/scenes && git commit -m "refactor: extract camera, world view, debug draw and gameplay HUD from the scene"`

---

### Task 12: `ArenaScene` orquestradora e remoção das HUDs antigas

**Files:**
- Modify: `src/scenes/ArenaScene.ts` (reescrita)
- Delete: `src/debug/hudState.ts`, `src/debug/hudState.test.ts`, `src/debug/opportunityOverlay.ts`, `src/debug/opportunityOverlay.test.ts`

**Interfaces:**
- Consumes: Tasks 1 a 11.
- Produces: `ArenaScene` com `preload`, `create` e `update` apenas; **≤ 200 linhas**.

- [ ] **Step 1: Reescrever** `create`: `SessionController` com `createBrowserPlatform()`; no `onStackReady`: `aggregator.applyAll(history)`, depois `stack.recorder.subscribe(e => { aggregator.apply(e); tape.push(e); })` (**antes** de `startSession`); `WorldView`, `CameraRig`, `GameplayHud`, `PlayerInput`, `AnalysisPanel` (montado em `document.body`), `bindHotkeys`; temporizador do Phaser a cada 2000 ms chamando `session.persist()`; `SHUTDOWN` chama `session.shutdown()` e guarda a promessa para o próximo `start({ after })`; importação que devolve `'restart'` chama `scene.restart()`.
- [ ] **Step 2: Reescrever** `update`: `input.update()`; `loop.advance(delta)` medindo `stepMs` com `performance.now()` (média móvel de 60 quadros) e `fps` de `game.loop.actualFps`; `worldView.sync`; `gameplayHud.update`; `debugDraw.draw`; se `gate.due(now, panel.visible)`: `panel.render(buildAnalysisView({ … }))`. A simulação só roda com `session.ready`.
- [ ] **Step 3: Remover** `HudState`, `OpportunityOverlay` e seus testes (a paridade: contadores de esquiva/acertos/golpes sofridos e janelas abertas estão em M7, M10, M11 e no painel de eventos).
- [ ] **Step 4: Verificar** — `wc -l src/scenes/ArenaScene.ts` ≤ 200; `grep -nE "IndexedDb|Blob|crypto|ndjson|persist" src/scenes/ArenaScene.ts` sem ocorrências; `npm test`, `npm run typecheck`, `npm run build` limpos (suíte com os mesmos 369 testes menos os 2 arquivos removidos mais os novos).
- [ ] **Step 5: Fumaça no navegador** — `npm run dev`; abrir a página; o console não mostra erros; Tab abre o painel com as quatro colunas em `—`; H alterna a ajuda. (Se a janela de automação estiver oculta e o jogo não rodar, registrar isso e deixar o roteiro da spec §8 para o autor.)
- [ ] **Step 6: Commit** — `git add -A src && git commit -m "refactor: make ArenaScene a thin orchestrator wired to the analysis panel"`

---

### Task 13: Limpeza e documentação

**Files:**
- Create: `src/ai/rules/assaltanteRules.test.ts`, `public/assets/LICENSES.md`
- Modify: `public/assets/README.md`, `Contexto_pesquisa/documento-tecnico-mestre.md`, `docs/superpowers/specs/2026-10-16-e1-hud-analise-design.md`
- Delete: `public/assets/_unused/` (decisão 5, aprovada; o conteúdo continua no histórico do git)

- [ ] **Step 1: Teste das regras** — `'assaltante.attack wins when the player is within 60 units, otherwise assaltante.chase'`: `ASSALTANTE_RULES.find(r => r.precond({ distanceToPlayer: 60, state: 'idle' }))?.id === 'assaltante.attack'`; com `61` → `'assaltante.chase'`; `opportunity_tags` do ataque é `{ dodge: 1 }`. Rodar → PASS.
- [ ] **Step 2: Assets** — `grep -rn "assets/exemplo\|assets/sprites\|_unused" src index.html` para confirmar que nada os referencia; `git rm -r public/assets/_unused`; **não** apagar `exemplo/` nem `sprites/` (apenas relatar se não forem usados). Atualizar `public/assets/README.md` (isométrico, sprites 128 × 128 em 8 direções, idle e walk, KayKit CC0) e criar `LICENSES.md` com uma linha por pasta em uso (KayKit: CC0, fonte e data; tiles `grass.png` e `water.png`: "licença a conferir com o autor").
- [ ] **Step 3: Documentos** — documento mestre: §3.5 (HUD → ✅ ao implementar), §4.7 (M1 a M15 passam de ⬜ para ✅; M9 só esquiva), §4.8 (linhas fechadas: omissão e relógio estado exibidos; `ArenaScene` modularizada; README e `_unused`), §9.3; spec do E1: acrescentar a linha "Status: implementado em <data>, commits …".
- [ ] **Step 4: Verificação final** — `npm test`, `npm run typecheck`, `npm run build` limpos; `git status` sem arquivos soltos.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: add the ai rules test, refresh assets docs, remove _unused and update docs status"`
