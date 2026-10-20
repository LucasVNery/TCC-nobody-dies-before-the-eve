# V0: agentes sintéticos e relatório — Plano de implementação

> Nota (2026-10-20): H12 retirada e H1 com a cláusula "ou indefinido"; o conjunto pré-registrado final tem 13 itens (H1 a H11, H1u, H2u). Os trechos abaixo sobre "H1 a H12" e "14 itens" são o histórico do plano original.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rodar 7 agentes sintéticos de estilos distintos no jogo de verdade, medir se o perfil os separa e quão estável é, e gerar um relatório (Markdown e CSV) a partir dos logs.

**Architecture:** Módulos puros em `src/experiments/v0/` (estatística, valores por janela do log, humanizador, percepção, estilos e política, executor de agentes, hipóteses, verificações, relatório), testados com Vitest; uma casca de linha de comando em `tools/run-v0.ts` (única parte que toca o disco). Os agentes usam `createTelemetryStack` como o jogo e como os bots de teste, e o perfil sempre vem de `ProfileAccumulator` e do replay.

**Tech Stack:** TypeScript 5.9 estrito, Vitest 2 (ambiente `node`), `vite-node` (já instalado com o Vitest) para a linha de comando. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-19-v0-agentes-sinteticos-design.md` (ler junto; as hipóteses H1 a H12 estão lá).

**Branch:** criar `v0-agentes` a partir de `master`.

## Global Constraints

- **A lógica de jogo não muda** (nenhum arquivo não-teste em `src/core`, `combat`, `opportunity`, `profile`, `ai`, `game`, `telemetry`, `visual`, `scenes`, `debug`); `GAME_VERSION` continua `0.0.3+viewB`; formato do log inalterado. A suíte atual (540 testes) passa sem alteração de asserção.
- Código novo só em `src/experiments/v0/` (puro: **sem Phaser, sem `node:*`, sem DOM**), `tools/run-v0.ts` e `experiments/v0/` (README e, ignorada pelo git, `out/`).
- Configuração padrão do experimento: **7 agentes** (`agressivo`, `evasivo`, `bloqueador`, `paciente`, `variado`, `repetitivo`, `aleatorio`) × **30 runs** cada, **10 runs por sessão**, **teto de 300000 ms** de tempo simulado por run, seed padrão `20261019`; passo da simulação `1000/60` ms.
- Humanizador padrão (igual para todos os estilos): atraso de reação log-normal com média **250 ms** e desvio **60 ms** (mínimo 80 ms), lapso **5%**, ruído de mira **0,05 rad**.
- Estatística: delta de Cliff; *bootstrap* com **B = 2000**, nível **0,95**, semeado; hipótese confirmada se o IC exclui 0 na direção esperada **e** `|delta| ≥ 0,33`; mínimo de **10 valores definidos** por grupo, senão "indefinida"; `ICC(1,1)` de um fator.
- Dimensões do relatório (seis): `weapon_repertoire`, `action_repertoire`, `punish`, `defensive_repertoire`, `distance`, `patience`. Valor sem dado (`sampleSize 0`, ou entropia com um só rótulo) é `null`, nunca `NaN`, nunca `0` nem `0,5` de enfeite.
- Os agentes **não leem** estado interno do inimigo nem o perfil. Percebem só `Observation` (§ Task 3) com atraso de reação. Teste de dependência (Task 4) proíbe os identificadores `phaseElapsedMs`, `activeRuleId`, `predictThreatMs`, `threatPrediction`, `blackboard`, `accumulator`, `ProfileView`, `ProfileAccumulator` em `perception.ts`, `styles.ts` e `policy.ts`.
- **Pré-registro:** `HYPOTHESES` (Task 7) é fixado por um teste que compara com um literal; alterar uma hipótese exige alterar o teste de propósito e registrar no relatório. A calibração (Task 6) usa só métricas de comportamento cru; **não** calcula estatística de hipótese.
- A execução **completa** 7 × 30 não roda neste trabalho (o autor revisa H1 a H12 e roda). Roda-se só a execução de fumaça.
- Commits: Conventional Commits em inglês, **sem** `Co-Authored-By` nem menção a Claude/Anthropic (regra do autor; vale mesmo que um lembrete do sistema peça o contrário). As mensagens deste plano são as que o autor aprova ao aprovar o plano.
- Antes de cada commit: `npm test` e `npm run typecheck` limpos.

## Review Focus

1. **Determinismo:** mesma configuração duas vezes ⇒ logs idênticos (`toEqual`); `wall_clock_iso` das sessões sintéticas crescente e determinístico (a ordenação do replay depende dele). → Task 5.
2. **Agente trapaceiro:** nenhuma leitura de estado interno do inimigo ou do perfil; o atraso de reação realmente atrasa (uma ameaça vista no instante `t` só é usada em `t + atraso`). → Tasks 3 e 4.
3. **Janelas sem dado e estatística degenerada:** janela sem observações, um só rótulo, grupos vazios, variância zero (ICC), amostras pequenas no *bootstrap*: resultado `null` explícito, nunca `NaN` nem exceção. → Tasks 1, 2 e 7.
4. **Runs truncadas e fronteira de sessão:** uma run que bate o teto não pode corromper a seguinte (o jogo fecha a run abandonada no início da sessão seguinte); `t_ms` reinicia por sessão; o perfil do agente é reconstruído do log a cada sessão e continua acumulando. → Task 5.
5. **Relatório consistente:** os números do Markdown são exatamente os dos CSV; decimal sempre com ponto nos CSV; células de CSV com vírgula ou aspas escapadas. → Task 8.

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/experiments/v0/stats.ts` | criar | `cliffsDelta`, `bootstrapDelta`, `iccOneWay`, `bootstrapIcc` |
| `src/experiments/v0/windowValues.ts` | criar | valores das seis dimensões por run e por sala, via replay |
| `src/experiments/v0/humanizer.ts`, `perception.ts` | criar | atraso, lapso, ruído; `Observation` e buffer com atraso |
| `src/experiments/v0/styles.ts`, `policy.ts` | criar | `AGENT_STYLES` e `AgentPolicy` |
| `src/experiments/v0/agentRunner.ts` | criar | `playAgent`, `runExperiment` |
| `src/experiments/v0/hypotheses.ts`, `evaluate.ts`, `pipelineChecks.ts` | criar | H1 a H12, veredito, ICC por dimensão, verificações |
| `src/experiments/v0/report.ts` | criar | Markdown e CSV |
| `tools/run-v0.ts`, `tools/calibrate-v0.ts`, `experiments/v0/README.md`, `.gitignore` | criar/alterar | linha de comando |
| documento mestre §8.4 e spec | alterar | status |

---

### Task 1: Estatística

**Files:**
- Create: `src/experiments/v0/stats.ts`
- Test: `src/experiments/v0/stats.test.ts`

**Interfaces:**
- Produces: `cliffsDelta(a: readonly number[], b: readonly number[]): number | null` (`(#a>b − #a<b) / (|a|·|b|)`; `null` se algum vazio); `interface Interval { estimate: number | null; lo: number | null; hi: number | null }`; `bootstrapDelta(a, b, rng: () => number, B = 2000, level = 0.95): Interval` (reamostra cada grupo com reposição; percentis); `iccOneWay(groups: readonly (readonly number[])[]): number | null` (ICC(1,1) com grupos de tamanhos diferentes: `(MSB − MSW) / (MSB + (k0 − 1)·MSW)` com `k0` pela fórmula usual; `null` com menos de 2 grupos com ≥ 2 medidas, ou quando `MSB` e `MSW` são 0); `bootstrapIcc(groups, rng, B = 2000, level = 0.95): Interval` (aproximado: reamostra medidas dentro de cada grupo); `bootstrapIccClustered(agents: readonly (readonly (readonly number[])[])[], rng, B = 2000, level = 0.95): Interval` (agents[a][r] = valores por sala da run r do agente a; reamostra runs dentro de cada agente; é o usado pelo relatório). Todos aceitam `rng` do PRNG semeado do jogo (`createPrng` em `src/core/prng.ts`; ver sua assinatura) ou qualquer função em `[0,1)`.

- [ ] **Step 1: Escrever os testes que falham**
  - `cliffsDelta([1,2,3],[2,3,4]) ≈ −0,5556` (`toBeCloseTo(-5/9, 6)`); `cliffsDelta([5,6],[1,2]) = 1`; `cliffsDelta([1],[1]) = 0`; `cliffsDelta([], [1]) = null`.
  - `'ICC(1,1) reproduces the Shrout and Fleiss example'`: grupos (sujeitos) `[9,2,5,8]`, `[6,1,3,2]`, `[8,4,6,8]`, `[7,1,2,6]`, `[10,5,6,9]`, `[6,2,4,7]` ⇒ `toBeCloseTo(0.1657, 3)`.
  - `iccOneWay`: grupos idênticos internamente e diferentes entre si (`[[1,1,1],[5,5,5],[9,9,9]]`) ⇒ `1`; menos de 2 grupos ⇒ `null`; todos os valores iguais ⇒ `null` (variância zero); grupos com 1 medida só ⇒ `null`; grupos de tamanhos diferentes não lançam e dão número finito (Review Focus 3).
  - `bootstrapDelta`: com `rng` semeado duas vezes ⇒ `toEqual` (determinístico); caso sintético em que `a` está claramente acima de `b` (30 valores em `[10,20]` contra 30 em `[0,5]`) ⇒ `lo > 0` e `hi ≤ 1`; grupos idênticos ⇒ intervalo contém 0; `a` vazio ⇒ `{estimate:null, lo:null, hi:null}`; `B` pequeno (`B=5`) não lança.
  - `bootstrapIcc`: determinístico; no exemplo acima, `lo ≤ estimate ≤ hi` em 20 sementes diferentes (`lo`/`hi` finitos) e `null`s coerentes para entrada degenerada.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/experiments/v0/stats.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `stats.ts` com as assinaturas acima (sem `Math.random`).
- [ ] **Step 4: Rodar** — `npx vitest run src/experiments/v0` → PASS.
- [ ] **Step 5: Commit** — `git add src/experiments && git commit -m "feat: add the statistics for the V0 experiment"`

---

### Task 2: Valores das dimensões por janela do log

**Files:**
- Create: `src/experiments/v0/windowValues.ts`
- Test: `src/experiments/v0/windowValues.test.ts`

**Interfaces:**
- Consumes: `LoggedEvent`, `rebuildProfileWithStats` (`src/telemetry/replay.ts`), `SkillId`.
- Produces: `REPORT_SKILLS: readonly SkillId[]` (as seis, nesta ordem: `weapon_repertoire`, `action_repertoire`, `punish`, `defensive_repertoire`, `distance`, `patience`); `interface WindowValue { runIdx: number; roomIdx: number | null; skill: SkillId; domain: number | null; confidence: number; sampleSize: number }`; `runWindowValues(events: readonly LoggedEvent[], playerId: string): WindowValue[]` (uma janela por `run_idx` do jogador; `roomIdx: null`); `roomWindowValues(events, playerId): WindowValue[]` (uma janela por par `run_idx`/`room_idx`).
- Regra de janela: eventos do jogador com os índices do envelope iguais aos da janela e tipo `obs.*`; passados a `rebuildProfileWithStats(janela, playerId)` (um acumulador novo por janela). **Dobra final:** se depois do último `obs.boundary` de sala da janela ainda há observações, acrescentar **um** evento sintético `obs.boundary {kind:'room'}` (com os mesmos `player_id`/`session_id` e `seq` maior); se a janela já termina em fronteira de sala, **não** acrescentar (evita dobra dupla). Valor: `domain(skill,'trait')`, `confidence`, `sampleSize`; se `sampleSize === 0`, `domain` é `null`.

- [ ] **Step 1: Escrever os testes que falham** (eventos montados à mão no formato de `LoggedEvent`; `obs.action {actionType, weaponId}`, `obs.outcome {skill, outcome}`, `obs.defense {label}`, `obs.record {skill,num,den}`, `obs.boundary {kind}`)
  - `'action repertoire of a room equals the entropy of its counts'`: sala com 3× `light` (`sword_shield`) e 1× `heavy` e uma fronteira de sala ⇒ `action_repertoire.domain ≈ 0,3494` (`toBeCloseTo(0.3494, 3)`), `sampleSize` 4.
  - `'ratio dimension folds pending evidence exactly once'` (Review Focus 3): 3× `obs.outcome punish taken`, 1× `missed`: com fronteira de sala no fim ⇒ `punish.domain ≈ 0,6667` (4/6; a evidência pendente entra sem decair na primeira dobra); **sem** a fronteira no fim ⇒ o mesmo `0,6667`; com a fronteira no fim e mais uma sintética (dobra dupla, caso proibido) o valor seria `0,6588` ⇒ o teste afirma `≠ 0,6588`.
  - `'a window without data yields null, not NaN'`: sala só com `obs.defense` ⇒ `weapon_repertoire`, `action_repertoire`, `punish`, `distance`, `patience` `domain === null` e `sampleSize === 0`; `defensive_repertoire` com um só rótulo ⇒ `domain === null`; varredura recursiva sem `NaN`.
  - `'run windows group by run_idx and room windows by run_idx+room_idx'`: log com 2 runs e 3 salas ⇒ 2 e 3 janelas (× 6 dimensões).
  - `'another player is ignored'`; `'matches a hand-fed accumulator'`: o valor da janela de uma run com observações conhecidas coincide com `new ProfileAccumulator()` alimentado manualmente com as mesmas chamadas e as mesmas fronteiras, nas seis dimensões.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/experiments/v0/windowValues.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `windowValues.ts`.
- [ ] **Step 4: Rodar** — `npx vitest run src/experiments/v0` → PASS.
- [ ] **Step 5: Commit** — `git add src/experiments && git commit -m "feat: compute profile dimension values per run and per room from the log"`

---

### Task 3: Humanizador e percepção

**Files:**
- Create: `src/experiments/v0/humanizer.ts`, `src/experiments/v0/perception.ts`
- Test: `src/experiments/v0/humanizer.test.ts`, `src/experiments/v0/perception.test.ts`

**Interfaces:**
- `interface HumanizerConfig { reactionMeanMs: number; reactionSdMs: number; lapseProb: number; aimNoiseRad: number }`; `DEFAULT_HUMANIZER` com os valores das Global Constraints; `class Humanizer { constructor(cfg: HumanizerConfig, rng: () => number); sampleReactionMs(): number; lapses(): boolean; noisyAim(dir: Vec2): Vec2 }` (log-normal calibrada para a média e o desvio pedidos; mínimo 80 ms; `noisyAim` gira o vetor por um ângulo normal de desvio `aimNoiseRad` e preserva o comprimento).
- `interface Observation { tMs: number; enemyState: EnemyState; enemyPos: Vec2; playerPos: Vec2; playerHp: number; playerPoise: number; isBlocking: boolean; equippedWeaponId: string; enemyDead: boolean }`; `observe(encounter: Encounter<ProfileSink>, tMs: number): Observation` (lê **apenas** os *getters* públicos do jogador e do Assaltante: `state`, `position`, `hp`, `poise`, `isBlocking`, `equippedWeaponId`, `isDead`); `class PerceptionBuffer { constructor(capacityMs = 2000); push(o: Observation): void; at(nowMs: number, delayMs: number): Observation | null }` (a observação mais recente com `tMs ≤ nowMs − delayMs`; `null` se não houver; descarta o que passa de `capacityMs`).

- [ ] **Step 1: Escrever os testes que falham**
  - Humanizador: com `rng` semeado, 20000 atrasos têm média dentro de 3% de 250, desvio dentro de 10% de 60 e mínimo ≥ 80; mesma seed ⇒ mesma sequência; `lapses()` em 20000 chamadas fica em `0,05 ± 0,005`; `lapseProb 0` nunca e `1` sempre; `noisyAim({x:3,y:4})` preserva o comprimento (5 ± 1e-9), desvio padrão do ângulo ≈ `aimNoiseRad` em amostra grande, e vetor nulo devolve nulo.
  - Percepção: `at` respeita o atraso: observações em `t = 0,100,200`, `at(250, 100)` devolve a de `t=100`; `at(250, 300)` ⇒ `null` (nada tão antigo); `at(250, 0)` ⇒ a de `t=200`; descarta o que passa de `capacityMs`; `observe` (Review Focus 2) com um `Encounter` real devolve só os campos listados e **não** tem as chaves `phaseElapsedMs` nem `activeRuleId` (`Object.keys`); e uma ameaça (`enemyState: 'attacking'`) observada em `t = 1000` só aparece em `at(now, delay)` quando `now − delay ≥ 1000`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/experiments/v0/humanizer.test.ts src/experiments/v0/perception.test.ts` → FAIL.
- [ ] **Step 3: Implementar** os dois módulos (nomes dos *getters* reais em `src/combat/playerController.ts` e `assaltanteController.ts`; confirmar que existem antes de usar).
- [ ] **Step 4: Rodar** — `npx vitest run src/experiments/v0` → PASS.
- [ ] **Step 5: Commit** — `git add src/experiments && git commit -m "feat: add the humanizer and the delayed perception for synthetic agents"`

---

### Task 4: Estilos e política

**Files:**
- Create: `src/experiments/v0/styles.ts`, `src/experiments/v0/policy.ts`
- Test: `src/experiments/v0/policy.test.ts`

**Interfaces:**
- `type StyleId = 'agressivo' | 'evasivo' | 'bloqueador' | 'paciente' | 'variado' | 'repetitivo' | 'aleatorio'`; `STYLE_IDS: readonly StyleId[]` (nesta ordem); `interface AgentStyle { id: StyleId; weaponWeights: Record<string, number>; weaponSwitchPerMin: number; actionWeights: Record<string, number> /* por id de ação registrada */; attackCooldownMs: number; preferredDistance: number; distanceTolerance: number; defenseWeights: { dodge: number; block: number; parry: number; none: number }; waitForOpening: boolean }`; `AGENT_STYLES: Record<StyleId, AgentStyle>` (valores iniciais plausíveis com as qualidades da spec §4.1; a Task 6 calibra).
- `interface PolicyInput { now: Observation; seen: Observation | null; nowMs: number }`; `interface AgentIntent { move: Vec2; aim: Vec2; switchTo?: string; startAction?: string; release?: boolean; dodge?: boolean; block?: 'start' | 'stop' }`; `class AgentPolicy { constructor(style: AgentStyle, humanizer: Humanizer, rng: () => number); decide(input: PolicyInput): AgentIntent }`. A política guarda os próprios temporizadores (último ataque, reação planejada, segurar a guarda) e **só** decide a partir de `now` (o que vê do próprio corpo) e de `seen` (o mundo atrasado).
- As ações disponíveis são as registradas (`ACTION_REGISTRY` em `src/combat/actionRegistry.ts`): `sword_shield.{light,heavy,charged}`, `heavy_weapon.{light,heavy,charged}`, `bow.shot`; o tipo `utility` não tem ação e é ignorado. Ação carregada: `startAction` do id `*.charged` e `release` depois de uma retenção entre `minHoldMs` e `maxHoldMs`.

- [ ] **Step 1: Escrever os testes que falham** (política pura, com observações sintéticas e `rng` semeado)
  - `'repetitivo only ever starts sword_shield.light and never switches'` em 2000 decisões variadas; `'variado uses all three weapons and every registered action over many decisions'`; `'aleatorio picks the 7 registered actions with roughly uniform frequency'` (cada uma entre 10% e 18% em 5000 escolhas); `'evasivo keeps preferredDistance larger than agressivo'` (para a mesma observação distante o vetor de movimento do `agressivo` aponta para o inimigo e o do `evasivo` se afasta quando `dist < preferredDistance`).
  - `'bloqueador reacts to a seen telegraph with block (and sometimes parry timing) and never dodges more than its weight'`; `'paciente does not start an attack while the enemy is attacking, only while recovering or far'`; `'agressivo attacks in cooldown cadence even while the enemy attacks'`.
  - Atraso (Review Focus 2): com `seen = null` nenhum estilo reage a uma ameaça (nenhum `dodge`/`block`); com `seen.enemyState = 'attacking'` e `nowMs` ainda dentro do atraso planejado, a reação só acontece depois do atraso; lapsos (`lapseProb 1`) anulam a ação.
  - Determinismo: mesma seed ⇒ mesma sequência de intenções.
  - `'policy files do not read internals'`: leitura dos arquivos `perception.ts`, `styles.ts`, `policy.ts` (via `import.meta.glob` com `?raw`, como em `src/visual/floor/floorSeed.test.ts`) e afirma que nenhum contém `phaseElapsedMs`, `activeRuleId`, `predictThreatMs`, `threatPrediction`, `blackboard`, `accumulator`, `ProfileView`, `ProfileAccumulator`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/experiments/v0/policy.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `styles.ts` e `policy.ts` (parâmetros: os estilos da spec §4.1; usar `findWeaponAction`/`ACTION_REGISTRY`).
- [ ] **Step 4: Rodar** — `npx vitest run src/experiments/v0` → PASS.
- [ ] **Step 5: Commit** — `git add src/experiments && git commit -m "feat: add the seven agent styles and the delayed-perception policy"`

---

### Task 5: Executor dos agentes

**Files:**
- Create: `src/experiments/v0/agentRunner.ts`
- Test: `src/experiments/v0/agentRunner.test.ts`

**Interfaces:**
- Consumes: `createTelemetryStack` (`src/telemetry/stack.ts`), `rebuildProfileWithStats`, `nextRunIdx`, `findAbandonedRun` (`src/telemetry/{replay,abandonedRun}.ts`), `ProfileAccumulator`, Tasks 3 e 4.
- Produces: `interface ExperimentConfig { seed: number; agents: readonly StyleId[]; runsPerAgent: number; runsPerSession: number; runCapMs: number; humanizer: HumanizerConfig; stepMs: number }`; `DEFAULT_EXPERIMENT` com as constantes das Global Constraints; `interface AgentLog { styleId: StyleId; playerId: string; events: LoggedEvent[]; live: ProfileAccumulator; completedRuns: number; truncatedRuns: number; emptyRuns: number[]; simulatedMs: number; sessions: number }`; `playAgent(styleId: StyleId, cfg: ExperimentConfig, agentIndex: number): AgentLog`; `runExperiment(cfg: ExperimentConfig): AgentLog[]`.
- Regras: cada agente é um jogador (`playerId = \`agent-${styleId}\``); sessão = `startSession` + até `runsPerSession` runs (cada run termina por morte; ao bater `runCapMs` de tempo simulado **na run** a sessão acaba, como uma aba fechada, e a run fica sem `run.end`); a sessão seguinte começa reconstruindo o perfil do log (`rebuildProfileWithStats(historico, playerId)`), continua `nextRunIdx` e passa `findAbandonedRun(historico, playerId)` para `startSession`, como o jogo. `sessionId = \`${styleId}-s${n}\``; `wall_clock_iso` da sessão `n` = `new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()` (crescente e determinístico); `nextSeed` do jogo e o PRNG do agente derivados de `(cfg.seed, agentIndex, sessão)` por uma mistura inteira (função própria; **não** o PRNG do jogo para decisões do agente). Cada passo: observar, empurrar no `PerceptionBuffer`, `policy.decide`, aplicar as intenções ao `Encounter` (mesma superfície do jogador), `stack.step(stepMs)`.
- A morte do agente encerra a run pelo próprio jogo; o executor só detecta o fim de run por `onRunEnd` do stack ou por `director`.

- [ ] **Step 1: Escrever os testes que falham**
  - `'same config twice gives identical logs'` (Review Focus 1): 2 agentes (`repetitivo`, `agressivo`) × 2 runs, `runCapMs` 20000, `toEqual` em `events` e nos contadores; `'a different seed gives a different log'`; `wall_clock_iso` das sessões é estritamente crescente.
  - `'a run that hits the cap is truncated and the next session closes it as abandoned'` (Review Focus 4): com `runCapMs` pequeno (por exemplo 3000) e `runsPerAgent 3`, o log contém `run.end {cause:'abandoned'}` para a run truncada, `truncatedRuns ≥ 1`, e a contagem de `run.start` ≥ `run.end`; `seq` contíguo e `t_ms` reiniciando em cada `session.start`.
  - `'agent profile is rebuilt per session and keeps accumulating'`: o perfil `live` ao fim é igual ao reconstruído de todo o log (`snapshot('room.exit')` e `domain/confidence/sampleSize` das seis dimensões nos dois relógios, `toEqual`), com pelo menos 2 sessões (`runsPerSession 1`).
  - `'repetitivo only produces sword_shield.light actions and no weapon switch'` e `'variado produces actions of every registered weapon'` lendo `player.action` do log real (confirma que a política dirige o motor de verdade); `'player ids and session ids follow the convention'`.
  - `'does not touch the game PRNG'`: o `nextSeed` do jogo é chamado só por run (contador), nunca pelo agente.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/experiments/v0/agentRunner.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `agentRunner.ts`.
- [ ] **Step 4: Rodar** — `npx vitest run src/experiments/v0` → PASS; `npm test`, `npm run typecheck` limpos.
- [ ] **Step 5: Commit** — `git add src/experiments && git commit -m "feat: add the agent runner with deterministic sessions and run caps"`

---

### Task 6: Calibração piloto dos estilos

**Files:**
- Create: `tools/calibrate-v0.ts`, `experiments/v0/calibration.md`
- Modify: `src/experiments/v0/styles.ts` (apenas valores de `AGENT_STYLES`)

**Interfaces:** `tools/calibrate-v0.ts` imprime, para cada estilo, uma tabela de **comportamento cru** (Markdown) a partir de uma execução curta (por exemplo 10 runs por agente, seed `1`): runs completas e truncadas, duração média da run, ações por minuto por tipo e por arma (contagens de `player.action`), contagem de `player.defense` por rótulo, distância média ao inimigo (média dos `pos.sample`, mesma definição de M2 do agregador de métricas) e fração do tempo em alcance corpo a corpo, fração de ataques iniciados com o inimigo em `attacking`, número de oportunidades de punição e de esquiva. **Não** calcula delta de Cliff, ICC nem veredito de hipótese.

- [ ] **Step 1:** Escrever o script e rodá-lo com os valores iniciais; anotar a tabela em `experiments/v0/calibration.md` (data, seed, tabela).
- [ ] **Step 2:** Ajustar `AGENT_STYLES` até valerem **critérios de comportamento** (não de hipótese): (a) cada estilo faz o que o nome diz (por exemplo `repetitivo`: 100% das ações são `sword_shield.light`; `variado`: as três armas e pelo menos 5 dos 7 ids de ação; `bloqueador`: `block`/`parry` são a maior parte das defesas; `evasivo`: usa o arco em ≥ 50% das ações e distância média maior que a do `agressivo`; `agressivo`: cadência de ataque maior que a de todos os outros; `paciente`: menos de 10% dos ataques iniciados com o inimigo em `attacking`); (b) cada agente produz **dados suficientes**: ≥ 8 runs completas de 10 e pelo menos 15 oportunidades de punição e 15 de esquiva por agente no piloto; (c) nenhuma run típica dura menos de 20 s (agente não morre em segundos). Registrar cada ajuste e o motivo em `calibration.md`.
- [ ] **Step 3:** Rodar a calibração final e gravar a tabela final em `calibration.md`; `npm test`, `npm run typecheck` limpos (os testes de política da Task 4 continuam valendo).
- [ ] **Step 4: Commit** — `git add tools experiments src/experiments && git commit -m "feat: calibrate the agent styles against raw behaviour only"`

---

### Task 7: Hipóteses, avaliação, ICC e verificações do pipeline

**Files:**
- Create: `src/experiments/v0/hypotheses.ts`, `src/experiments/v0/evaluate.ts`, `src/experiments/v0/pipelineChecks.ts`
- Test: `src/experiments/v0/evaluate.test.ts`, `src/experiments/v0/pipelineChecks.test.ts`

**Interfaces:**
- `interface Hypothesis { id: string; skill: SkillId; kind: 'greater' | 'undefinedRate'; higher?: StyleId; lower?: StyleId; style?: StyleId; orLowerUndefined?: boolean }`; `HYPOTHESES: readonly Hypothesis[]` com **exatamente** H1 a H12 da spec §4.4 (H1: `weapon_repertoire`, `greater` `variado` > `agressivo`; H1b não existe; as cláusulas "indefinido em ≥ 95% das runs" de H1 e H2 viram duas hipóteses adicionais de `kind: 'undefinedRate'` para `repetitivo`, ids `H1u` (`weapon_repertoire`) e `H2u` (`action_repertoire`)); H5 e H12 com `orLowerUndefined: true` onde a spec diz "(ou … indefinido)"; ver a spec para os demais.
- `type Verdict = 'confirmada' | 'refutada' | 'indefinida'`; `interface HypothesisResult { id: string; skill: SkillId; verdict: Verdict; delta: number | null; lo: number | null; hi: number | null; nHigher: number; nLower: number; undefinedRateLower: number | null }`; `evaluateHypotheses(valuesByStyle: Record<StyleId, WindowValue[]>, rng: () => number, B = 2000): HypothesisResult[]` (usa os valores **por run**, só os definidos; "indefinida" se algum grupo tem < 10 valores definidos; `orLowerUndefined`: se o grupo inferior é indefinido em ≥ 95% das runs a hipótese é confirmada; `undefinedRate`: fração de `domain === null` ≥ 0,95).
- `interface IccResult { skill: SkillId; styleId?: StyleId; icc: number | null; lo: number | null; hi: number | null; belowCriterion: boolean | null }`; `iccBySkill(roomValuesByStyle: Record<StyleId, WindowValue[]>, rng, B = 2000): IccResult[]` (uma linha por dimensão) (grupos = AGENTES, medidas = os valores por sala definidos de todas as runs do agente; intervalo por `bootstrapIccClustered` da Task 1, que reamostra RUNS dentro de cada agente (spec §4.5); `belowCriterion = icc < 0,50`, `null` se `icc` for `null`).
- `interface PipelineCheck { id: string; ok: boolean; detail: string }`; `checkAgentLog(log: AgentLog): PipelineCheck[]` com `live-equals-rebuilt` (mesma comparação da Task 5), `no-skipped-observations` (`skipped === 0` do replay), `no-malformed-metrics` (`MetricsAggregator.snapshot().malformed === 0` ao dobrar o log), `run-accounting` (`run.start` = `completedRuns` + `truncatedRuns` + `emptyRuns.length` de `AgentLog`; as runs vazias — abertas logo depois de uma morte quando a sessão acaba — são **descartadas** de `runValues`/`roomValues`/relatório e só contadas; ver Task 5), `seq-contiguous`.

- [ ] **Step 1: Escrever os testes que falham**
  - `'HYPOTHESES are pre-registered'` (Review Focus do pré-registro): `HYPOTHESES` `toEqual` um literal copiado no teste com os 14 itens (H1…H12 mais `H1u`, `H2u`), comentário "alterar exige decisão do autor e registro no relatório".
  - `evaluateHypotheses` com dados sintéticos: `variado` com valores em `[0,6; 0,9]` e `agressivo` em `[0,1; 0,3]` (30 cada) ⇒ H1 `confirmada` com `delta` ≈ 1 e `lo > 0`; grupos iguais ⇒ `refutada`; um grupo com 5 valores definidos ⇒ `indefinida`; `repetitivo` com 29 de 30 `null` ⇒ `H1u` `confirmada` (fração 0,967); com 20 de 30 ⇒ `refutada`; `orLowerUndefined` com o inferior 100% `null` ⇒ `confirmada`; resultado determinístico (mesma seed) e sem `NaN`.
  - `iccBySkill`: dados sintéticos com variação entre grupos ⇒ `icc > 0,8`, `belowCriterion false`; ruído puro ⇒ `icc` perto de 0 e `belowCriterion true`; grupos com menos de 2 medidas definidas ⇒ `icc: null`, `belowCriterion: null`.
  - `checkAgentLog` com um `AgentLog` real pequeno (Task 5) ⇒ todas `ok`; com um evento `obs.defense {label:'xx'}` injetado ⇒ `no-skipped-observations` `ok:false` com o detalhe; com `live` adulterado ⇒ `live-equals-rebuilt` falha.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/experiments/v0` → FAIL.
- [ ] **Step 3: Implementar** os três módulos.
- [ ] **Step 4: Rodar** — `npx vitest run src/experiments/v0` → PASS.
- [ ] **Step 5: Commit** — `git add src/experiments && git commit -m "feat: add the pre-registered hypotheses, ICC and pipeline checks"`

---

### Task 8: Relatório

**Files:**
- Create: `src/experiments/v0/report.ts`
- Test: `src/experiments/v0/report.test.ts`

**Interfaces:**
- `interface ReportInput { config: ExperimentConfig; gameVersion: string; generatedAtIso: string; elapsedMs: number; logs: AgentLog[]; runValues: Record<StyleId, WindowValue[]>; roomValues: Record<StyleId, WindowValue[]>; hypotheses: HypothesisResult[]; icc: IccResult[]; checks: Record<StyleId, PipelineCheck[]> }`; `interface ReportFiles { 'relatorio.md': string; 'runs.csv': string; 'rooms.csv': string; 'hipoteses.csv': string; 'icc.csv': string; 'perfil_final.csv': string }`; `buildReport(input: ReportInput): ReportFiles`. Formato numérico: `fmt(n, 3)` com ponto decimal nos CSV; vírgula decimal no Markdown (pt-BR); `null` ⇒ vazio no CSV e `—` no Markdown; CSV com escape de aspas e vírgulas.
- Seções do `relatorio.md`, na ordem e com os títulos: `## 1. Configuração`, `## 2. Perfil final por agente`, `## 3. Separação de estilos`, `## 4. Estabilidade (limite superior)`, `## 5. Verificações do pipeline`, `## 6. Limitações`. A tabela de §3 lista cada hipótese com delta, IC 95%, `n` dos dois grupos, veredito, mais a matriz estilo × dimensão da mediana das runs; §6 é texto fixo (política estacionária; agentes com atraso de reação mas sem aprendizado; hipóteses e calibração são decisões do autor e do Claude; dimensão 7 fora; validade discriminante não é validade em humanos).

- [ ] **Step 1: Escrever os testes que falham** (entradas sintéticas escritas à mão, pequenas)
  - *golden*: `buildReport(entrada fixa)` ⇒ `relatorio.md` e cada CSV `toEqual` literais do teste (strings pequenas: 2 estilos, 2 dimensões, 2 hipóteses).
  - Consistência (Review Focus 5): para a mesma entrada, o delta e o IC de cada hipótese no Markdown (convertidos de vírgula para ponto) são os de `hipoteses.csv`; a contagem de linhas de `runs.csv` = agentes × (runs não vazias) × dimensões (as runs vazias saem do CSV e aparecem só como contagem no §2 do relatório); nenhum `NaN`/`undefined`/`Infinity` em nenhum arquivo; CSV com um campo contendo vírgula e aspas é escapado e relido corretamente por um parser mínimo escrito no teste.
  - As seis seções existem, na ordem; uma verificação de pipeline que falhou aparece com `FALHOU` em §5.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/experiments/v0/report.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `report.ts` (puro; nenhuma data ou relógio dentro: `generatedAtIso` e `elapsedMs` vêm de fora).
- [ ] **Step 4: Rodar** — `npx vitest run src/experiments/v0` → PASS.
- [ ] **Step 5: Commit** — `git add src/experiments && git commit -m "feat: generate the V0 report as Markdown and CSV"`

---

### Task 9: Linha de comando, fumaça e documentação

**Files:**
- Create: `tools/run-v0.ts`, `experiments/v0/README.md`
- Modify: `package.json` (script `"v0": "vite-node tools/run-v0.ts"`), `.gitignore` (`experiments/v0/out/`), `Contexto_pesquisa/documento-tecnico-mestre.md` (§8.4: status da V0), spec (linha de status)

**Interfaces:** `npx vite-node tools/run-v0.ts [--agents a,b,…] [--runs N] [--runs-per-session N] [--cap-ms N] [--seed N] [--out DIR] [--smoke]`; `--smoke` = 2 agentes (`agressivo`, `repetitivo`) × 3 runs, teto 60000 ms. Fluxo: `runExperiment` → por agente `runWindowValues`/`roomWindowValues` → `evaluateHypotheses` e `iccBySkill` (com `rng` semeado por `seed`) → `checkAgentLog` → `buildReport` → grava os 6 arquivos em `experiments/v0/out/<yyyy-mm-dd>-seed<seed>/` (ou `--out`) e imprime o caminho e o tempo; **termina com código ≠ 0** se alguma verificação do pipeline falhar, dizendo qual agente e qual verificação. Hipóteses que dependem de estilos ausentes (em `--smoke`) saem como `indefinida`.

- [ ] **Step 1:** Escrever `tools/run-v0.ts` (única parte com `node:fs`/`node:path`/`process.argv`; sem tipos de Node: declarações mínimas locais ou `// @ts-nocheck` justificado no topo, já que `tools/` fica fora do `tsconfig` de `src`; conferir que `npm run typecheck` não passa a incluir `tools/` nem falha).
- [ ] **Step 2: Fumaça** — rodar `npx vite-node tools/run-v0.ts --smoke`; conferir: sai com código 0, cria os 6 arquivos, `relatorio.md` tem as 6 seções, as verificações de pipeline estão `ok`, o tempo impresso é razoável (registrar). Abrir `relatorio.md` e descrever o que se vê (sem interpretar os números como resultado). **Não** rodar a execução completa.
- [ ] **Step 3:** Estimar o custo da execução completa: rodar com `--agents agressivo --runs 5` e extrapolar o tempo para 7 × 30, registrando a estimativa no README.
- [ ] **Step 4: Documentar** — `experiments/v0/README.md` (comandos, saídas, como ler o relatório, o pré-registro e como alterá-lo, limites); documento mestre §8.4 (V0: infraestrutura ✅ em <data>, execução completa e leitura dos resultados pendentes do autor); spec: linha "Status: implementado em <data>; execução completa pendente".
- [ ] **Step 5: Verificação final** — `npm test`, `npm run typecheck`, `npm run build` limpos; `git status` limpo (a pasta `out/` ignorada); `git diff master --stat -- src` mostra só `src/experiments/`.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: add the V0 command line, smoke run and docs"`
