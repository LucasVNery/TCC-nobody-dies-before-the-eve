# Combate fluido e responsivo (revisão de combate, sub-projeto B) — Design

**Data:** 30/09/2026
**Sub-projeto:** B da revisão de combate (A escala/câmera ✅ `1f0aa4f` → **B** → C animações de combate → D inimigo, depois). Precede a coleta de dados para o 5b (preditor sequencial).
**Depende de:** `combat/playerController.ts`, `combat/actionRegistry.ts` (`totalCommitmentMs`), `combat/actionDefs.ts`, `combat/movementDefs.ts`, `combat/encounter.ts` (hook da dim 6), `combat/patience.ts`, `core/events.ts`, `telemetry/telemetryRecorder.ts` (lista de eventos com `ctx`), `telemetry/schema.ts` (`GAME_VERSION`), `scenes/ArenaScene.ts` (mapeamento de input).
**Documentos relacionados:** `Contexto_pesquisa/instrumento-perfil-adaptativo.md` §3 (dims 4–6), §12.6 (janela segura), §13 (parâmetros); spec da dim 6 `2026-09-12-janela-segura-dim6-design.md`; spec do 5a `2026-09-30-telemetria-runs-5a-design.md`.

---

## 1. Contexto e objetivo

No playtest de 30/09/2026 (após o 5a) o autor achou o combate "engessado": movimento um pouco lento, personagens pequenos, pouca visualização do personagem, e isso dificultava validar o próprio instrumento. O sub-projeto A resolveu a escala (zoom 2×, personagem 40 px). Este sub-projeto trata da **mecânica**: tornar o movimento e o combate fluidos e dinâmicos.

Fontes de rigidez encontradas no código:
- `PlayerController` em `acting` trava **todo** movimento durante preparação + golpe + recuperação (350 ms no leve, 640 ms no pesado); o mesmo em `blocking` e `staggered`.
- Não há buffer de input: `tryAction`/`tryDodge` fora de `idle` são descartados.
- A recuperação não é cancelável (só a troca de arma, por esquiva).
- O dash usa a última direção de movimento (possivelmente antiga), só sai de `idle`, e tem recarga de 300 ms.
- Velocidade do jogador 160.

### 1.1 Decisões de brainstorming

| Decisão | Escolha |
|---|---|
| Referência de sensação | **Rápido e ágil, estilo Hades/Dead Cells** — movimento rápido, dash curto e frequente, ataques canceláveis. |
| O que o jogador faz durante um ataque | **Preso só na preparação + golpe; a recuperação é cancelada por qualquer input** (andar, dash, novo ataque). Recuperação só existe se o jogador não faz nada; combos saem naturalmente. |
| Dim 6 (paciência) | **Redefinida**: a exposição passa a ser só a parte não cancelável da ação (preparação + golpe; no carregado, só o golpe após soltar). A pergunta "atacou quando era seguro?" continua; a janela encurta. Se a dimensão perder variância entre jogadores, os dados dirão (D1). |
| Avanço automático no ataque ("lunge") | **Fora** — moveria o jogador durante o golpe e quebraria a premissa da nova dim 6 (jogador parado na preparação + golpe). |
| Velocidade do Assaltante | Perseguição **90 → 125** (mantém a proporção jogador/inimigo de hoje; senão a dim 5 seria distorcida por um inimigo trivial de evitar). O resto do inimigo fica para o sub-projeto D. |
| Sinal de "jogador ocioso" | Ideia do autor: jogador parado muito tempo sem atacar é informação para o boss (avançar/dash). **Já está no log do 5a** (`ctx.ms_since_last_action`, `pos.sample` a 4 Hz) — registrado como sinal candidato para 5b/6, sem mudança neste sub-projeto. |

---

## 2. Escopo

### 2.1 Entra

- Parâmetros novos (§3) em `actionDefs.ts` / `movementDefs.ts`.
- `PlayerController`: fases explícitas do ataque, recuperação cancelável, dash a partir de mais estados e na direção do input (ou da mira), dash cancelando o carregamento, movimento a 50% bloqueando, buffer de input de 120 ms, evento `player.cancel`.
- `actionRegistry.ts`: `lockedMs(action)` (parte não cancelável).
- `Encounter`: hook da dim 6 passa a usar `lockedMs`; `ArenaScene` passa a direção de movimento atual ao controller e mantém o mapeamento de teclas.
- `ASSALTANTE_CHASE_SPEED` 90 → 125.
- `player.cancel` no `GameEvents` e na lista de eventos com `ctx` do `TelemetryRecorder`.
- `GAME_VERSION` → `'0.0.2+combatB'`.
- Atualização dos testes existentes que assumem os tempos/travas antigos; testes novos (§7).
- Documento consolidado: dim 6 (nova janela), §13 (parâmetros), nota de comparabilidade de dados (como a do leque de ataque).

### 2.2 Não entra

- Animações de ataque/esquiva/dano/morte e feedback de acerto — sub-projeto C.
- Comportamento/IA do Assaltante além da velocidade de perseguição — sub-projeto D.
- Avanço automático no ataque (lunge).
- Cargas de dash (2 dashes seguidos, estilo Hades) — pode vir depois se a recarga de 200 ms parecer pouco.
- Aceleração/inércia no movimento (Hades é instantâneo; mantém-se instantâneo).
- Mudança nas regras das dims 1–5 ou no `OpportunitySystem`.

### 2.3 Critério de pronto

1. Parado, o jogador anda a 220 u/s; bloqueando, a 110 u/s.
2. Durante preparação e golpe de um ataque, o jogador não se move e não dá dash; inputs de ataque/dash nesse período são executados assim que a recuperação começa, se apertados há ≤ 120 ms.
3. Na recuperação, input de movimento volta o jogador a `idle` e ele se move no mesmo tick; dash sai imediatamente; novo ataque começa imediatamente. Cada caso emite `player.cancel` com o `by` correspondente.
4. Sem input, a recuperação termina sozinha após `totalCommitmentMs` como hoje, sem `player.cancel`.
5. O dash vai na direção do movimento pedido; sem movimento pedido, na direção da mira.
6. Segurando o carregado (antes de soltar), dash cancela o carregamento e **não** emite `player.action`.
7. Dash não sai durante preparação/golpe nem em stagger (vai para o buffer); sai de `idle`, recuperação, bloqueio e durante a trava de troca de arma.
8. A dim 6 usa `lockedMs(action)` como janela de exposição; `isPatientAttack` inalterado.
9. `player.cancel` aparece no log com `ctx`; `GAME_VERSION` é `'0.0.2+combatB'`.
10. Suite completa (incluindo a equivalência log → perfil do 5a), typecheck e build limpos.

---

## 3. Parâmetros

| Constante | Arquivo | Hoje | Novo |
|---|---|---|---|
| `PLAYER_MOVE_SPEED` | movementDefs | 160 | **220** |
| `BLOCK_MOVE_SPEED_FACTOR` (novo) | movementDefs | — (parado) | **0.5** |
| `DASH_DISTANCE` | movementDefs | 80 | **120** |
| `DODGE.durationMs` | actionDefs | 250 | **180** |
| `DODGE.iframesMs` | actionDefs | 200 | **150** |
| `DODGE.cooldownMs` | actionDefs | 300 | **200** |
| `STAGGER_MS` | actionDefs | 350 | **250** |
| `SWITCH_RECOVERY_MS` | actionDefs | 250 | **150** |
| `INPUT_BUFFER_MS` (novo) | actionDefs | — | **120** |
| `ASSALTANTE_CHASE_SPEED` | movementDefs | 90 | **125** |

Valores iniciais, ajustáveis em playtest sem mudar a arquitetura. Tempos de ação por arma (`actionRegistry`) não mudam.

---

## 4. Máquina de estados do jogador

### 4.1 Fases do ataque

`acting` ganha uma fase derivada, sem estado novo exposto além do necessário:

| Fase | Ações normais | Carregado | Movimento | Dash | Novo ataque |
|---|---|---|---|---|---|
| **carregando** | — | segurando Q, antes de soltar/atingir `maxHoldMs` | não | **cancela o carregamento** (sem `player.action`) | buffer |
| **preso** (`locked`) | `phase < startupMs + activeMs` | `phase < activeMs` após o disparo | não | buffer | buffer |
| **recuperação** | `lockedMs ≤ phase < totalCommitmentMs` | idem | **cancela → `idle`**, move no mesmo tick | **cancela → dash** | **cancela → novo ataque** |

`PlayerController` ganha `get isInRecovery(): boolean` (usado nos testes e na HUD, se útil).

### 4.2 Cancelamento da recuperação

Em `recuperação`:
- `moveInput ≠ 0` no `step()` → emite `player.cancel {by: 'move', actionId}`, vai para `idle` e aplica o movimento no mesmo passo.
- `tryDodge()` → emite `player.cancel {by: 'dash', actionId}` e inicia o dash.
- `tryAction(id)` → emite `player.cancel {by: 'attack', actionId: <ação anterior>}` e inicia a nova ação (que emite seu próprio `player.action` como hoje).

Ordem dos eventos: `player.cancel` antes do evento da nova ação (`player.dodge` / `player.action`) — causa antes de efeito, consistente com a ordem causal do log do 5a.

### 4.3 Dash

- **Direção:** `moveInput` normalizado se não-zero; senão a direção da mira (`aimDirection`). Substitui `lastMoveDirection`.
- **Disponível em:** `idle`, recuperação (cancelando), `blocking` (encerra o bloqueio), durante a trava de troca de arma (já era), e **carregando** (cancela o carregamento, §4.1). Indisponível em preso e `staggered` (vai ao buffer) e durante o próprio dash / recarga (vai ao buffer).
- Invulnerabilidade nos primeiros `iframesMs` (150 de 180 ms), recarga de 200 ms contada a partir do fim do dash — como hoje, com os valores novos.

### 4.4 Buffer de input

- Guarda **um** input pendente (`{kind: 'attack', actionId} | {kind: 'dash'}`) com o tempo em que foi apertado; um input novo substitui o anterior.
- Entra no buffer quando o input chega num estado em que não pode executar: preso, `staggered`, dashing, recarga de dash (para dash), trava de troca de arma (para ataque).
- A cada `step()`, **depois** de avançar o estado, se há input pendente e ele é executável agora, executa (com os mesmos efeitos e eventos de uma execução direta, incluindo `player.cancel` se cair na recuperação); se passaram mais de `INPUT_BUFFER_MS` desde o aperto, descarta.
- O carregado (Q) não é bufferizado (depende de segurar a tecla); `releaseAction` e bloqueio também não.
- Tempo do buffer é tempo de simulação (soma dos `stepMs`), determinístico.

### 4.5 Bloqueio

`blocking` passa a aplicar `moveInput` com `PLAYER_MOVE_SPEED * BLOCK_MOVE_SPEED_FACTOR`. Parry continua dependendo só de `blockHeldMs < PARRY_WINDOW_MS`. Dash a partir do bloqueio encerra o bloqueio.

### 4.6 O que não muda

Stagger continua travando tudo (só com 250 ms); `idle` continua instantâneo (sem aceleração); troca de arma continua só de `idle`; `emitActionEvent` continua disparando `player.action` no início (normais) ou no disparo (carregado).

---

## 5. Impacto na pesquisa

### 5.1 Dim 6 — nova janela de exposição

```ts
// actionRegistry.ts
/** Non-cancelable part of an action: the player cannot move, dash or act. */
export function lockedMs(action: ActionDef): number {
  return action.actionType === 'charged'
    ? action.timing.activeMs                       // after release; charging itself is dash-cancelable
    : action.timing.startupMs + action.timing.activeMs;
}
```

`Encounter` passa `lockedMs(resolveAction(e.actionId))` para `isPatientAttack` em vez de `totalCommitmentMs`. `totalCommitmentMs` continua sendo a duração total quando o jogador não cancela. A premissa do preditor de ameaça (`predictThreatMs`: jogador parado durante a janela) continua válida porque, na janela preso, o jogador de fato não se move.

Registro no doc consolidado: definição antiga (commitment total, escolha do autor em 12/09) → nova (parte não cancelável, 30/09), motivada pela recuperação cancelável; dados anteriores não comparáveis para a dim 6.

### 5.2 Demais dimensões

- Dims 1, 2: inalteradas (cancelar com ataque gera um novo `player.action` normalmente — combos aumentam a contagem de ações, o que é real).
- Dim 3 (punição): inalterada.
- Dim 4: regras inalteradas; dash mais disponível tende a aumentar `dodge` — é mudança real de comportamento, não de medida.
- Dim 5: definição inalterada; valores mudam com as velocidades novas.

### 5.3 Log e comparabilidade

- Novo evento `player.cancel {by: 'move' | 'dash' | 'attack', actionId}` com `ctx` (entra em `CONTEXT_EVENTS` do `TelemetryRecorder`). É o sinal de "como o jogador sai de um golpe", útil para o preditor.
- `GAME_VERSION = '0.0.2+combatB'`. Logs com versão anterior não são comparáveis para as dims 4–6 (mesmo tratamento da mudança do leque de ataque em 07/09).
- Nenhuma mudança em `obs.*` — a reconstrução exata do perfil (5a) não é afetada.

---

## 6. Arquitetura

Estende o `PlayerController` existente (abordagem escolhida) em vez de reescrever o combate como sistema novo orientado a dados — preserva testes, `threatPrediction` e o hook da dim 6. Para não inchar o controller:

- `src/combat/inputBuffer.ts` (novo, puro): `InputBuffer` com `push(input, nowMs)`, `take(canExecute, nowMs): BufferedInput | null` (retorna e limpa se executável, descarta se expirado), `clear()`. Testável isolado.
- `PlayerController` ganha um relógio de simulação interno (soma dos `stepMs`) para o buffer, e `reset()` limpa o buffer.
- `ArenaScene` não muda o mapeamento de teclas; `setMoveInput` já é chamado a cada frame (é o que alimenta a direção do dash e o cancelamento por movimento).

---

## 7. Testes

| Arquivo | O que prova |
|---|---|
| `combat/inputBuffer.test.ts` | guarda o último input; executa quando `canExecute`; expira após 120 ms; `clear` |
| `combat/playerController.test.ts` (novos) | recuperação cancelada por movimento (move no mesmo tick, `player.cancel{move}`), por dash (`{dash}`, depois `player.dodge`), por ataque (`{attack}`, depois `player.action` da nova); sem input a recuperação termina sozinha sem `player.cancel`; preso bloqueia movimento e dash; dash bufferizado em preso dispara no início da recuperação; buffer expira; dash na direção do input e, sem input, da mira; dash cancela carregamento sem `player.action`; dash sai do bloqueio e da trava de troca; stagger bloqueia dash; bloqueio anda a 50%; `reset` limpa o buffer |
| `combat/actionRegistry.test.ts` | `lockedMs` para ação normal e carregada |
| `combat/encounter.test.ts` | a dim 6 usa `lockedMs`: um ataque cujo `lockedMs` termina antes da ameaça, mas cujo `totalCommitmentMs` não, conta como paciente |
| `telemetry/telemetryRecorder.test.ts` | `player.cancel` é gravado com `ctx` e antes do evento que ele causa |
| Existentes | atualizados onde assumiam trava durante toda a ação ou tempos antigos; os que importam constantes seguem sozinhos; `replay.test.ts` (equivalência) continua passando sem alteração |

---

## 8. Riscos

| Risco | Tratamento |
|---|---|
| Testes existentes da dim 6/threat assumem `totalCommitmentMs` | Atualizar só os que medem a janela; `predictThreatMs` não muda |
| Dash spam invulnerável | Brecha de 30 ms no fim do dash + recarga de 200 ms; se ainda for dominante, cargas/recarga ajustam em playtest |
| Cancelar por movimento torna a recuperação irrelevante para quem sempre anda | É o comportamento desejado (estilo Hades); a punição (dim 3) continua existindo porque o Assaltante também ataca e recupera |
| Números mal calibrados | Constantes centralizadas (§3); ajuste em playtest |
| Bot do teste de equivalência (5a) deixa de cobrir runs/salas com o combate novo | Se as guardas de cobertura falharem, ajustar a cadência do bot (como já previsto no 5a), nunca afrouxar a equivalência |
