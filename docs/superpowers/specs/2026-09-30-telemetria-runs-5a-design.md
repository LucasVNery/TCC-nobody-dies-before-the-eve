# Telemetria persistente e ciclo de runs (sub-projeto 5a) — Design

**Data:** 30/09/2026
**Sub-projeto:** #5a da trilha (`Contexto_pesquisa/instrumento-perfil-adaptativo.md` §5), primeiro passo depois do fechamento da instrumentação (6 de 7 dimensões ligadas)
**Depende de:** `profile/profileAccumulator.ts` (API de escrita + fronteiras + `snapshot()`), `combat/encounter.ts`, `combat/playerController.ts`, `combat/assaltanteController.ts`, `core/eventBus.ts`, `core/events.ts`, `core/fixedTimestepLoop.ts`, `core/prng.ts`, `scenes/ArenaScene.ts`
**Documentos relacionados:** `Contexto_pesquisa/instrumento-perfil-adaptativo.md` §1 (enquadramento), §4 (leitura honesta, item 2), §6 (D4), §17 (desenho experimental e esquema de eventos v2)

---

## 1. Contexto e objetivo

### 1.1 Reenquadramento que motiva este sub-projeto

Na rodada de brainstorming de 30/09/2026 o autor reenquadrou o foco do trabalho:

> **O sistema de análise é o produto.** Ele analisa o jogador em duas camadas complementares — **como ele joga** (as dimensões de perfil já existentes) e **o que ele vai fazer** (um preditor sequencial, sub-projeto 5b) — e o boss usa as duas para ficar mais inteligente. **A eficácia do boss é a validação** de que o jogador foi bem analisado. A melhora do jogador é um produto desse sistema, não a variável central. Um perfil "bem desenvolvido" é aquele com o qual o sistema consegue prever ações e intenções do jogador, e **quanto mais o jogador joga, mais o sistema aprende**.

Consequências diretas para este sub-projeto:

- O perfil deixa de resetar por sessão (revisão da D4, §6 do doc consolidado): ele **acumula entre runs e entre sessões**, e só é zerado por ação explícita.
- O histórico de jogo precisa ser **persistido e reanalisável**: tudo o que não for gravado agora é perdido para o preditor futuro.
- Precisam existir **runs de verdade** (o jogador morre, a run acaba, outra começa), porque hoje o jogo é uma arena contínua sem HP, sem morte e sem fim de combate — o que também impede que as fronteiras de decaimento (`applyEncounterBoundary`/`applyRoomBoundary`) sejam chamadas por qualquer código de jogo.

### 1.2 Objetivo

Entregar a infraestrutura de dados sobre a qual 5b (preditor) e 6 (boss) serão construídos:

1. Ciclo de jogo com HP, morte, encontros, salas e runs, chamando as fronteiras do perfil nos pontos certos.
2. Log de eventos em duas camadas — **observações do perfil** (fonte da verdade para reconstrução) e **contexto** (dados brutos para preditor, reanálise e heatmap futuro).
3. Persistência local (IndexedDB), reconstrução do perfil ao abrir o jogo, "resetar perfil", exportação/importação `.ndjson`.

### 1.3 Decisões de brainstorming desta rodada

| Decisão | Escolha |
|---|---|
| Modo de operação | **Um só modo**, perfil persistente. Sem modo estudo / link de participante / sessão "one-shot" neste sub-projeto. |
| Persistência do histórico | Automática por padrão (IndexedDB), com "resetar perfil" + exportar/importar arquivo (proteção contra limpeza de cache e troca de máquina; também é o canal de coleta para a pesquisa). |
| O que encerra encontro / sala / run | HP + morte na arena atual: Assaltante a 0 HP encerra o **encontro**; K = 3 encontros encerram a **sala**; jogador a 0 HP encerra a **run**. |
| Visibilidade do perfil para o jogador | Nenhuma UI de perfil. Só texto simples no HUD de dev (o redesign de HUD continua pendente). |
| Volume de coleta | "O máximo útil, sem ruído": eventos de combate com contexto + amostras de posição a 4 Hz (libera heatmap futuro, sem desenhá-lo agora). |
| Como o perfil é reconstruído | **Log em duas camadas** (§4): reaplicar as observações `obs.*` gravadas. Rejeitadas: re-simulação por inputs (quebra na primeira mudança de balanceamento — fatal para histórico de meses) e salvar só o estado do perfil (elimina a reanálise). |

---

## 2. Escopo

### 2.1 Entra

- **HP e dano** em `PlayerController` e `AssaltanteController`; constantes novas em `combat/movementDefs.ts` (§3.1).
- `src/game/runDirector.ts` (novo): orquestra encontro → sala → run sobre um `Encounter` único; chama as fronteiras do perfil (§3.2).
- `src/profile/profileSink.ts` (novo): interface `ProfileSink` com os métodos de escrita do perfil; `ProfileAccumulator` a implementa.
- `src/telemetry/` (novo):
  - `schema.ts` — tipos do envelope e de todos os eventos gravados (§4).
  - `recordingProfile.ts` — `RecordingProfile implements ProfileSink`: grava `obs.*` e repassa ao acumulador real; agrega `record()` de alta frequência (§4.2).
  - `telemetryRecorder.ts` — assina o `EventBus`, monta envelope + `ctx`, amostra posição a 4 Hz, mantém o buffer.
  - `eventStore.ts` — interface `EventStore` + `IndexedDbEventStore`.
  - `replay.ts` — `rebuildProfile(events): ProfileAccumulator`.
  - `ndjson.ts` — exportação/importação com deduplicação.
- `combat/encounter.ts`: passa a **receber** o perfil (`ProfileSink`) pelo construtor em vez de criá-lo; ganha `respawnEnemy(pos)` e `resetPlayer(pos)`; emite os eventos de combate novos (§4.3).
- `core/events.ts`: eventos novos do bus (`player.hurt`, `enemy.hurt`, `enemy.death`, `enemy.attack_start`, `player.defense`, `player.death`).
- `scenes/ArenaScene.ts`: instancia `IndexedDbEventStore` → reconstrói o perfil → cria `RunDirector` e `TelemetryRecorder`; HP e "Run N · Sala M · Encontro k/3" no HUD de dev; teclas F7 (resetar perfil), F8 (exportar), F9 (importar) listadas no texto de controles.
- Dependência de desenvolvimento nova: `fake-indexeddb` (só para testes).
- Atualizações no documento consolidado (§8).

### 2.2 Não entra

- Preditor sequencial, métrica de acurácia de previsão, camada de longo prazo sem decaimento — sub-projeto **5b**.
- Boss, pesos de regra, seleção de déficit-alvo — sub-projeto **6**.
- Desenho do heatmap (os dados de posição são gravados, nada é renderizado).
- UI de perfil para o jogador; telas de menu; modo estudo / parâmetros de URL.
- Ação `utility` e regra "segmento < 8 ações não produz H" (pendências já registradas no doc, §2.2 e §12).
- Envio para servidor (a interface `EventStore` permite adicionar depois sem tocar no jogo).
- Mudança no comportamento de IA do Assaltante (além de ter HP e morrer).

### 2.3 Critério de pronto

1. Jogando normalmente: matar o Assaltante 3 vezes encerra a sala; morrer encerra a run e inicia outra com HP cheio; o perfil **não** é zerado entre runs.
2. `applyEncounterBoundary()` é chamada exatamente uma vez por encontro encerrado e `applyRoomBoundary()` exatamente uma vez por sala encerrada (inclusive a sala parcial interrompida pela morte), sempre nessa ordem (encontro antes de sala).
3. Após cada `applyRoomBoundary()`, um `profile.snapshot` com `at: 'room.exit'` é gravado no log.
4. **Equivalência de reconstrução:** o perfil reconstruído a partir do log (`rebuildProfile`) é idêntico ao perfil ao vivo — mesmo `snapshot()`, mesmos `domain`/`confidence`/`omission` em ambos os relógios — num teste que roda várias runs completas simuladas.
5. Recarregar a página reconstrói o perfil e o jogo continua a numeração de runs de onde parou.
6. F7 grava `obs.reset`; a reconstrução seguinte parte do último marcador; o histórico anterior continua no store e na exportação.
7. Exportar → limpar store → importar produz um store com os mesmos eventos (ida e volta sem perda, sem duplicatas mesmo importando duas vezes).
8. Suite completa + typecheck limpos.

---

## 3. Ciclo de jogo

### 3.1 HP e dano

Constantes novas em `combat/movementDefs.ts` (valores iniciais, ajustáveis — anotar no doc §13 como parâmetros de balanceamento):

| Constante | Valor | Uso |
|---|---|---|
| `PLAYER_MAX_HP` | 100 | |
| `ASSALTANTE_MAX_HP` | 60 | |
| `ASSALTANTE_HIT_DAMAGE` | 20 | golpe **não mitigado** no jogador; bloqueio e parry não tiram HP (bloqueio já drena poise) |
| `PLAYER_DAMAGE_BY_ACTION_TYPE` | `light 10 · heavy 20 · charged 30 · throw 10 · utility 0` | dano por golpe do jogador que conecta |
| `ROOM_ENCOUNTER_COUNT` (K) | 3 | encontros por sala |

- `PlayerController.hp`, `takeDamage(n)`, `isDead`; `AssaltanteController.hp`, `takeDamage(n)`, `isDead`.
- **Dano do jogador é aplicado no máximo uma vez por ação**: hoje `Encounter.step()` testa a sobreposição do leque do jogador com o hurtbox do Assaltante a cada tick durante toda a fase ativa. Um guarda `hitAppliedThisAction` (resetado a cada `player.action`) impede que um golpe aplique dano 9 vezes. O `onPlayerHitLanded()` existente (resolução de `punish`) continua sendo chamado como hoje; o dano se soma a ele, não o substitui.
- O dano no jogador acontece no ramo `else` já existente de `Encounter.step()` (golpe não mitigado, que hoje chama `enterStagger()` + emite `player.hit_unmitigated`).
- Um Assaltante morto não ataca nem se move; um jogador morto não aceita input. `RunDirector` trata a morte no mesmo tick (§3.2), então esses estados duram no máximo o tick em que ocorrem.

### 3.2 `RunDirector`

TypeScript puro, sem Phaser, testável isolado. É dono do `Encounter` e da contagem de índices. Após cada `encounter.step(stepMs)`, verifica:

```
se assaltante.isDead:
    emite encounter.end + enemy.death
    profile.applyEncounterBoundary()
    encIdx += 1
    se encIdx == K:
        profile.applyRoomBoundary()
        grava profile.snapshot('room.exit') com partial: false
        roomIdx += 1 ; encIdx = 0 ; emite room.enter
    encounter.respawnEnemy(pontoDeSpawn())      // longe do jogador
    emite encounter.start

se player.isDead:
    emite player.death
    profile.applyEncounterBoundary()           // encontro interrompido conta
    profile.applyRoomBoundary()                // sala interrompida conta
    grava profile.snapshot('room.exit') com partial: true
    emite run.end {cause: 'death', duration_ms, rooms, encounters}
    runIdx += 1 ; novo seed
    encounter.resetPlayer(posInicial) ; encounter.respawnEnemy(...)
    emite run.start, room.enter, encounter.start
```

- **Por que a sala parcial conta:** evidência pendente não aplicada ficaria "vazando" para a primeira sala da run seguinte, misturando runs no snapshot. Marcar `partial: true` preserva a informação para análise sem descartar dados.
- **Ponto de spawn:** escolhido com `createPrng(seed)` da run (primeiro uso real do PRNG em jogo), entre posições candidatas nas bordas da arena, a pelo menos `MIN_SPAWN_DISTANCE` (300 px) do jogador. O `seed` vai no `run.start` — é o que torna uma run reproduzível para análise.
- O `Encounter` **não é recriado**: um único bus, um único conjunto de listeners, e o `TelemetryRecorder` assina uma vez.
- Morte simultânea no mesmo tick (jogador e Assaltante): a morte do jogador tem precedência; o encontro é encerrado uma vez só (via ramo da run).

### 3.3 Mudança em `Encounter`

- Construtor: `new Encounter(playerHurtbox, assaltanteHurtbox, profile: ProfileSink)`. `readonly profile` passa a ser do tipo `ProfileSink`.
- Testes existentes que usam `encounter.profile` para leitura (`snapshot()`, `domain()` etc.) passam um `ProfileAccumulator` real e leem dele diretamente.
- `respawnEnemy(pos)`: HP cheio, estado `idle`, fecha qualquer oportunidade aberta pelo Assaltante (desfecho `invalid`, `reason: 'source_interrupted'` — motivo já existente em `InvalidReason`) para não vazar denominador; reseta `defenseRecordedThisAttack`.
- `resetPlayer(pos)`: HP cheio, poise cheio, estado `idle`, arma padrão.

---

## 4. Log de eventos

### 4.1 Envelope

Toda linha gravada:

```ts
{ v: 2, seq, t_ms, player_id, session_id, run_idx, room_idx, enc_idx, type, ...payload }
```

- `seq`: inteiro monotônico **por sessão**, começa em 0. `(session_id, seq)` é a chave única global.
- `t_ms`: **tempo de simulação** (soma dos `stepMs` do loop fixo), não relógio de parede — determinístico e imune a pausa/aba em segundo plano.
- `player_id`: UUID gerado na primeira execução e guardado no store; identidade do perfil de longo prazo. Sobrevive a "resetar perfil".
- `session_id`: UUID novo a cada abertura do jogo. **Apenas rótulo** — não reseta nada.
- `run_idx`: contador global de runs do `player_id` (continua após recarregar a página; lido do último `run.start` no store).

### 4.2 Camada A — observações do perfil (`obs.*`)

Fonte da verdade para reconstrução. Uma linha por chamada de escrita no perfil:

| Tipo | Payload | Espelha |
|---|---|---|
| `obs.record` | `{skill, num, den}` | `record()` |
| `obs.outcome` | `{skill, outcome}` | `recordOutcome()` |
| `obs.action` | `{actionType, weaponId?}` | `recordAction()` |
| `obs.defense` | `{label}` | `recordDefense()` |
| `obs.boundary` | `{kind: 'encounter' \| 'room'}` | `applyEncounterBoundary()` / `applyRoomBoundary()` |
| `obs.reset` | `{}` | `resetSession()` (disparado só pelo F7) |

**Por que gravar observações e não só eventos brutos:** algumas entradas do perfil são calculadas com estado ao vivo que não está num evento — a dim 6 roda `isPatientAttack()` com a previsão de ameaça daquele instante. Reaplicar as observações reproduz o perfil **exatamente**, e reanalisar com outros γ/κ ou sem uma dimensão (corte D1) sai direto delas. Reanálises que mudam *o que conta* (ex.: nova definição de paciência) usam a camada B, com os limites dos dados gravados.

**Captura:** `ProfileSink` é a interface com os 7 métodos de escrita acima. `ProfileAccumulator implements ProfileSink` (sem mudança de comportamento). `RecordingProfile implements ProfileSink` recebe o acumulador real e o recorder, grava a `obs.*` e repassa a chamada. O `Encounter` só conhece `ProfileSink`.

**Agregação de alta frequência:** a dim 5 (`distance`) chama `record()` a cada tick (60/s). `RecordingProfile` acumula `num`/`den` por `skill` e grava **um** `obs.record` somado quando: (a) passam 250 ms de simulação desde o último flush daquela skill, ou (b) antes de repassar qualquer `applyEncounterBoundary`/`applyRoomBoundary`/`resetSession`. Como `DecayedRatio.add()` só soma em contadores pendentes até a próxima fronteira, somar antes ou depois é aritmeticamente idêntico — **desde que o flush aconteça antes de toda fronteira**, que é exatamente a regra (b). O repasse ao acumulador real continua imediato (o perfil ao vivo não fica atrasado); só a gravação é agregada.

### 4.3 Camada B — contexto

**Ciclo de vida:** `session.start {wall_clock_iso, game_version, schema_v}` · `run.start {seed}` · `run.end {cause, duration_ms, rooms_cleared, encounters_cleared}` · `room.enter` · `encounter.start` · `encounter.end` · `profile.snapshot {partial, ...ProfileSnapshotPayload}`

**Combate** (todos com `ctx`):

| Evento | Payload próprio | Origem |
|---|---|---|
| `player.action` | `{actionId, actionType, weaponId}` | bus (existe) |
| `player.dodge` | `{}` | bus (existe) |
| `player.defense` | `{label}` | novo — emitido onde hoje `recordDefense` é chamado |
| `player.hit_unmitigated` | `{}` | bus (existe) |
| `player.hurt` | `{dmg, hp_after}` | novo |
| `player.death` | `{}` | novo |
| `enemy.attack_start` | `{}` | novo — início do telegraph |
| `enemy.hurt` | `{dmg, hp_after, actionId}` | novo |
| `enemy.death` | `{}` | novo |
| `opp.open` / `opp.close` | como hoje | bus (existe) |

```ts
ctx = { dist, p_pos: [x, y], e_pos: [x, y], aim: [x, y], p_state, e_state,
        p_hp, e_hp, p_poise, weapon, ms_since_last_action }
```

Posições arredondadas a 1 casa decimal; `aim` normalizado a 3 casas. `ms_since_last_action` é `null` antes da primeira ação da run.

**Amostragem:** `pos.sample {p: [x, y], e: [x, y], p_state, e_state}` a cada 250 ms de simulação (4 Hz).

**Tamanho estimado:** < 1 MB por hora de jogo — bem dentro da cota do IndexedDB. Sem rotação/compactação neste sub-projeto (anotar como risco a revisitar se o histórico passar de dezenas de MB).

---

## 5. Persistência e reconstrução

### 5.1 `EventStore`

```ts
interface EventStore {
  append(events: readonly LoggedEvent[]): Promise<void>;
  readAll(): Promise<LoggedEvent[]>;          // ordenado por (sessão em ordem de início, seq)
  getMeta(key: string): Promise<unknown>;     // player_id, etc.
  setMeta(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;                      // só usado por testes e pela importação
}
```

`IndexedDbEventStore`: banco `tcc-telemetry`, object store `events` com chave `[session_id, seq]` (garante a deduplicação por construção) e índice por ordem de gravação; object store `meta`. Implementado sobre a API nativa (sem wrapper de terceiros). Uma implementação em memória (`MemoryEventStore`) serve aos testes de lógica que não precisam de IndexedDB.

### 5.2 Gravação em lote

`TelemetryRecorder` mantém um buffer em memória e chama `store.append()`:
- a cada 2 s de tempo real;
- em todo `run.end`;
- em `visibilitychange` → `hidden` e em `pagehide`.

Perda máxima numa queda abrupta ≈ 2 s. Falha de escrita (cota, modo privado sem IndexedDB) **não trava o jogo**: registra `console.warn` uma vez e o jogo continua só em memória — o perfil ao vivo não depende do store.

### 5.3 Abertura do jogo

1. `store.getMeta('player_id')` ou gera e grava um UUID novo.
2. `store.readAll()` → `rebuildProfile(events)`: cria `ProfileAccumulator` novo e reaplica, em ordem, as `obs.*` **posteriores ao último `obs.reset`**, com os parâmetros atuais do código.
3. `run_idx` inicial = último `run.start.run_idx` + 1 (ou 0).
4. Grava `session.start` e inicia a primeira run.

`resetSession()` deixa de ser chamado na abertura (D4 revisada). Com dezenas de milhares de observações a reaplicação leva milissegundos; checkpoint de perfil fica fora do escopo até ser necessário.

### 5.4 Resetar, exportar, importar (teclas de dev)

- **F7 — resetar perfil:** repassa `resetSession()` via `RecordingProfile` (gera `obs.reset`). Nada é apagado do store.
- **F8 — exportar:** `readAll()` → `.ndjson` (uma linha JSON por evento) baixado como `tcc-historico-<player_id-curto>-<data>.ndjson`.
- **F9 — importar:** seletor de arquivo; valida cada linha (`v === 2`, campos do envelope presentes), **mescla** com o store atual (a chave `[session_id, seq]` descarta duplicatas), adota o `player_id` do arquivo, e reconstrói o perfil. Linhas inválidas são contadas e reportadas em `console.warn`, sem abortar a importação.

---

## 6. Testes

| Arquivo | O que prova |
|---|---|
| `game/runDirector.test.ts` | transições encontro → sala (K = 3) → run; ordem e contagem exatas das fronteiras (spy no `ProfileSink`); sala parcial na morte com `partial: true`; perfil não resetado entre runs; morte simultânea resolvida uma vez; spawn a ≥ 300 px e determinístico dado o seed |
| `telemetry/recordingProfile.test.ts` | cada método de escrita gera a `obs.*` certa e repassa ao acumulador; agregação de `record()` faz flush a 250 ms e antes de toda fronteira |
| `telemetry/replay.test.ts` | **equivalência de reconstrução**: várias runs simuladas via `RunDirector` + `Encounter` reais → `rebuildProfile(log)` produz o mesmo `snapshot()` e os mesmos `domain`/`confidence`/`omission` em ambos os relógios que o perfil ao vivo; reconstrução parte do último `obs.reset` |
| `telemetry/telemetryRecorder.test.ts` | envelope completo e `seq` monotônico; `ctx` presente nos eventos de combate; `pos.sample` a cada 250 ms; flush no `run.end` |
| `telemetry/eventStore.test.ts` | `IndexedDbEventStore` sobre `fake-indexeddb`: ordem de leitura, deduplicação por chave, meta |
| `telemetry/ndjson.test.ts` | ida e volta export → import sem perda; importar duas vezes não duplica; linha inválida é pulada e contada |
| `combat/encounter.test.ts` (casos novos) | dano aplicado uma vez por ação; golpe não mitigado tira HP; bloqueio/parry não tiram; `respawnEnemy` fecha oportunidade aberta como `invalid/source_interrupted` |

A conservação de desfechos (§2.4 do doc) continua valendo: o harness existente deve passar com respawns no meio de ataques.

---

## 7. Riscos e pontos de atenção

| Risco | Tratamento |
|---|---|
| Flush agregado de `record()` depois de uma fronteira quebraria a equivalência em silêncio | Regra (b) do §4.2 + teste de equivalência (§6) que falharia |
| Respawn com oportunidade aberta vazando denominador | Fechamento explícito como `invalid/source_interrupted` + harness de conservação |
| Mudança de balanceamento (HP/dano) torna dados antigos não comparáveis | `game_version` no `session.start`; anotar no doc §3 como a nota de comparabilidade do leque |
| Histórico crescer indefinidamente | Estimativa < 1 MB/h; revisitar com checkpoint/compactação só se necessário |
| Navegador sem IndexedDB (modo privado) | Degrada para memória com aviso; jogo não quebra |
| K = 3 e HPs mal calibrados deixam salas curtas/longas demais para o gate de confiança | Constantes centralizadas; calibrar em playtest, sem mudar a arquitetura |

---

## 8. Atualizações no documento consolidado (mesmo commit desta spec)

- **§1:** novo enquadramento — o sistema de análise (descritivo + preditivo) é o produto; a eficácia do boss é a validação; a melhora do jogador é produto do sistema. A leitura pedagógica passa de pergunta central a consequência discutida.
- **§2.3 e §6 (D4):** "o perfil acumula entre runs e entre sessões; só é zerado por ação explícita (marcador `obs.reset`), sem apagar o histórico".
- **§4 / §5:** trilha revisada — 5a (este), **5b preditor sequencial** (modelo de longo prazo sem esquecimento, previsão da próxima ação, curva de acurácia × tempo de jogo medida offline no log), **6 boss inteligente** (usa perfil + previsões; seleção de padrão a explorar absorve o antigo "déficit-alvo com histerese"; validação por ablação).
- **§17:** marcar o redesenho dos Estudos 1 e 2 como pendente — o Estudo 1 com ICC por sessão independente não se sustenta sem reset por sessão; os eixos candidatos passam a ser acurácia de previsão ao longo do tempo de jogo e ablação do boss.
