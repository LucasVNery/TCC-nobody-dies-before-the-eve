# Estado Atual do Projeto — TCC Roguelike Adaptativo

**Documento gerado em:** 25/08/2026
**Propósito:** dar contexto completo do que já existe (código, decisões, pendências) para cruzar com pesquisa bibliográfica e outros documentos trazidos externamente (Drive). Não é um spec nem um plano — é uma fotografia do estado atual, pra apoiar refinamento do projeto.

---

## 1. O que é o projeto

Um roguelike 2.5D (Phaser 3 + TypeScript) cuja contribuição de pesquisa real não é o jogo em si, mas um **instrumento de pesquisa**: inimigos que se adaptam não para vencer o jogador, mas para criar oportunidades de prática da habilidade que o jogador mais evita — testando se isso produz aprendizado transferível (o jogador melhora de verdade, não só "aprende a matar aquele inimigo específico").

Ideia central articulada pelo usuário nesta sessão (25/08/2026): consumir telemetria rica (dodges efetivos vs. desnecessários, dodges dentro da janela de ataque do boss, heatmap de posição, direção do dash, tipo/frequência de ataque, etc.) para transformar o Boss num inimigo inteligente e perigoso — forçando o jogador a ser hábil e criativo, não apenas repetir o padrão que já domina.

**Documento de arquitetura original** (`arquitetura-tcc-v1_1.md`) é citado por vários specs como a fonte da verdade original, mas **ainda não foi copiado para dentro do repositório** — vive fora, provavelmente no Drive do usuário. Recomendação: localizar/trazer esse arquivo pra dentro de `Contexto_pesquisa/` ou `docs/` antes da próxima rodada de refinamento, porque os specs internos assumem esse documento como pano de fundo e citam seções dele (`v1 §3.5`, `v1 §11`, etc.) sem repetir o conteúdo.

## 2. Decisões de arquitetura travadas (não mudam sem discussão explícita)

| Decisão | Escolha | Onde foi travada |
|---|---|---|
| Câmera | Isométrica de verdade (losango, 2:1), câmera "de ladinho" estilo Hades/Diablo | Spec `2026-08-24-projecao-isometrica-design.md` — revisou a decisão original que dizia "top-down reto" |
| Eixo Z | **Não existe.** Combate inteiro no plano do chão; y-sort/depth isométrico é só ordem de desenho, não física | Spec do núcleo jogável (13/08), reafirmada na migração isométrica |
| Separação lógica/visual | `combat/`, `opportunity/`, `ai/`, `profile/` nunca importam nada de `src/visual/` ou referenciam asset. Só `scenes/ArenaScene.ts` enxerga os dois lados | Travada desde o primeiro spec, mantida em todos os sub-projetos seguintes |
| Ações do jogador | Data-driven desde o início (`actionDefs.ts`, `movementDefs.ts`) — adicionar ação nova é dado, não reescrita | Spec do núcleo jogável |
| Persistência do perfil | Continua entre *runs*, reseta entre *sessões* (não entre tentativas) | `especificacao-perfil-instrumentacao-v2.md` D4 |
| Semântica de outcome de oportunidade | 4 desfechos: `taken`, `missed`, `expired`, `invalid` — `missed`/`expired` contam no denominador, `invalid` não conta em nada | `especificacao-perfil-instrumentacao-v2.md` D2/D3 |
| Mecanismo de suavização do perfil | Contagens decaídas (não EWMA sobre razão) — unifica domínio e confiança num só mecanismo | `especificacao-perfil-instrumentacao-v2.md` D6 |
| Corte de dimensões do perfil | Nenhum corte a priori — mantêm-se as 7 dimensões; corte vira **resultado empírico** do Estudo 1 (ICC(1,1) < 0,50 é removida) | `especificacao-perfil-instrumentacao-v2.md` D1 |
| Stack | Phaser 3 + TypeScript + Vite + Vitest | Desde o início |

## 3. Estrutura de código atual

```
src/
├── core/        loop de timestep fixo (60Hz), PRNG semeado (determinismo), barramento de eventos tipado
├── combat/      hitboxes, ações (data-driven), estados do jogador e do Assaltante, colisão, Encounter (orquestrador)
├── opportunity/ OpportunitySystem — ciclo de vida opp.open/opp.close com os 4 desfechos
├── profile/     ProfileAccumulator (contagens decaídas, genérico por SkillId), profile.snapshot
├── ai/rules/    regras do Assaltante (só isso existe — sem selector/, sem boss, sem pesos)
├── debug/       overlay visual de oportunidades + HUD de contadores (dash efetivo/desperdiçado, hits do boss)
├── visual/      camada de renderização isométrica (projeção, tilemap, sprites direcionais) — 100% desacoplada da lógica
└── scenes/      ArenaScene — única cena, única camada que vê lógica + visual ao mesmo tempo
```

64 commits até agora. Todos os sub-projetos seguiram o mesmo ciclo: spec → plano → implementação (TDD) → revisão.

## 4. Estado de implementação por camada

### `core/` — ✅ completo, estável
Loop de timestep fixo desacoplado do framerate de render, PRNG único semeado (sem `Math.random()` em nenhuma camada de lógica), barramento de eventos tipado (`emit`/`on`).

### `combat/` — ✅ completo pro escopo atual
Um jogador (ataque leve + esquiva com i-frames) contra um arquétipo de inimigo (Assaltante). Hitboxes/hurtboxes AABB, colisão determinística, `Encounter` orquestra tudo e expõe `player`/`assaltante`/`opportunities`/`profile`. Sem boss, sem múltiplos inimigos, sem outras ações (pesado/carregado/aéreo/arremesso/utilitário/bloqueio/contra-ataque) — a estrutura data-driven permite adicionar essas ações como dado, mas nenhuma foi implementada ainda.

### `opportunity/` — ✅ completo
`OpportunitySystem` com os 4 desfechos (`taken`/`missed`/`expired`/`invalid`) e a tabela de precedência (`invalid` > `taken` > `missed` > `expired`). Dois tipos de oportunidade existem hoje: `dodge` (esquivar de um ataque do Assaltante) e `punish` (punir o Assaltante numa janela de recuperação). Testado com harness que verifica que a soma dos desfechos sempre fecha com as aberturas (sem denominador vazando — o modo de falha silenciosa mais perigoso do projeto, já mitigado).

### `profile/` — 🟡 parcial (mecanismo pronto, poucas dimensões ligadas)
`ProfileAccumulator` é genérico (funciona por `SkillId` string, com contagens decaídas em dois "relógios": `trait` — vida toda do jogador — e `state` — janela recente). **Só duas dimensões estão conectadas a dados reais do jogo**:
- **`'punish'`** (dim 3, aproveitamento de punição): numerador = janelas `punish` com outcome `taken`, denominador = janelas `punish` ∈ {`taken`,`missed`,`expired`}. Ligado via evento `opp.close` em `Encounter`.
- **`'distance'`** (dim 5, distância operacional): numerador = tempo em alcance corpo-a-corpo, denominador = tempo total de combate, medido em segundos (não em ticks). Calculado a cada `Encounter.step()`.

`ProfileSnapshotPayload.target` é **sempre `null`** (seleção de déficit-alvo não implementada) e `.lambda` é **sempre `0`** (pesos de regra não implementados) — esses dois campos existem no schema mas são placeholders aguardando os passos 6 e 7 do roadmap (seção 6 abaixo).

### `ai/` — 🟡 mínimo, sem adaptação
Só `assaltanteRules.ts` existe: 2 regras com pré-condição fixa (`attack` se `distanceToPlayer <= ATTACK_RANGE`, senão `chase`), prioridade fixa (primeira regra que casa, vence). **Nada lê o perfil do jogador para influenciar essa decisão.** Não existe `ai/selector/` (mencionado nos specs como estrutura planejada, nunca criado), não existe roleta ponderada, não existe boss, não existe behavior tree.

### `visual/` — ✅ completo pro escopo atual, com placeholders
Migração pra isometria real (losango, projeção 2:1) concluída e mergeada em 25/08/2026. Módulo `isometricProjection.ts` é a única fronteira cartesiano↔tela. Chão usa tiles reais (grama + borda d'água) de um único pacote validado. Jogador e Assaltante ainda são **retângulos coloridos** (azul/vermelho, 20×32, com seta de direção) — nenhum sprite humanoide real foi integrado ainda. Sem animação (idle/walk/attack), sem múltiplos tiles de variação, sem props (árvores etc. — só existe um pacote de árvore em formato 3D `.fbx`/`.obj`/`.dae`, incompatível com o pipeline 2D do Phaser sem pré-renderização).

### `debug/` — ✅ completo pro escopo atual
Overlay visual mostrando abertura/fechamento de oportunidades em tempo real + HUD com contadores (tentativas de dash, dashes efetivos/desperdiçados, hits do boss). Serve só para validação manual — não é telemetria de pesquisa.

## 5. As 7 dimensões do perfil — status detalhado

*(fonte: `docs/especificacao-perfil-instrumentacao-v2.md` §3)*

### Família A — razão sobre oportunidades (numerador/denominador)

| Dim | Nome | Numerador / Denominador | Status |
|---|---|---|---|
| 3 | Aproveitamento de punição | punições `taken` / punições `taken+missed+expired` | ✅ Ligada (`'punish'`) |
| 5 | Distância operacional | tempo em alcance corpo-a-corpo / tempo total de combate | ✅ Ligada (`'distance'`) |
| 6 | Paciência | precisa de "janela segura" como predicado — **ainda sem definição formal**, marcado como pendência no próprio doc de perfil (§3.1, §9) | ❌ Não implementável ainda (falta definir a mecânica antes de codar) |
| 7 | Uso de espaço | precisa de um `OppType` `reposition`, que não existe no jogo hoje | ❌ Bloqueada — não há mecânica de reposicionamento |

### Família B — entropia de repertório (sem numerador/denominador; entropia normalizada direto)

| Dim | Nome | O que mede | Status |
|---|---|---|---|
| 1 | Entropia de repertório de armas | distribuição de uso entre armas desbloqueadas | ❌ Não iniciado — jogo só tem uma "arma" (ataque leve) hoje |
| 2 | Entropia de repertório de ações | distribuição entre {leve, pesado, carregado, aéreo, arremesso, utilitário} | ❌ Não iniciado — só ataque leve + esquiva existem |
| 4 | Entropia de repertório defensivo | distribuição de respostas defensivas | ❌ Não iniciado |

Confiança da Família B usa `κ_H = 25` (entropia precisa de mais amostras que uma razão simples pra estabilizar) — decisão já travada, só não implementada.

**Três casos-limite da entropia** (§3.3 do doc de perfil, importante pra quando for implementar Família B): `n < 2` → dimensão indefinida, não conta pra confiança, nunca pode ser déficit-alvo (ex: jogador com uma arma só não tem "déficit de repertório de armas").

## 6. Roadmap oficial (§8 do doc de perfil) — checklist real

1. ✅ `opp.open`/`opp.close` com os 4 desfechos + precedência
2. ✅ Harness verificando que os desfechos fecham com as aberturas
3. ✅ Acumuladores decaídos + `profile.snapshot`
4. 🟡 Família A (dims 3, 5, 6, 7) — **só 3 e 5 feitas**; 6 e 7 bloqueadas por decisões de design ainda não tomadas
5. ❌ Família B (dims 1, 2, 4) — não iniciado
6. ❌ **Seleção de déficit-alvo com histerese** — não iniciado (`target` sempre `null`)
7. ❌ **Pesos de regra + parâmetros de BT** — não iniciado (`lambda` sempre `0`), sem boss

> Nota do próprio doc: "O Estudo 1 pode rodar ao fim do passo 5 — não precisa da adaptação funcionando, porque o perfil precisa ser provado estável **antes** de qualquer coisa ser construída em cima dele."

**Leitura honesta do estágio atual:** o projeto está na fase de **instrumentação/perfil** (aproximadamente metade da Família A), não na fase de **adaptação**. O jogador já gera dados de perfil em tempo real, mas **nenhum inimigo reage a esses dados ainda** — essa ponte (déficit-alvo → peso de regra → comportamento do inimigo) é o próximo bloco grande de trabalho e é onde a contribuição central da tese (o mecanismo adaptativo em si) começa a existir em código de verdade.

## 7. Pendências abertas herdadas dos specs (`especificacao-perfil-instrumentacao-v2.md` §9)

- **Humanos vs. agentes sintéticos como participantes** — sem impacto no formato de dados (`participant` serve aos dois), mas impacta cálculo amostral e comitê de ética. Não decidido.
- **Retenção em segunda sessão** — decisão adiada, mas o esquema de dados já está preparado pra suportar (mesmo `participant`, `session_idx` diferente).
- **Eixo Z real no combate** — bloqueia a dim 7 (uso de espaço) e a ação `aéreo` da dim 2 (entropia de ações). Precisa ser decidido antes do passo 4 completo do §8. Hoje a decisão travada é "não existe eixo Z" — mudar isso é uma decisão de arquitetura grande, não um ajuste pequeno.
- **Verificação bibliográfica de 11 entradas** marcadas no doc original — pendência de revisão de literatura, não de código.
- **Corte empírico das 7 dimensões** só pode acontecer depois do Estudo 1 rodar (calcula ICC(1,1) por dimensão).

## 8. Ideia trazida pelo usuário nesta sessão (25/08/2026) — ainda não é spec, é input bruto

Telemetria mais rica que os specs atuais preveem, pensada especificamente para alimentar o Boss:
- Dodges efetivos contra ataques (vs. dodges "desnecessários" — usados só pra movimentação, sem intenção defensiva)
- Dodges que caem dentro da janela real de ataque do boss (timing preciso, não só "esquivou")
- Heatmap de posição do jogador na arena
- Direção do dash
- Tipos de ataque usados e frequência

**Como isso se relaciona com o que já existe:** parte disso já tem gancho na arquitetura atual — "dodge efetivo vs. desnecessário" é essencialmente uma dimensão de Família A (razão sobre oportunidades, parecido com dim 3/5), e "dentro da janela de ataque" já é literalmente o que `OpportunitySystem` mede (`window_ms`, outcome `taken` vs `missed`/`expired`). Heatmap e direção de dash são dados novos — não mapeiam diretamente pra nenhuma das 7 dimensões documentadas; seriam telemetria adicional (posição por tick, vetor de dash) mais parecida com o que a v1 do doc de arquitetura chama de "telemetria de rede" (explicitamente fora de escopo em todos os sub-projetos até agora).

**Recomendação registrada nesta sessão** (ainda não decidida/aprovada — só documentada pra continuidade): fechar primeiro o loop mínimo ponta-a-ponta (déficit-alvo com histerese + pesos de regra mínimos no Assaltante, usando só dims 3+5 que já existem) antes de expandir a telemetria. Razão: validar o formato real que a adaptação precisa antes de investir em coleta rica que pode precisar ser remodelada depois que o mecanismo de adaptação estiver rodando de verdade.

## 9. Documentos-fonte no repositório (specs, na ordem cronológica dos sub-projetos)

1. `docs/superpowers/specs/2026-08-13-nucleo-jogavel-opportunitysystem-design.md` — núcleo jogável mínimo + OpportunitySystem
2. `docs/superpowers/specs/2026-08-13-sistema-movimento-camera-design.md` — movimento livre + câmera
3. `docs/superpowers/specs/2026-08-18-esqueleto-visual-2-5d-design.md` — camada visual sprite-based (pré-isometria)
4. `docs/superpowers/specs/2026-08-18-ciclo-vida-oportunidade-design.md` — os 4 desfechos formalizados
5. `docs/superpowers/specs/2026-08-18-acumuladores-decaidos-design.md` — `ProfileAccumulator`
6. `docs/superpowers/specs/2026-08-18-familia-a-dims-3-5-design.md` — dims 3+5 ligadas a dados reais
7. `docs/superpowers/specs/2026-08-24-projecao-isometrica-design.md` — migração pra isometria real
8. `docs/especificacao-perfil-instrumentacao-v2.md` — documento "guarda-chuva" do perfil/telemetria, substitui partes da v1 original
9. `docs/superpowers/plans/*.md` — um plano de implementação por spec acima (mesmo nome, pasta `plans/`)

**Ausente do repositório:** `arquitetura-tcc-v1_1.md` (documento raiz original, citado por todos acima). Precisa ser localizado/trazido.

## 10. Como usar este documento

Isso é uma fotografia de 25/08/2026 — vai ficar desatualizado conforme o projeto avança. Quando voltar com mais pesquisa/dados do Drive, o próximo passo natural é: (1) trazer o `arquitetura-tcc-v1_1.md` original pra dentro do repo ou desta pasta, (2) cruzar a ideia de telemetria rica da seção 8 com a literatura que você está revisando, (3) decidir se o próximo sub-projeto é "fechar o loop mínimo" (déficit-alvo + pesos) ou se a pesquisa aponta pra outra prioridade.
