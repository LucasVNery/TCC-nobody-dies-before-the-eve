# E1: HUD de análise e cena modularizada — Design

**Data:** 16/10/2026
**Sub-projeto:** E1 do ambiente de gameplay v2 (ver `Contexto_pesquisa/documento-tecnico-mestre.md` §3.5 e §3.8). Sequência: E1 → E2 arena procedural → E3 herói e inimigo comum animados → E4 chefe.
**Depende de:** `telemetry/telemetryRecorder.ts`, `telemetry/stack.ts`, `telemetry/bootstrap.ts`, `telemetry/eventStore.ts`, `telemetry/ndjson.ts`, `profile/profileAccumulator.ts`, `scenes/ArenaScene.ts`, `visual/cameraZoom.ts`, `debug/hudState.ts`, `debug/opportunityOverlay.ts`.
**Pré-requisito de branch:** `combat-b` mesclada em `master` (ou o E1 parte de `combat-b`): a cena e os valores do combate B são a base.
**Documentos relacionados:** documento mestre §3.5 (HUD), §4.7 (catálogo de métricas), §4.8 (lacunas), §5 (modelo de dados); spec do 5a `2026-09-30-telemetria-runs-5a-design.md`.

---

## 1. Contexto e objetivo

O autor decidiu (16/10/2026) reconstruir a camada de apresentação e a casca de gameplay mantendo o núcleo lógico. O E1 é o primeiro passo, e o que mais serve ao objetivo principal da tese (o sistema de profilamento): **ver o perfil se formar** a partir do que o jogador faz.

Hoje a visibilidade é um painel de texto cru. A cena `ArenaScene.ts` tem 575 linhas, sem nenhum teste, misturando boot, persistência, entrada, câmera, desenho de debug e HUD.

**Objetivo do E1:**

1. Uma **HUD de análise** (modo desenvolvedor, alternável) que mostra **entradas, saídas e dados agregados**: o dado bruto combinado com outro vira uma métrica derivada (exemplo do autor: distância e tempo geram velocidade média).
2. Uma **HUD de jogador** mínima.
3. A **cena dividida em módulos pequenos e testáveis**.
4. Fechar as lacunas do que já existe que **não mudam a lógica do jogo** (documento mestre §4.8).

### 1.1 Decisões de brainstorming

| Decisão | Escolha |
|---|---|
| Natureza do E1 | **Apresentação e leitura**: nenhuma regra de jogo, balanceamento ou geometria muda. `GAME_VERSION` **não** muda e os logs continuam comparáveis |
| Métricas derivadas | O catálogo do documento mestre §4.7 (M1 a M17). Cada uma é função pura **do log**; a mesma função serve ao vivo e offline |
| Fonte de verdade | O **fluxo de eventos do log** (`LoggedEvent`). O agregador é uma dobra (*fold*) sobre ele: ao vivo, recebe o que o gravador acaba de gravar; offline, recebe o `.ndjson`. A equivalência vale por construção e é testada |
| Janelas | Quatro colunas lado a lado: **encontro, run, sessão e histórico**, definidas pelos eventos de ciclo do próprio log. Sem seletor |
| Painel | **HTML sobre o canvas** (sem Phaser `Text`): denso e tabular, atualizado a 10 Hz só quando visível. *Proposta; ver decisão 1 em §9* |
| Alternância | Tecla **Tab** *(proposta; decisão 2 em §9)*; evita F1, F5, F7 e F12, que o navegador intercepta |
| HUDs antigas | `HudState` e `OpportunityOverlay` são **removidas** depois de paridade: o painel novo cobre os mesmos dados |
| Regra das 8 ações e ação `utility` | **Fora do E1**: mudam os dados (nova `GAME_VERSION`) e dependem de decisão do autor. O documento mestre §4.8 marcava a regra das 8 ações como E1; corrigido |

---

## 2. Escopo

### 2.1 Entra

- **Núcleo de métricas** (`src/debug/analysis/`): `MetricsAggregator` (dobra sobre o log), `metricsFromLog`, `EventTape` (fita dos últimos eventos), `analysisViewModel` (formatação pura) e `AnalysisPanel` (view em DOM).
- **Mudanças aditivas** em módulos existentes, sem alterar comportamento:
  - `TelemetryRecorder`: `subscribe(listener)`, `bufferedCount`, `nextSeq`.
  - `ProfileAccumulator`: acessor somente leitura `sampleSize(skill, clock)` e a interface `ProfileView`.
  - `BootState` (`telemetry/bootstrap.ts`): campo `history` (eventos do `player_id` atual já lidos no boot).
- **Cena modularizada** (`src/scenes/`): `session/SessionController` (boot, persistência, exportar e importar), `input/PlayerInput`, `view/CameraRig`, `view/DebugDraw`, `view/WorldView`, `hud/GameplayHud`; `ArenaScene` vira orquestradora.
- **Testes** para tudo que não depende de Phaser (§7); `ai/` ganha teste.
- **Limpeza**: remover `debug/hudState.ts` e `debug/opportunityOverlay.ts` (e seus testes) após paridade; atualizar `public/assets/README.md`; decidir `public/assets/_unused/`; criar `public/assets/LICENSES.md`.
- **Auxiliar de teste:** extrair o bot roteirizado de `telemetry/replay.test.ts` para `src/telemetry/testing/scriptedBot.ts`, para o reuso nos testes de equivalência.
- Atualizar o documento mestre (§3.5, §4.7, §4.8, §9).

### 2.2 Não entra

- Arena procedural, tiles, personagens, animações, som (E2 a E4).
- Qualquer mudança de regra: regra das 8 ações, ação `utility`, *perfect dodge*, boss.
- Novos eventos no log. Em particular **não** se acrescenta um evento de início de guarda (`player.guard`): sem ele a latência de reação (M9) só cobre a esquiva. Fica como pendência registrada (§9).
- O painel do preditor: reserva-se o espaço e mostra-se "não implementado".
- Redesenho visual da HUD de jogador além do mínimo.

### 2.3 Critério de pronto

1. A HUD de análise (Tab) mostra, para as quatro janelas, todas as métricas marcadas ⬜ ou ✅ no catálogo §4.7 **exceto** M16 (preditor), com valor e **amostra (n)**; onde não há amostra, mostra "—", nunca 0.
2. O painel lista as entradas atuais, os últimos 40 eventos com `t_ms`, tipo e resumo, contadores por tipo de evento, janelas de oportunidade abertas e o estado do registro (sessão, run, `seq`, buffer, armazenamento).
3. O painel mostra as sete dimensões nos **dois relógios** (domínio, confiança, déficit, omissão, amostra, progresso até 0,60), inclusive o relógio `state`, que hoje ninguém consome.
4. **Equivalência:** o `MetricsSnapshot` calculado ao vivo é **idêntico** (`toEqual`, sem tolerância) ao calculado por `metricsFromLog` sobre o log drenado, num cenário de várias runs, salas e abandono de run.
5. O painel é **somente leitura**: com o agregador e o *view model* ligados ou desligados, o log gravado é idêntico (teste em Node; a parte em DOM só lê o *view model* e é verificada no playtest), e os testes de lógica existentes passam sem alteração (`replay`, `bootstrap`, `encounter`).
6. `ArenaScene.ts` fica com **≤ 200 linhas** e sem lógica de persistência, de mapeamento de entrada nem de formatação de métricas.
7. `SessionController` é testado com `MemoryEventStore` e uma plataforma falsa: boot, gravação em lote, falha com nova tentativa, exportar, importar e encerramento.
8. Suíte completa, typecheck e build limpos; **nenhuma regressão de jogo** no playtest manual (§8).

---

## 3. Arquitetura

```
 combate / jogo ──▶ EventBus ──▶ TelemetryRecorder ──log()──▶ buffer ──▶ EventStore
                                        │
                                        └─subscribe(listener)──▶ MetricsAggregator ──snapshot()──┐
                                                          └────▶ EventTape                       │
 ProfileView (somente leitura) ───────────────────────────────────────────────────────────────┤
 InputState, perf, SessionStatus ─────────────────────────────────────────────────────────────┤
                                                                                                ▼
                                                              analysisViewModel (puro) ──▶ AnalysisPanel (DOM)
```

Regras:

- **Mão única.** Nada do painel escreve no jogo. O agregador só lê eventos; o painel só lê o *view model*.
- **Uma só fonte de eventos.** O agregador **não** assina o `EventBus` do jogo: consome o `LoggedEvent` que o gravador acabou de produzir. É o que garante a equivalência com a análise offline.
- **Histórico no boot.** A cena alimenta o agregador com `boot.history` antes do primeiro evento ao vivo; a janela "histórico" passa a incluir as sessões anteriores do mesmo `player_id`.
- **Ordem de ligação.** O agregador e a fita se inscrevem no gravador **antes** de `startSession`, para receberem `session.start`, o fechamento de uma run abandonada e o `run.start` da primeira run; o histórico é aplicado antes da inscrição.
- **Pura vs. plataforma.** Tudo em `debug/analysis/` exceto `AnalysisPanel` é TypeScript puro, testável em Node. `AnalysisPanel` é a única parte que toca o DOM.

### 3.1 Mudanças aditivas nos módulos existentes

| Módulo | Mudança | Por que é segura |
|---|---|---|
| `TelemetryRecorder` | `subscribe(listener: (e: LoggedEvent) => void): () => void`, chamado ao fim de `log()`; getters `bufferedCount` e `nextSeq` | Só observa; não altera o buffer, a ordem nem o conteúdo |
| `ProfileAccumulator` | `sampleSize(skill, clock): number` (denominador dobrado para razões; `totalCount` para entropia) e a interface `ProfileView { domain, confidence, deficit, omission, sampleSize }` | Leitura de estado existente |
| `BootState` | `history: LoggedEvent[]` (os eventos já lidos e filtrados pelo `player_id`) | Evita uma segunda leitura do armazenamento |

---

## 4. O agregador de métricas

### 4.1 Interface

```ts
// src/debug/analysis/metricsAggregator.ts
export const WINDOW_IDS = ['encounter', 'run', 'session', 'history'] as const;
export type WindowId = (typeof WINDOW_IDS)[number];

export class MetricsAggregator {
  apply(event: LoggedEvent): void;                 // O(1) por evento
  applyAll(events: readonly LoggedEvent[]): void;
  snapshot(): MetricsSnapshot;                     // calcula os derivados a partir dos acumuladores
}
export function metricsFromLog(events: readonly LoggedEvent[]): MetricsSnapshot;

export interface MetricsSnapshot {
  windows: Record<WindowId, WindowMetrics>;
  eventCounts: Record<string, number>;             // por tipo, na janela "histórico"
  openWindows: OpenOpportunity[];                  // janelas de oportunidade abertas agora
  malformed: number;                               // eventos ignorados por carga inválida
}
```

### 4.2 Janelas

| Janela | Reinicia em | Observação |
|---|---|---|
| `encounter` | `encounter.start` | Encontro corrente |
| `run` | `run.start` | Run corrente |
| `session` | `session.start` | Sessão corrente |
| `history` | nunca | Todo o log do `player_id`, incluindo sessões anteriores |

Cada evento é aplicado às quatro janelas. O tempo decorrido de uma janela (`elapsedMs`) é a soma dos `t_ms` entre eventos consecutivos **da mesma sessão** (`t_ms` reinicia a cada sessão, então o salto entre sessões não conta).

### 4.3 Definições exatas das métricas

Constantes: `MOVING_SPEED_EPS = 5` u/s; `IDLE_THRESHOLD_MS = 3000` *(🔵 a calibrar; decisão 3 em §9)*; `CELL = 64`; `ARENA_CELLS = 25 × 19 = 475`.

| ID | Cálculo | Entradas (log) | `null` quando |
|---|---|---|---|
| **M1** velocidade média | Para amostras `pos.sample` consecutivas **na mesma run**: `d = ‖p_i − p_{i−1}‖`, `Δt = t_i − t_{i−1}`. `avg = Σd / ΣΔt · 1000` (u/s). `moving` usa só os intervalos com `d/Δt·1000 > MOVING_SPEED_EPS` | `pos.sample.p` | `ΣΔt = 0` |
| **M2** distância média ponderada | `Σ(‖p_i − e_i‖ · Δt) / ΣΔt`, com a distância no fim de cada intervalo | `pos.sample.p`, `.e` | `ΣΔt = 0` |
| **M4** taxa e intervalo de ações | `ações ÷ (elapsedMs/60000)`; intervalo = média de `ctx.ms_since_last_action` não nulos em `player.action` | `player.action` | `elapsedMs = 0`; sem intervalos |
| **M5** distribuição de ações e armas | Contagens por `actionType` e `weaponId` (cruas, **sem decaimento**); entropia normalizada `H/ln n` (n = 5 tipos, 3 armas), `null` com menos de 2 rótulos usados | `player.action` | menos de 2 rótulos (entropia) |
| **M6** distribuição defensiva | Contagens por `label` de `player.defense`; entropia sobre n = 4 | `player.defense` | idem |
| **M7** aproveitamento por tipo de janela | `taken ÷ (taken + missed + expired)` por `opp_type`; `invalid` fica fora do denominador | `opp.close` | denominador 0 |
| **M8** omissão | `expired ÷ (expired + missed)` por `opp_type` | `opp.close` | denominador 0 |
| **M9** latência de reação (**só esquiva**) | `t(player.dodge) − t(enemy.attack_start)` para o **primeiro** `player.dodge` que ocorre **com uma janela `dodge` aberta**; esquivas antes da telegrafia não contam. Média e mediana | `enemy.attack_start`, `opp.open`, `opp.close`, `player.dodge` | sem amostras |
| **M10** cancelamento | `player.cancel ÷ player.action`, e a repartição por `by` | `player.cancel`, `player.action` | sem ações |
| **M11** troca de dano | `Σ enemy.hurt.dmg` (causado), `Σ player.hurt.dmg` (sofrido); razão causado ÷ sofrido; por minuto | `enemy.hurt`, `player.hurt` | sofrido = 0 (razão); `elapsedMs = 0` (por minuto) |
| **M12** ciclo | Encontros: `encounter.end` contados e duração média (`t_end − t_start`); runs: contagem, média de `run.end.duration_ms` e de `rooms_cleared` | ciclo de vida | sem fins de ciclo |
| **M14** ociosidade | Para cada intervalo de `pos.sample` na run, ocioso se `t_i − max(último player.action, run.start) > IDLE_THRESHOLD_MS`; `ocioso = Σ Δt ociosos ÷ Σ Δt` | `pos.sample`, `player.action`, `run.start` | `ΣΔt = 0` |
| **M15** cobertura espacial | Células de 64 unidades visitadas por `pos.sample.p` ÷ 475, **por janela** | `pos.sample.p` | sem amostras |

**Observações:**

- **M3** (fração ao alcance, dim 5), **M13** (pacientes, dim 6) e **M17** (progresso até a confiança 0,60) **não** são recalculados: vêm do `ProfileView`, que é exato (M3 usa todos os passos, não só os 4 Hz). A diferença entre o valor cru das contagens (M5, M6) e o valor **decaído** do perfil é intencional e aparece lado a lado.
- **Amostragem a 4 Hz.** M1, M2, M14 e M15 derivam de `pos.sample` (uma amostra a cada 250 ms); são aproximações declaradas no painel (a trajetória real é mais longa que a poligonal de amostras).
- **M16** (previsibilidade) fica como painel reservado: "não implementado (5b)".
- **Validação defensiva.** Cada evento tem a carga verificada por tipo (números finitos, rótulos conhecidos). Evento malformado é ignorado e contado em `malformed`, como na reconstrução do perfil.

### 4.4 Janelas de oportunidade abertas

O agregador mantém um mapa `opp_id → {opp_type, src, window_ms, openedAtT}` (entra em `opp.open`, sai em `opp.close`). O painel mostra as abertas **agora**; substitui o `OpportunityOverlay`.

---

## 5. O painel de análise

### 5.1 Conteúdo

| Painel | Conteúdo | Origem |
|---|---|---|
| **Entradas** | Teclas pressionadas, vetor de movimento, mira (graus), arma equipada, estado do jogador e do inimigo, vida e postura | `PlayerInput`, controladores (leitura) |
| **Eventos** | Contadores por tipo; fita dos últimos 40 eventos (`t_ms`, tipo, resumo); janelas abertas agora | `EventTape`, `MetricsAggregator` |
| **Métricas** | Tabela M1 a M15: uma linha por métrica, **quatro colunas** (encontro, run, sessão, histórico); cada célula mostra valor e `n`. Avisos de "amostrado a 4 Hz" onde couber | `MetricsAggregator` |
| **Perfil** | Para cada dimensão (as 6 ligadas e a 7 como "não ligada"): domínio, confiança, déficit, omissão, amostra e progresso `confiança ÷ 0,60`, **nos relógios traço e estado** | `ProfileView` |
| **Registro** | `GAME_VERSION`, `schema_v`, ids curtos de jogador e sessão, run, sala, encontro, `seq`, eventos no buffer, armazenamento (IndexedDB ou memória), falhas de gravação | `SessionController`, `TelemetryRecorder` |
| **Preditor** | "Não implementado (5b)" | — |
| **Desempenho** | Quadros por segundo; tempo médio do passo de simulação (últimos 60 quadros) | cena |

### 5.2 Formato

- Números em pt-BR (`0,85`), formatados por funções próprias (sem depender de `Intl` no Node). Unidades explícitas: u/s, ms, u.
- Valor ausente é "—". Amostra aparece como `n=…`.
- Cores só para distinguir os painéis; nenhum sinal depende de cor.

### 5.3 Comportamento

- **Alternância:** Tab liga e desliga (capturada para o navegador não mudar o foco). Inicia **desligado**. O painel não captura o mouse (`pointer-events: none`), então não atrapalha o jogo.
- **Atualização:** a 10 Hz e só com o painel visível; o *view model* só é calculado nesse caso. O agregador, em compensação, roda sempre (O(1) por evento), para que o painel já abra com todo o histórico.
- **Escrita no DOM:** só nas células cujo texto mudou.
- **Posição:** `position: fixed` sobre a janela; fonte monoespaçada; fundo semitransparente; três colunas (Entradas e Eventos / Métricas / Perfil, Registro e Desempenho).

### 5.4 `analysisViewModel`

Função pura `buildAnalysisView(input: AnalysisInput): AnalysisView`. Recebe o `MetricsSnapshot`, o `ProfileView`, o estado de entrada, a fita, o status do registro e os números de desempenho; devolve linhas já formatadas (texto, `n`, indicadores). Toda a formatação e a regra "—" ficam aqui, testadas em Node; `AnalysisPanel` só escreve as linhas no DOM.

---

## 6. Modularização da cena

`ArenaScene.ts` hoje concentra tudo. Alvo:

| Módulo | Responsabilidade | Testável em Node? |
|---|---|---|
| `scenes/ArenaScene.ts` | Orquestra: `preload`, `create` (liga os módulos), `update` (um passo por quadro). **≤ 200 linhas** | Não (Phaser) |
| `scenes/session/SessionController.ts` | Boot (abrir armazenamento, `loadProfileState`, criar a pilha, `startSession`), gravação em lote com nova tentativa, exportar, importar, encerramento com descarga. Usa uma interface `Platform { newUuid, nowIso, downloadText, pickFile, onHide }` injetada | **Sim** (`MemoryEventStore` + plataforma falsa) |
| `scenes/session/browserPlatform.ts` | A `Platform` real (`crypto`, `Blob`, `document`, `visibilitychange`) | Não (DOM) |
| `scenes/input/PlayerInput.ts` | Liga teclas e ponteiro às **intenções** do jogador (trocar arma, atacar, esquivar, guarda, mover, mirar); expõe `InputState` para o painel | Parcial |
| `scenes/input/mapMovement.ts` | Função pura: rotação de 45° do WASD para o losango | **Sim** |
| `scenes/view/CameraRig.ts` | Limites, seguir o jogador, zoom e câmera de interface | Não (Phaser) |
| `scenes/view/DebugDraw.ts` | Hurtboxes, leque e alcance (a lógica de pontos do setor vira função pura) | Parcial |
| `scenes/view/WorldView.ts` | Tilemap, sprites e a sincronização com a lógica | Não (Phaser) |
| `scenes/hud/GameplayHud.ts` | Vida, postura, arma, run/sala/encontro, dica de teclas | Não (Phaser) |

`SessionController` recebe a lógica hoje espalhada em `boot`, `startGame`, `persist`, `flushAndPersist`, `exportHistory`, `importHistory`, `newUuid` e `downloadText`: a parte que **não** é Phaser e que já passou por três correções na revisão final do 5a. Mover para uma classe testada é o maior ganho de confiabilidade do E1.

**Teclas existentes preservadas:** WASD, mouse, clique esquerdo e direito, Q, 1/2/3, Espaço, E, F2, F8, F9, roda do mouse. **Nova:** Tab (painel de análise); `H` alterna a ajuda de controles (hoje sempre visível).

---

## 7. Testes

| Arquivo | O que prova |
|---|---|
| `debug/analysis/metricsAggregator.test.ts` | Cada métrica M1 a M15 com eventos sintéticos e **casos-limite** (sem amostra → `null`; troca de run e de sessão não une amostras; esquiva antes da telegrafia não conta em M9; `invalid` fora do denominador; evento malformado ignorado e contado); reinício das quatro janelas; janelas abertas |
| `debug/analysis/metricsEquivalence.test.ts` | **Ao vivo contra offline:** bot roteirizado em várias runs, salas e um abandono; o agregador ligado ao `subscribe` do gravador produz um snapshot **idêntico** (`toEqual`) ao de `metricsFromLog` sobre o log drenado |
| `debug/analysis/metricsReadOnly.test.ts` | O log gravado com o agregador, a fita e o *view model* ligados é **idêntico** ao gravado sem eles |
| `debug/analysis/eventTape.test.ts` | Anel de tamanho fixo; resumo por tipo de evento |
| `debug/analysis/analysisViewModel.test.ts` | Formatação pt-BR; "—" para ausência; amostra visível; relógios traço e estado; dimensão 7 "não ligada"; progresso até 0,60 |
| `telemetry/telemetryRecorder.test.ts` (acréscimos) | `subscribe` recebe os eventos na ordem, `unsubscribe` funciona, `bufferedCount` e `nextSeq` |
| `profile/profileAccumulator.test.ts` (acréscimos) | `sampleSize` (razão e entropia, dois relógios) |
| `telemetry/bootstrap.test.ts` (acréscimos) | `history` contém só o `player_id` atual |
| `scenes/session/sessionController.test.ts` | Boot com e sem histórico; gravação em lote; falha de escrita volta ao buffer e é repetida; exportar; importar (inclusive jogador estrangeiro); encerramento descarrega e fecha o armazenamento só depois; reinício não perde eventos |
| `scenes/input/mapMovement.test.ts` | Rotação de 45° para as oito direções e para o repouso |
| `scenes/view/debugDraw.test.ts` | Pontos do setor (função pura) |
| `ai/rules/assaltanteRules.test.ts` | Ordem das regras e pré-condição de alcance |
| Existentes | `replay`, `bootstrap`, `encounter`, `runDirector` passam **sem alteração** (prova de que a lógica não mudou) |

O que depende de Phaser e do DOM (`ArenaScene`, `WorldView`, `CameraRig`, `AnalysisPanel`) é coberto por **typecheck, build e o playtest manual** da §8.

---

## 8. Playtest manual (critério de aceitação visual)

No navegador, com `npm run dev`:

1. O jogo abre e joga como antes (movimento, ataques, esquiva, guarda, troca de arma, zoom).
2. **Tab** abre o painel; as quatro colunas de métricas começam em "—" e passam a preencher conforme se joga.
3. Atacar sem parar faz subir a taxa de ações (M4) e cair a ociosidade (M14); ficar parado faz o contrário.
4. Esquivar durante a telegrafia registra uma latência (M9); esquivar antes dela não registra.
5. Matar o Assaltante 3 vezes e morrer: as colunas encontro e run reiniciam e **sessão** e **histórico** acumulam.
6. Recarregar a página: a coluna **histórico** já abre com os dados anteriores.
7. F2 zera o perfil (painel "Perfil" volta a "—") **sem** apagar o histórico de métricas.
8. F8 e F9 continuam funcionando; ao importar, o painel reabre com o histórico mesclado.
9. Com o painel ligado, a taxa de quadros não cai de forma perceptível.

---

## 9. Decisões e riscos

### 9.1 Decisões que o autor confirma na revisão

| # | Decisão | Proposta | Alternativa |
|---|---|---|---|
| 1 | Tecnologia do painel | **HTML sobre o canvas** (denso, tabular, texto selecionável, sem regerar textura a cada atualização) | Textos do Phaser (mais simples de integrar, pior para tabelas) |
| 2 | Tecla de alternância | **Tab** | `` ` ``, `\`, ou outra |
| 3 | Limiar de ociosidade (M14) | 3000 ms, como valor inicial ajustável | Outro valor, ou derivado dos dados |
| 4 | Remover `HudState` e `OpportunityOverlay` | Sim, depois de paridade | Manter ambos |
| 5 | `public/assets/_unused/` (≈ 3 MB de pacotes de terceiros, sem licença registrada) | Remover do repositório (fica no histórico do git) | Manter e registrar licenças |

### 9.2 Pendências registradas (fora do E1)

- **Evento de início de guarda (`player.guard`):** permitiria medir a latência de guarda e o timing do parry. Acrescenta um tipo de evento ao log (aditivo, mas muda o conteúdo gravado). Candidato a um passo próprio.
- **Regra das 8 ações** e a ação `utility`: decisão do autor; mudam os dados.

### 9.3 Riscos

| Risco | Tratamento |
|---|---|
| Aproximação a 4 Hz distorce M1, M2, M14 e M15 | Declarada no painel e no documento mestre; as dimensões do perfil usam dados exatos |
| Histórico muito grande no boot deixa o jogo lento | O boot já lê o log inteiro para reconstruir o perfil; a dobra do agregador é linear e leve. Medir com um log grande no playtest |
| Refatoração da cena quebrar algo sem teste | Extrair primeiro o que é puro (testado); depois mover o que é Phaser com o playtest da §8 após cada passo |
| O painel afetar o desempenho | Só calcula e escreve com o painel visível; O(1) por evento no agregador |
| Confundir o valor decaído do perfil com a contagem crua do painel | Rótulos explícitos ("cru" e "decaído") e as duas colunas lado a lado em M5 e M6 |

---

## 10. Atualizações de documentação (mesmo conjunto de commits)

- Documento mestre: §3.5 (HUD, status), §4.7 (marcar M1 a M15 como ⬜ → ✅ ao implementar), §4.8 (a regra das 8 ações sai do E1), §9.3.
- `public/assets/README.md` atualizado (hoje descreve top-down e "sem animação"); `public/assets/LICENSES.md` novo.
