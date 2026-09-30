# Instrumento de Perfil Adaptativo — Documento de Referência

**Atualizado:** 30/09/2026 (reenquadramento da §1, D4 revisada, trilha 5a/5b/6, Estudos pendentes de redesenho) · revisão completa anterior em 28/09/2026
**Stack:** Phaser 3.90 · TypeScript 5.9 · Vite 5.4 · Vitest 2.1 · Node.js 24 · Blender 5.2 (pipeline de assets)
**Estágio:** instrumentação no jogo completa (passos 1–5 de 7, 6 de 7 dimensões ligadas). Ainda faltam a estrutura de sala/sessão e a exportação de telemetria para o Estudo 1. A adaptação (passos 6–7) ainda não começou.

Roguelike isométrico cuja contribuição de pesquisa não é o jogo, mas um instrumento de medição: um perfil de sete dimensões que detecta o que o jogador evita, e um boss que usa esse perfil para forçar prática da habilidade evitada.

> Documento gerado a partir dos specs em `docs/superpowers/specs/`, dos planos em `docs/superpowers/plans/`, da especificação de perfil `docs/especificacao-perfil-instrumentacao-v2.md`, do pipeline em `tools/blender/`, do histórico git e do estado do código em `src/`. É uma fotografia e vai desatualizar conforme o projeto avança.
>
> Versão navegável (Artifact, pode estar desatualizada em relação a este arquivo): https://claude.ai/code/artifact/12ec32ec-d477-4993-bd33-525bd6245efb

---

## Sumário

**Parte I: Pesquisa**
1. [Objetivo de pesquisa](#1-objetivo-de-pesquisa)
2. [As duas famílias](#2-as-duas-famílias)
3. [Registro das 7 dimensões](#3-registro-das-7-dimensões)
4. [Estágio atual](#4-estágio-atual)
5. [Trilha de sub-projetos](#5-trilha-de-sub-projetos)
6. [Decisões travadas](#6-decisões-travadas)

**Parte II: Tecnologia**
7. [Tecnologias avaliadas](#7-tecnologias-avaliadas)
8. [Referências científicas](#8-referências-científicas)
9. [Pendências abertas](#9-pendências-abertas)
10. [Stack tecnológica completa](#10-stack-tecnológica-completa)
11. [Arquitetura de software](#11-arquitetura-de-software)
12. [Algoritmos e modelos matemáticos implementados](#12-algoritmos-e-modelos-matemáticos-implementados)
13. [Mecânicas de jogo e parâmetros](#13-mecânicas-de-jogo-e-parâmetros)
14. [Pipeline de assets 3D → sprites](#14-pipeline-de-assets-3d--sprites)

**Parte III: Processo**
15. [Metodologia de desenvolvimento](#15-metodologia-de-desenvolvimento)
16. [Verificação, validação e lições aprendidas](#16-verificação-validação-e-lições-aprendidas)
17. [Desenho experimental planejado](#17-desenho-experimental-planejado)
18. [Cronologia do projeto](#18-cronologia-do-projeto)
19. [Métricas do repositório](#19-métricas-do-repositório)
20. [Mapa para os capítulos do TCC](#20-mapa-para-os-capítulos-do-tcc)

---

# PARTE I: PESQUISA

## 1. Objetivo de pesquisa

O jogo é um **instrumento**. A pergunta da tese não é "esse inimigo é divertido" nem "esse algoritmo vence o jogador", e sim: **um inimigo que adapta seu comportamento para criar oportunidades de prática da habilidade que o jogador evita produz aprendizado transferível?** Em outras palavras, o jogador melhora de verdade ou só aprende a matar aquele inimigo específico?

### 1.1 O enquadramento reconciliado

Duas leituras do projeto coexistiam e precisavam ser unificadas:

- **Pedagógica:** o inimigo cria oportunidades de prática, e a variável medida é aprendizado transferível.
- **Adversarial:** o boss prevê o jogador para abrir janelas de ataque para si mesmo.

São perguntas de pesquisa diferentes, com experimentos diferentes, mas existe uma ponte entre elas.

> **DECISÃO DE ENQUADRAMENTO**
>
> O preditor do boss **não existe para maximizar dano**. Ele existe para fazer com que *previsível = ineficaz*: quando o modelo prevê a ação do jogador com alta confiança, o boss escolhe a resposta que **nega aquele padrão**, forçando o jogador a sair do vício.
>
> "Abrir janela de ataque para o boss" e "criar oportunidade de prática da habilidade evitada" passam a ser **a mesma operação, vista dos dois lados**. Isso preserva a tese original e entrega a sensação de um boss inteligente que pune repetição.

> **REENQUADRAMENTO (30/09/2026, autor) — substitui a ênfase pedagógica acima como foco central**
>
> **O sistema de análise é o produto.** Ele analisa o jogador em duas camadas complementares: **como ele joga** (as dimensões de perfil, §2–§3) e **o que ele vai fazer** (um preditor sequencial, sub-projeto 5b). O boss usa as duas para ficar mais inteligente, e **a eficácia do boss é a validação** de que o jogador foi bem analisado. Um perfil "bem desenvolvido" é aquele com o qual o sistema consegue prever ações e intenções do jogador, e **quanto mais o jogador joga, mais o sistema aprende**.
>
> A melhora do jogador passa a ser **produto do sistema**, discutida como consequência, e não mais a variável central (a pergunta de transferência acima deixa de ser a pergunta da tese). A leitura "previsível = ineficaz" continua válida como *uma* das estratégias do boss. Spec de origem: `docs/superpowers/specs/2026-09-30-telemetria-runs-5a-design.md` §1.1. **Pendente:** reescrever o texto desta seção e da §1.3 à luz do reenquadramento, e revisar a função das referências pedagógicas (§8.3).

### 1.2 Quem adapta, e quem não adapta

Decisão travada: **apenas o boss adapta** (reconfirmada pelo autor em 12/09/2026).

Os inimigos comuns têm IA fixa e funcionam como instrumento de coleta estável. É diante deles que o perfil do jogador é medido, sem que a própria medição altere o alvo. Cada arquétipo comum pode ter mecânicas próprias, mas nenhum lê o perfil. O boss consome o perfil **congelado na entrada** da sala e concentra toda a adaptação num único ponto, o que isola a variável experimental.

> **CONFUNDIDOR DESCARTADO**
>
> "Inimigos progressivamente mais fortes" foi **rejeitado** como mecânica. Uma rampa monotônica de dificuldade impede separar "o jogador aprendeu" de "o jogo ficou mais difícil" nos dados. Se houver progressão, ela precisa ser idêntica entre o grupo controle e o grupo adaptativo.

### 1.3 Posicionamento em relação à literatura

| Campo | Relação com este trabalho |
|---|---|
| Ajuste Dinâmico de Dificuldade (DDA) | **Delimitação por contraste.** DDA adapta para manter taxa de vitória/fluxo; este trabalho adapta para criar oportunidade de prática de uma habilidade específica, e a dificuldade não é o alvo. |
| *Player modeling* | O perfil de 7 dimensões é um modelo de jogador **baseado em comportamento observado** (não em auto-relato nem em fisiologia), com dois horizontes temporais (traço e estado). |
| IA adaptativa de jogo (Dynamic Scripting) | Mecanismo planejado para o boss: pesos de regra ajustados pelo déficit-alvo. |
| Predição de ações do jogador (N-gram) | Mecanismo planejado para o boss "negar o padrão previsível". |
| Prática deliberada / transferência | Fundamentação pedagógica: prática dirigida à fraqueza, medida por transferência **próxima**. |
| Psicometria (ICC) | Validação do instrumento: cada dimensão precisa ser estável (confiável) antes de ser usada para adaptar. |

---

## 2. As duas famílias

As sete dimensões não compartilham matemática. Tratá-las na mesma tabela foi o erro da v1 da especificação.

### 2.1 Família A: razão sobre oportunidades

Dimensões **3, 5, 6 e 7**. Cada uma tem numerador e denominador reais: quantas oportunidades apareceram e quantas o jogador aproveitou. O domínio usa um prior Beta (α = β = 1) para não explodir com poucas amostras. É, na prática, a média posterior de uma Beta-Binomial com prior uniforme (regra de sucessão de Laplace).

```
domínio(s)   = (aproveitadas_s + α) / (oportunidades_s + α + β)   α = β = 1
déficit(s)   = 1 − domínio(s)
confiança(s) = oportunidades_s / (oportunidades_s + κ)            κ = 10
```

Com κ = 10, a confiança cruza o gate de 0,60 em exatamente 15 oportunidades (15/25 = 0,6).

### 2.2 Família B: entropia de repertório

Dimensões **1, 2 e 4**. Não têm numerador nem denominador de oportunidade: o valor *é* a entropia de Shannon normalizada da distribuição de uso. É aqui que vivem o "vício" e a "criatividade". Um jogador que só usa uma opção tem entropia baixa, ou seja, déficit de repertório.

```
p_i          = count_i / Σ count              i sobre rótulos com count > 0
domínio(s)   = H(s) = −Σ p_i·ln(p_i) / ln(n)
déficit(s)   = 1 − H(s)
confiança(s) = contagem_s / (contagem_s + κ_H)   κ_H = 25
```

`n` é o número de opções **disponíveis** ao jogador, não o número de opções que ele usou. Um jogador com 5 ações disponíveis que só usa 2 (em proporção igual) tem `H = ln(2)/ln(5) ≈ 0,43`, o que é um déficit real. O `κ_H` é maior que o `κ` da Família A porque a entropia precisa de mais amostras que uma razão simples para estabilizar (gate 0,6 em 37,5 ações).

#### Casos-limite da entropia

| Situação | `domínio()` | Conta p/ confiança | Pode ser déficit-alvo |
|---|---|---|---|
| `totalCount == 0` | `null` | não | não |
| 1 rótulo distinto (n efetivo < 2) | `null` | sim | **não** |
| ≥ 2 rótulos distintos | `H ∈ [0, 1]` | sim | sim |

A regra do meio evita um absurdo: um jogador com uma arma só não tem "déficit de repertório de armas", ele tem uma arma só.

> **Nota de implementação:** a spec v2 §3.3 prevê ainda (a) `n` mudando só em fronteira de sala, com `H` calculado por segmento, e (b) segmentos com menos de 8 ações não produzindo `H`. No código atual, `n` é **fixo** (3 armas, 5 tipos de ação e 4 defesas estão sempre disponíveis, sem desbloqueio), então (a) não se aplica ainda. A regra (b) **não está implementada**: a instabilidade com poucas amostras é tratada só pela confiança `κ_H`. Isso deve ser mencionado no texto ou implementado antes do Estudo 1.

### 2.3 Mecanismo comum: contagens decaídas

As duas famílias usam **contagens decaídas** em vez de EWMA sobre a razão. Isso unifica domínio e confiança num só mecanismo, porque a confiança "esquece" junto com o domínio. Cada dimensão roda em dois relógios independentes:

| Relógio | γ | Meia-vida | Decai em | Representa | Consumido por |
|---|---|---|---|---|---|
| `trait` | 0,87 | ≈ 5 salas (ln 0,5 / ln 0,87 ≈ 4,98) | saída de sala | o jogador ao longo da sessão | boss (congelado na entrada), Estudo 1 |
| `state` | 0,55 | ≈ 1,2 encontro | fim de encontro | a janela recente | inimigos comuns (nenhum consome hoje) |

```
contagem ← γ · contagem + novas_contagens_desde_a_última_fronteira
```

O perfil **persiste entre runs e entre sessões** (D4 revisada em 30/09/2026; antes resetava por sessão), porque é do jogador e não da tentativa. Só é zerado por ação explícita, que grava um marcador sem apagar o histórico. Num roguelike com mortes frequentes, resetar por run faria a confiança nunca cruzar o gate de 0,6, e a adaptação nunca ligaria (o grupo adaptativo viraria, sem ninguém perceber, um segundo grupo controle).

Implementação: a evidência nova fica em contadores "pendentes" e só é dobrada (*folded*) na próxima chamada de `decay(γ)`. O `snapshot()` só expõe dimensões que já passaram por pelo menos uma fronteira de sala.

### 2.4 Os quatro desfechos de oportunidade

Toda janela anotada pelo `OpportunitySystem` fecha com exatamente um desfecho, resolvido por tabela de precedência (`invalid` > `taken` > `missed` > `expired`):

| Desfecho | Numerador | Denominador | Significado diagnóstico |
|---|---|---|---|
| `taken` | sim | sim | aproveitou a janela |
| `missed` | não | sim | tentou e errou |
| `expired` | não | sim | não tentou; alimenta o sinal de *omissão* |
| `invalid` | não | **não** | janela nunca foi realmente oferecida; exige `reason` para auditoria |

Motivos canônicos de `invalid` (tipo `InvalidReason`): `other_source_hitstun`, `out_of_range`, `player_dead`, `tool_locked`, `source_interrupted`, `overlapping_priority`. Hoje só `out_of_range` é emitido de fato (janela de punição em que o jogador nunca esteve ao alcance).

**Sinal de omissão** (implementado em `ProfileAccumulator.omission()`, ainda não consumido):

```
omissão(s) = expired_s / (expired_s + missed_s)
```

| Leitura | Interpretação | Resposta planejada |
|---|---|---|
| `> 0,65` | o jogador **não vê ou não conhece** a opção | aumentar legibilidade (janela/telegrafia maiores); não aumentar dificuldade |
| `< 0,35` | o jogador **conhece e executa mal** | manter janela, aumentar repetições |
| entre as duas | misto | comportamento padrão |

É a distinção entre *andaime* e *carga* da exposição graduada.

> **MODO DE FALHA JÁ MITIGADO**
>
> Um denominador "vazando" (janela aberta que nunca fecha) corromperia todas as razões em silêncio. Existe um harness de teste que verifica que a soma dos desfechos sempre fecha com o número de aberturas (lei de conservação), inclusive com *listeners* reentrantes.

---

## 3. Registro das 7 dimensões

Nenhum corte a priori. As dimensões que sobrevivem são resultado empírico do Estudo 1, não decisão de projeto.

| # | Dimensão | `SkillId` no código | Fam. | Distribuição ou razão | Status |
|---|---|---|---|---|---|
| 1 | Repertório de armas | `weapon_repertoire` | B | uso entre `{sword_shield, bow, heavy_weapon}` · **n = 3** | ✅ Ligada |
| 2 | Repertório de ações | `action_repertoire` | B | `{light, heavy, charged, throw, utility}` · **n = 5** | ✅ Ligada |
| 3 | Aproveitamento de punição | `punish` | A | punições `taken` / `taken+missed+expired` | ✅ Ligada |
| 4 | Repertório defensivo | `defensive_repertoire` | B | `{dodge, block, parry, retreat}` · **n = 4** | ✅ Ligada |
| 5 | Distância operacional | `distance` | A | segundos em alcance corpo-a-corpo / segundos de combate | ✅ Ligada |
| 6 | Paciência / comprometimento | `patience` | A | ataques iniciados em janela segura / total de ataques | ✅ Ligada |
| 7 | Uso de espaço | — | A | oportunidades `reposition` `taken` / total | ❌ Fora de escopo (sem `OppType reposition`, sem eixo Z) |

**Seis das sete** estão conectadas a dados reais do jogo. A dim 7 segue fora de escopo por decisão de arquitetura (sem eixo Z), não por falta de instrumentação.

### 3.1 Como cada dimensão é alimentada (rastreável no código)

| Dim | Evento/gatilho | Onde | Detalhe |
|---|---|---|---|
| 1, 2 | `player.action` (com `actionType`, `weaponId`) | `Encounter` → `profile.recordAction()` | ação carregada só conta quando é **executada** (soltar o botão ou atingir `maxHoldMs`), não ao começar a carregar |
| 3 | `opp.close` do tipo `punish` com desfecho ≠ `invalid` | `Encounter` → `profile.recordOutcome('punish', …)` | janela de punição = fase de recuperação do Assaltante (500 ms; 750 ms após parry) |
| 4 | colisão do golpe inimigo + estado do jogador | `Encounter.step()` | `dodge` via evento `player.dodge` durante o ataque; `parry`/`block` resolvidos na colisão; `retreat` inferido quando a janela de esquiva expira sem contato e sem defesa. **No máximo um rótulo por ataque** (guarda `defenseRecordedThisAttack`) |
| 5 | todo passo de simulação | `Encounter.step()` | `record('distance', emAlcance ? Δt : 0, Δt)` em **segundos** (correção de 18/08: antes era ms, o que distorcia a confiança) |
| 6 | `player.action` | `Encounter` → `isPatientAttack()` | janela segura = nenhum inimigo consegue atingir o jogador durante o **comprometimento total** da ação (ver §12.6) |

> **RISCO ACEITO**
>
> Sete dimensões dividem o mesmo orçamento de oportunidades por sala, o que rala os denominadores e atrasa o gate de confiança. Mitigação obrigatória: o orçamento mínimo por sala precisa ser dimensionado para 7 dimensões, não para 4.

> **ATENÇÃO: COMPARABILIDADE DE DADOS**
>
> A troca do hitbox retangular de 4 quadrantes pelo leque angular (07/09/2026, §16.3) mudou quando os ataques conectam (cobertura lateral de ±10 px para ±55 px no alcance máximo). Qualquer dado de playtest coletado **antes** dessa correção **não é comparável** com os dados posteriores, especialmente para as dims 3, 4 e 6.

---

## 4. Estágio atual

O roadmap oficial tem sete passos. A instrumentação dentro do jogo está completa, mas a metade de adaptação ainda não existe em código.

| # | Passo | Status | Nota |
|---|---|---|---|
| 1 | `opp.open`/`opp.close` com os 4 desfechos e precedência | ✅ Feito | |
| 2 | Harness verificando que os desfechos fecham com as aberturas | ✅ Feito | |
| 3 | Acumuladores decaídos + `profile.snapshot` | ✅ Feito (como API) | o formato existe e é testado, mas **nenhum código de jogo chama** `applyRoomBoundary()`, `applyEncounterBoundary()`, `snapshot()` ou `resetSession()`, porque ainda não existem salas nem sessões |
| 4 | Família A: dims 3, 5, 6, 7 | ✅ Feito no escopo | 3, 5 e 6 ligadas; 7 fora de escopo |
| 5 | Família B: dims 1, 2, 4 | ✅ Feito | entropia de repertório de arma/ação/defesa |
| 6 | Seleção de déficit-alvo com histerese | ❌ Não iniciado | `snapshot.target` é sempre `null` |
| 7 | Pesos de regra, boss adaptativo e preditor | ❌ Não iniciado | `snapshot.lambda` é sempre `0` |

> **LEITURA HONESTA (revisada em 28/09/2026)**
>
> O jogador já gera dados de perfil em tempo real, mas:
>
> 1. **Nenhum inimigo reage a esses dados ainda.** A ponte déficit-alvo → peso de regra → comportamento do inimigo é onde a contribuição central da tese começa a existir em código, e ela está inteiramente à frente.
> 2. **O Estudo 1 ainda não pode rodar de verdade**, ao contrário do que versões anteriores deste documento diziam. O perfil existe só em memória, dentro de uma única arena contínua. Faltam: (a) estrutura de sala/encontro que chame as fronteiras de decaimento; (b) envelope de sessão/participante (`session.start`, `participant`, `session_idx`, `condition`); (c) **persistência/exportação** dos eventos e dos `profile.snapshot` (arquivo JSON/NDJSON ou endpoint); (d) protocolo de coleta. Isso é um sub-projeto de "telemetria mínima para o Estudo 1" que precisa entrar na trilha (§5).
>
> A ordem, porém, está certa: o perfil precisa ser *provado estável* antes de qualquer coisa ser construída em cima dele.

### 4.1 Estado por camada de código

| Camada | Conteúdo | Status |
|---|---|---|
| `core/` | loop de timestep fixo 60 Hz, PRNG semeado (Mulberry32), barramento de eventos tipado | ✅ Completo |
| `combat/` | registro de ações data-driven (3 armas, 7 ações), jogador (5 estados), Assaltante (4 estados), leque de ataque angular, predição de ameaça, `Encounter` | ✅ Completo p/ escopo |
| `opportunity/` | `OpportunitySystem` com 4 desfechos; tipos `dodge` e `punish` | ✅ Completo |
| `profile/` | `DecayedRatio`, `DecayedCount`, `EntropyAccumulator`, `ProfileAccumulator`; 6 de 7 dimensões ligadas | ✅ Completo p/ escopo |
| `ai/` | 2 regras fixas do Assaltante (`attack`, `chase`) com `opportunity_tags`; nada lê o perfil | 🟡 Mínimo |
| `visual/` | projeção isométrica 2:1, tiles reais, **sprites 3D pré-renderizados em 8 direções** (idle/walk) | ✅ Completo p/ escopo |
| `debug/` | overlay de oportunidades, HUD de contadores, desenho de hurtbox/leque/alcance | ✅ Completo |
| `scenes/` | `ArenaScene`, a única cena e a única camada que enxerga lógica e visual | ✅ |
| telemetria/persistência | exportação de eventos e snapshots | ❌ Não existe |

O determinismo é um ativo de pesquisa deliberado: **um único PRNG semeado**, sem `Math.random()` em nenhuma camada de lógica, e loop de timestep fixo desacoplado do framerate de render. Isso torna qualquer sessão reproduzível por replay. *Observação:* a lógica atual é 100% determinística mesmo sem consumir o PRNG, porque nenhuma regra ainda sorteia nada. O PRNG está pronto para a roleta ponderada do boss (passo 7).

---

## 5. Trilha de sub-projetos

Cada passo é um ciclo completo: spec → plano → implementação TDD → revisão. O fatiamento vertical é fino, e cada passo entrega uma dimensão medindo de ponta a ponta.

### 5.1 Sub-projetos já concluídos (ordem cronológica)

| Data | Sub-projeto | Entrega principal |
|---|---|---|
| 13/08 | Núcleo jogável + `OpportunitySystem` | loop fixo, PRNG, event bus, jogador (ataque leve + esquiva), Assaltante, oportunidades `dodge`/`punish`, overlay de debug |
| 13/08 | Movimento e câmera | movimento livre em 8 direções, dash direcional, perseguição, câmera seguindo o jogador |
| 18/08 | Esqueleto visual 2.5D | registro de assets, texturas placeholder, tilemap, sprite direcional com seta |
| 18/08 | Ciclo de vida da oportunidade | os 4 desfechos, `reason` obrigatório para `invalid`, gancho de expiração customizado |
| 18/08 | Acumuladores decaídos | `DecayedRatio`, `ProfileAccumulator` com relógios traço/estado, formato `profile.snapshot` |
| 18/08 | Família A: dims 3 + 5 | punição e distância operacional ligadas a dados reais |
| 24–25/08 | Projeção isométrica | migração de top-down para isometria real 2:1, tiles reais, WASD rotacionado 45° |
| 06/09 | Registro de ações + entropia (**dim 2**) | refatoração do `PlayerController` para modelo data-driven; ações leve/pesado/carregado; `EntropyAccumulator` |
| 06/09 | Mira por mouse + arco + arma pesada + troca (**dim 1**) | 3 armas carregadas ao mesmo tempo, troca com recovery de 250 ms cancelável por esquiva, `fromScreen` |
| 07/09 | Pipeline de assets 3D | KayKit + Blender headless → sprite sheets 8 direções idle/walk |
| 07/09 | Kit defensivo + barra de postura (**dim 4**) | bloqueio, parry, recuo, postura, stagger |
| 07/09 | Leque de ataque em ângulo livre | `AttackSector` substitui o AABB de 4 quadrantes (corrige falso `retreat` na dim 4) |
| 12/09 | Predicado de janela segura (**dim 6**) | `ThreatAssessor`, `predictThreatMs`, `isPatientAttack` |

### 5.2 Próximos passos

| # | Sub-projeto | Entrega | Status |
|---|---|---|---|
*Trilha revisada em 30/09/2026 após o reenquadramento da §1.*

| # | Sub-projeto | Entrega | Status |
|---|---|---|---|
| — | Correção de direção dos sprites | inversão de linha removida e `ROW_ROTATION_OFFSET = 4`; Assaltante olha para a direção da perseguição; remoção do "manequim fantasma" no Blender | ✅ `7d48c4e` |
| 5a | **Telemetria persistente e ciclo de runs** | HP, morte, encontros (Assaltante morre), salas (K = 3 encontros), runs (jogador morre); fronteiras de decaimento chamadas pelo jogo; log em duas camadas (observações do perfil + contexto) em IndexedDB; reconstrução do perfil ao abrir; resetar/exportar/importar `.ndjson`. Spec: `docs/superpowers/specs/2026-09-30-telemetria-runs-5a-design.md` | Spec escrita |
| 5b | **Preditor sequencial** | modelo de longo prazo **sem esquecimento** (acumula com o jogo), previsão da próxima ação a partir de sequência + contexto (N-gram, §8.1), **curva de acurácia × tempo de jogo** medida offline sobre o log do 5a | Planejado |
| 6 | **Boss inteligente** | boss que usa perfil (como joga) + previsões (o que vai fazer); a escolha de qual padrão explorar absorve o antigo passo "déficit-alvo com histerese"; validação por **ablação** (mesmo boss com e sem o modelo) | Planejado |

### 5.3 Decisões de design do repertório

| Questão | Decisão | Consequência de medição |
|---|---|---|
| Acesso às armas | Carrega as 3, troca livre em combate (teclas 1/2/3) | dim 1 com `n=3` fixo dentro da run; o vício aparece como distribuição enviesada |
| Custo da troca | 250 ms de recovery, cancelável por esquiva | a troca vira decisão tática, não reflexo, e gera janela previsível que o boss pode aprender a punir |
| Ação carregada | Não é ação à parte: é `actionType: 'charged'` com campo `charge`; alcance interpola linearmente com o tempo segurado | uma entrada na tabela de ações, não um estado novo na máquina |
| Defesas | Bloqueio e parry universais (mesma tecla, timing decide) | dim 4 com `n=4` fixo e **sem efeito de loadout**, o que a deixa mais limpa para o ICC |
| Custo do bloqueio | Barra de postura exclusiva do bloqueio; sem stamina global | stamina global acoplaria ofensiva e defensiva e contaminaria as dims 2 e 4 de uma vez |
| Esquiva vs. recuo | Esquiva tem i-frames (vence por timing); recuo não tem (vence por espaçamento) | categorias disjuntas, então a entropia da dim 4 não mede ruído |
| Mira | Mouse contínuo (360°), separada do movimento WASD | exigiu `fromScreen` (inversa da projeção) e depois o leque angular |

---

## 6. Decisões travadas

Não mudam sem discussão explícita. Cada uma tem um documento de origem citável.

| ID | Questão | Decisão |
|---|---|---|
| D1 | Corte de dimensões | Nenhum corte a priori: mantêm-se as 7. Dimensões com `ICC(1,1) < 0,50` no Estudo 1 são removidas antes do Estudo 2. *O corte vira resultado do trabalho, com justificativa estatística.* |
| D2 | `missed` vs. `expired` | Ambos contam no denominador. A distinção é diagnóstica, não aritmética. |
| D3 | `invalid` | Excluído de numerador *e* denominador. |
| D4 | Persistência do perfil | **Revisada em 30/09/2026:** acumula entre runs **e entre sessões**; o histórico de eventos é persistido localmente e o perfil é reconstruído dele ao abrir o jogo. Só é zerado por ação explícita (marcador `obs.reset`), sem apagar o histórico. *(Antes: "continua entre runs, reseta entre sessões".)* O perfil é do jogador, não da tentativa. |
| D5 | Retenção / 2ª sessão | Não decidido. Esquema instrumentado para suportar, sem compromisso de execução. |
| D6 | Suavização | Contagens decaídas, não EWMA sobre a razão. |
| D9 | Taxonomia da dim 2 | Remove `aéreo`. Conjunto passa a `{leve, pesado, carregado, arremesso, utilitário}`, `n = 5`. Consequência da decisão "combate 100% planar". |
| — | Quem adapta | Só o boss. Inimigos comuns são instrumento de coleta com IA fixa. |
| — | Janela da dim 6 | A exposição é o **comprometimento total** da ação (startup + active + recovery), não só o recovery, por escolha explícita do autor: mede o risco real de se comprometer. |

### 6.1 Decisões de arquitetura

| Questão | Escolha |
|---|---|
| Câmera | Isométrica real (losango 2:1), câmera "de ladinho" estilo Hades/Diablo |
| Eixo Z | **Não existe.** Combate inteiro no plano do chão; a profundidade isométrica é ordem de desenho, não física |
| Separação lógica/visual | `combat/`, `opportunity/`, `ai/` e `profile/` nunca importam de `visual/`. Só `ArenaScene` enxerga os dois lados |
| Ações do jogador | Data-driven: adicionar ação é acrescentar dado numa tabela, não escrever código |
| Determinismo | PRNG único semeado; sem `Math.random()` na lógica; timestep fixo |
| Estética | Última prioridade. Personagens por pré-render 3D (§14); arena em tiles 2D isométricos |
| Dependências | Mínimas. Única dependência de runtime: Phaser. Toda a matemática do instrumento é código próprio e testado |

> **EFEITO DOMINÓ DO EIXO Z**
>
> "Sem eixo Z" é a decisão mais fundamental do projeto, e ela bloqueia duas coisas de uma vez: a ação `aéreo` da dim 2 (resolvida por D9, que a remove) e a **dim 7 inteira**. Reintroduzir o eixo Z não é um ajuste, é uma decisão de arquitetura que invalidaria parte do `OpportunitySystem`, das hitboxes e da projeção isométrica.

---

# PARTE II: TECNOLOGIA

## 7. Tecnologias avaliadas

O que foi considerado e por que foi ou não adotado. É material direto para a seção de decisões técnicas do TCC.

### 7.1 Motor / framework de jogo

| Opção | Veredito | Razão |
|---|---|---|
| **Phaser 3** | ✅ Adotado | Framework 2D maduro para web, roda no navegador (sem instalação para participantes do estudo), API de cena/sprite/animação/câmera/input pronta, TypeScript de primeira classe |
| Three.js / Babylon.js | ⏸ Registrado como migração futura possível | 3D real no navegador; como a separação lógica/visual é real, `combat/`, `opportunity/`, `ai/` e `profile/` sobreviveriam intactos a uma troca de renderizador |
| Engines desktop (Unity, Godot) | Não adotado | Não foram objeto de spec. A escolha web favorece a coleta remota com participantes e a integração com TypeScript/Vitest *(justificar no texto se a banca perguntar)* |

### 7.2 Máquina de estados do jogador

| Opção | Veredito | Razão |
|---|---|---|
| XState | ❌ Rejeitado | Statecharts hierárquicos e visualizador são poderosos, mas é uma dependência grande e declarativa que destoa do estilo imperativo de `combat/` |
| fiume / robot | ❌ Rejeitado | FSMs minimalistas e sem dependências, mas ainda assim uma lib para um problema pequeno |
| Máquina à mão | ✅ Adotado | União de literais (`'idle' \| 'acting' \| …`) + `switch`/`if` por estado; é o padrão usado em todo o código |

### 7.3 Cálculo de entropia

| Opção | Veredito | Razão |
|---|---|---|
| `shannon-entropy` (npm) | ❌ Rejeitado | Descontinuado, sem release há mais de 12 meses |
| `binary-shannon-entropy` | ❌ Rejeitado | Opera sobre buffers binários, log base 2 não normalizado. Não faz o que a Família B pede (normalização por `ln(n)` com `n` fixo) |
| Implementação própria | ✅ Adotado | A fórmula tem ~8 linhas. É mais fácil de testar e de defender perante a banca do que justificar uma dependência |

### 7.4 Combate e hitbox em Phaser

Não existe lib madura de "sistema de combate data-driven" para Phaser 3. `phaser3-hadoken` resolve *sequências de input* (comandos estilo jogo de luta), não ciclo de vida de ação e hitbox. A física Arcade/Matter do Phaser **não é usada**: colisão é código próprio (AABB para hurtbox, setor circular para ataque), puro e testável em Node sem navegador. **Nada a adotar.**

### 7.5 Assets visuais

| Recurso | Licença | Veredito |
|---|---|---|
| **KayKit Adventurers** (Kay Lousberg) v2.0 free | CC0 | ✅ **Adotado** para personagens: Knight = jogador, Barbarian = Assaltante. Escolhido por trazer adereços de arma (espada+escudo, arco) alinhados à trilha de repertório |
| **KayKit Character Animations** v1.1 free | CC0 | ✅ Baixado (161 clipes, mesmo rig `Rig_Medium`), reservado para animações de ataque. O idle/walk usou os clipes que vêm no próprio pack Adventurers |
| Tileset isométrico (grama/água) | pack de terceiros validado em 24/08 | ✅ Adotado para o chão |
| Kenney: Prototype Kit / Blocky Characters | CC0 | ❌ Não adotado: Blocky já vem animado, mas não traz armas |
| Kenney: Roguelike Characters / RPG pack | CC0 | ❌ Superado: eram sprites top-down planos, sugeridos antes da migração isométrica |
| Quaternius Universal Animation Library | CC0 | ❌ Não precisou: os clipes KayKit compartilham o rig, então não houve retargeting |
| Mixamo | gratuito (conta Adobe) | ❌ Descartado para automação por exigir login |
| Essential Isometric 3D Block Pack, treeSet, critters | vários | Movidos para `public/assets/_unused/`: formato 3D (.fbx/.obj/.dae) ou incompatíveis na época |

### 7.6 Ferramentas de renderização de sprites

| Opção | Veredito | Razão |
|---|---|---|
| `dbarton-uk/blender-sprite-render` | ❌ Planejado, depois substituído | Assume um modelo animado autocontido por arquivo; o pipeline precisava aplicar uma *action* de um FBX separado num FBX de personagem |
| BlenderSpriteGenerator (addon) | ❌ Não usado | Idem, mais dependente de GUI |
| **Script próprio `render_character.py`** | ✅ Adotado | ~260 linhas de Python/`bpy`, headless, reprodutível por linha de comando |

### 7.7 Animação e efeitos (avaliados, ainda não usados)

| Opção | Veredito | Razão |
|---|---|---|
| Spine (pago) vs. DragonBones (grátis, editor abandonado) | ⏸ Adiado | O autor não tem experiência com Spine; só reconsiderar se alguma ferramenta gerar animação esquelética automaticamente. O pré-render 3D já entrega fluidez suficiente |
| GSAP | ❌ Rejeitado | O Tween Manager do Phaser já espelha o desenho de parâmetros do GSAP |
| Phaser `postFX` (glow/shine/bloom) | ✅ Escolhido para feedback de carga/impacto | Nativo, sem nova dependência. Ainda não implementado |
| Phaser 3 Particle Editor (`koreezgames`) | ✅ Escolhido para partículas de ataque | Editor visual + plugin de runtime. Ainda não implementado |
| Spritesheets CC0 de slash/impacto (OpenGameArt) | Fallback | — |

> **Critério revisto em 06/09/2026:** "bom visual e fluidez" passou a contar por si só como justificativa para uma dependência (antes o critério era só "evitar dependência grande para problema pequeno").

### 7.8 Técnicas de IA para o boss (avaliadas, ainda não implementadas)

| Técnica | Veredito | Razão |
|---|---|---|
| **Dynamic Scripting** (Spronck et al.) | ✅ Planejado | Pesos de regra ajustáveis, com clipping; `λ = 0` reproduz os pesos-base e deixa o grupo controle "de graça" |
| **N-gram de ações** | ✅ Planejado para o preditor | Determinístico (compatível com replay), explicável, barato em amostras |
| **Behavior Tree** para o boss | ✅ Planejado | Parâmetros `p_*` modulados pelo perfil (spec v1 §5.3) |
| LSTM / aprendizado profundo | ❌ Rejeitado | Dados insuficientes, não-determinismo que quebra o replay, perda de explicabilidade |

---

## 8. Referências científicas

Fundamentação por função no argumento. **Confira cada entrada na fonte primária antes de citar no texto final.**

### 8.1 Predição de comportamento do jogador

**Laird, J. E. (2001).** *It Knows What You're Going to Do: Adding Anticipation to a Quakebot.* Proceedings of the Fifth International Conference on Autonomous Agents, ACM.

> **Função:** referência canônica de antecipação de jogador em jogo de ação. O bot usa predição interna baseada nas próprias táticas para antecipar o oponente, praticamente o caso de uso do boss.

**Millington, I.** Capítulo sobre N-grams para predição de jogador (em *Artificial Intelligence for Games* / coletâneas *Game AI Pro*; **conferir a fonte exata**). Complementado por **Chiu et al. (2014)**, *Online Opponent Modeling for Action Prediction*, Journal of Internet Technology.

> **Função:** técnica concreta. N-gram sobre sequência discretizada de ações e direções é determinístico, explicável, barato em amostras e implementável em poucas centenas de linhas.

### 8.2 Adaptação de IA de jogo

**Spronck, P., Ponsen, M., Sprinkhuizen-Kuyper, I., & Postma, E. (2006).** *Adaptive Game AI with Dynamic Scripting.* Machine Learning, 63(3), 217–248.

> **Função:** espinha dorsal do mecanismo adaptativo (pesos de regra do passo 7, *weight clipping*). Fornece o enquadramento de requisitos computacionais (velocidade, eficácia, robustez, eficiência) e funcionais (clareza, variedade, consistência, escalabilidade).

**Hunicke, R., & Chapman, V. (2004).** *AI for Dynamic Difficulty Adjustment in Games.* Challenges in Game AI Workshop, AAAI. Ver também **Hunicke (2005)**, *The case for dynamic difficulty adjustment in games*, ACE '05.

> **Função:** delimitar por contraste. Este trabalho não faz ajuste de dificuldade.

**Yannakakis, G. N., & Togelius, J.** *Artificial Intelligence and Games.* Springer (1ª ed. 2018), capítulo *Player Modeling*.

> **Função:** taxonomia de *player modeling* na qual o perfil de 7 dimensões deve ser posicionado.

### 8.3 Fundamentação pedagógica

**Ericsson, K. A., Krampe, R. Th., & Tesch-Römer, C. (1993).** *The role of deliberate practice in the acquisition of expert performance.* Psychological Review, 100(3), 363–406.

> **Função:** sustenta a *pergunta* da tese. Prática deliberada é prática dirigida à fraqueza, com feedback imediato.

**Gick, M. L., & Holyoak, K. J. (1983).** *Schema induction and analogical transfer.* Cognitive Psychology, 15(1), 1–38.

> **Função:** define a variável dependente. O desenho deve medir **transferência próxima** (nova sala, novo arquétipo, mesma habilidade), sem prometer transferência distante.

### 8.4 Validação do instrumento

**Shrout, P. E., & Fleiss, J. L. (1979).** *Intraclass correlations: Uses in assessing rater reliability.* Psychological Bulletin, 86(2), 420–428.

> **Função:** origem formal do `ICC(1,1)`.

**Koo, T. K., & Li, M. Y. (2016).** *A Guideline of Selecting and Reporting Intraclass Correlation Coefficients for Reliability Research.* Journal of Chiropractic Medicine, 15(2), 155–163.

> **Função:** guia de escolha e reporte; faixas de interpretação que embasam o corte em 0,50 (D1). ⚠️ Há erratum publicado: na Tabela 3, `(k+1)` do denominador de ICC(1,1) deve ser `(k−1)`.

**Shannon, C. E. (1948).** *A Mathematical Theory of Communication.* Bell System Technical Journal, 27, 379–423 e 623–656.

> **Função:** origem da entropia da Família B. A normalização por `ln(n)` é escolha deste trabalho (equivale à "eficiência"/entropia relativa) e deve ser justificada como tal.

### 8.5 Referências técnicas sugeridas (a verificar antes de citar)

Úteis para a seção de implementação. Nenhuma foi citada ainda nos specs.

| Tema | Referência sugerida | Onde aparece no projeto |
|---|---|---|
| Timestep fixo com acumulador | Fiedler, G. (2004). *Fix Your Timestep!* (Gaffer on Games, artigo web) | `core/fixedTimestepLoop.ts` |
| Padrões de jogo (Event Queue/Observer, Game Loop, State, Data-Driven) | Nystrom, R. (2014). *Game Programming Patterns*. Genever Benning | event bus, FSMs, registro de ações |
| TDD | Beck, K. (2002). *Test-Driven Development: By Example*. Addison-Wesley | metodologia (§15) |
| Projeção isométrica/dimétrica 2:1 | literatura de computação gráfica sobre projeções axonométricas | `visual/isometricProjection.ts` |
| Regra de sucessão / prior Beta | textos de estatística bayesiana (ex.: Gelman et al., *Bayesian Data Analysis*) | domínio da Família A |
| Mulberry32 (PRNG) | algoritmo de domínio público de Tommy Ettinger; citar como tal | `core/prng.ts` |

---

## 9. Pendências abertas

| Pendência | Natureza | Bloqueia |
|---|---|---|
| **Telemetria mínima / persistência de dados** *(nova)* | Técnica | **Estudo 1.** Não há salas, sessões nem exportação; ver §4 |
| **Regra de 8 ações mínimas por segmento de H** *(nova)* | Técnica/metodológica | Implementar ou justificar a omissão no texto (§2.2) |
| Trabalho de sprite não commitado (correção de direção, 13/09) | Organizacional | Nada; precisa de revisão e commit |
| `public/assets/README.md` desatualizado | Documentação | Nada; ainda descreve top-down e "sem animação" |
| Documento de arquitetura v1.1 fora do repositório | Organizacional | Specs citam `v1 §3.5`, `§5.2`, `§11` etc., mas o arquivo vive fora do repo |
| Humanos vs. agentes sintéticos como participantes | Metodológica | Cálculo amostral e comitê de ética |
| Retenção em segunda sessão | Metodológica | Adiada. O esquema já prevê `session_idx` |
| Eixo Z real no combate | Arquitetural | Dim 7 inteira |
| Verificação bibliográfica de 11 entradas | Revisão de literatura | Escrita |
| Orçamento de oportunidades para 7 dimensões | Metodológica | Desenho das salas do Estudo 1 |
| Valores `base`/`min`/`max` dos parâmetros `p_*` da BT do boss | Design | Passo 7 |
| Guarda de `actionType` no denominador da dim 6 | Técnica | Só se surgir ação não-ofensiva (ex.: `utility` de cura) |
| Viés de discretização da predição de ameaça (~1 passo, conservador) | Documentado | Nada; declarar como limitação |
| Telemetria rica (heatmap, direção de dash) | Escopo | Recomendação: fechar o loop mínimo antes de expandir |
| Redesign de HUD (modo gameplay vs. modo dev) | Design/UX | Nada. A HUD atual é texto cru; quando for redesenhada, precisa separar o mínimo para o jogador e o painel completo de dev (inputs, perfil, decisões do boss) |
| Pequenos itens de limpeza (nome `groundTilemap`, `ISO_CONFIG` no arquivo errado, código morto `directionalHitbox`/`aabbOverlap` p/ ataque, profundidade do texto da HUD, borda d'água andável) | Qualidade | Nada |

### 9.1 O maior bloqueio agora

A trilha de repertório fechou as três dimensões da Família B, o que resolveu o antigo gargalo (falta de conteúdo de jogo). Agora há **dois** gargalos, em ordem:

1. **Telemetria mínima para o Estudo 1** (salas + sessão + exportação), que é pré-requisito para validar o instrumento.
2. **A ponte déficit-alvo → peso de regra → comportamento do boss** (passos 6–7), que é pré-requisito para o Estudo 2.

---

## 10. Stack tecnológica completa

### 10.1 Runtime e linguagem

| Tecnologia | Versão | Papel | Onde |
|---|---|---|---|
| **TypeScript** | 5.9.3 (`^5.5.0`) | Linguagem de todo o jogo e dos testes. `strict: true`, alvo ES2020, módulos ESNext, `moduleResolution: Bundler` | `tsconfig.json` |
| **Phaser** | 3.90.0 (`^3.80.1`) | Framework de jogo 2D: cenas, carregamento de imagens/spritesheets, animações por frame, câmera com follow e bounds, input de teclado/mouse, `Graphics` para debug, escala `FIT` com centralização | `src/main.ts`, `src/scenes/`, `src/visual/` |
| **Renderer** | WebGL com fallback Canvas (`Phaser.AUTO`) | Resolução lógica 1280×720, escalada para a janela | `src/main.ts` |
| **Navegador** | qualquer moderno | Plataforma de execução; `index.html` com `#game-root` | `index.html` |
| **Node.js** | 24.18 | Ambiente de build e de testes (não roda em produção) | — |

**Única dependência de runtime: Phaser.** Três dependências de desenvolvimento: TypeScript, Vite e Vitest.

### 10.2 Build, execução e testes

| Tecnologia | Versão | Papel | Comando |
|---|---|---|---|
| **Vite** | 5.4.21 | Servidor de desenvolvimento com HMR (porta 5173) e bundler de produção (Rollup por baixo); serve `public/` como estático | `npm run dev`, `npm run build` |
| **Vitest** | 2.1.9 | Framework de testes unitários e de integração, ambiente `node` (a lógica não depende de DOM/Phaser) | `npm test` |
| **tsc** | — | Verificação de tipos sem emitir código | `npm run typecheck` |
| **npm** | — | Gerenciador de pacotes (`package-lock.json` versionado) | — |

### 10.3 Pipeline de conteúdo 3D

| Tecnologia | Versão | Papel |
|---|---|---|
| **Blender** | 5.2.1 | Renderização headless (`--background --python`) dos personagens 3D em sprite sheets |
| **Python + `bpy`/`mathutils`** | embutido no Blender | Scripts `render_character.py` (render + composição) e `inspect_fbx.py` (inspeção de actions/objetos de um FBX) |
| **EEVEE** | motor do Blender | Render rasterizado com fundo transparente (RGBA PNG) |
| **FBX** | formato | Modelos e animações KayKit |
| **PNG** | formato | Tiles e sprite sheets finais |

### 10.4 Controle de versão e documentação

| Tecnologia | Papel |
|---|---|
| **Git** | Versionamento; branch única `master`; 127 commits (13/08 a 12/09/2026) |
| **Conventional Commits** | Prefixos `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:` (e `!` para mudança incompatível) |
| **Markdown** | Specs, planos, documentos de pesquisa e READMEs |
| `.gitignore` | Exclui `node_modules/`, `dist/`, fontes brutas e renders intermediários do Blender (só as sheets finais são versionadas) |

### 10.5 Ambiente e ferramentas de desenvolvimento

| Ferramenta | Papel |
|---|---|
| Windows 11 + Git Bash / PowerShell | Sistema operacional e shells |
| **Claude Code** (CLI da Anthropic) | Assistente de programação com IA usado em todo o desenvolvimento (ver §15.4) |
| Plugin **superpowers** do Claude Code | Fluxo estruturado: *brainstorming* → spec → plano → execução por subagentes → revisão de código |
| **Blender MCP** (Model Context Protocol) | Ponte entre o assistente e uma instância viva do Blender, usada na investigação do pipeline (ex.: verificação de orientação do personagem) |
| Navegador (Chrome) | Playtest manual e verificação visual |

---

## 11. Arquitetura de software

### 11.1 Visão em camadas

```
                 ┌──────────────────────────────────────────────┐
  Phaser  ──────▶│ scenes/ArenaScene  (input, câmera, render)   │  ← única camada que vê os dois lados
                 └───────┬──────────────────────────┬───────────┘
                         │ lógica                   │ visual
        ┌────────────────▼─────────┐     ┌──────────▼──────────────┐
        │ combat/Encounter         │     │ visual/                 │
        │  ├ PlayerController      │     │  isometricProjection    │
        │  ├ AssaltanteController ─┼─▶ai/rules  directionalSprite │
        │  ├ sector / movement     │     │  spriteDirection        │
        │  ├ threatPrediction      │     │  groundTilemap          │
        │  └ patience              │     │  assetRegistry          │
        ├──────────────────────────┤     └─────────────────────────┘
        │ opportunity/             │     ┌─────────────────────────┐
        │  OpportunitySystem       │────▶│ debug/ overlay, HUD     │ (escutam o bus)
        ├──────────────────────────┤     └─────────────────────────┘
        │ profile/                 │
        │  ProfileAccumulator      │
        │  EntropyAccumulator      │
        │  DecayedRatio/Count      │
        ├──────────────────────────┤
        │ core/ EventBus, loop, PRNG│
        └──────────────────────────┘
```

**Regra de dependência:** nada em `core/`, `combat/`, `opportunity/`, `ai/` ou `profile/` importa Phaser ou `visual/`. Por isso toda a lógica roda e é testada em Node puro, sem navegador.

### 11.2 Inventário de módulos

| Arquivo | Responsabilidade |
|---|---|
| `core/prng.ts` | PRNG Mulberry32 semeado (`next()`, `nextInt()`) |
| `core/fixedTimestepLoop.ts` | Acumulador de tempo real → passos fixos de 1000/60 ms |
| `core/eventBus.ts` | Barramento publish/subscribe genérico e tipado; `on()` devolve função de cancelamento; `emit` itera sobre cópia (seguro contra reentrância) |
| `core/events.ts` | Mapa de eventos do jogo: `opp.open`, `opp.close`, `player.action`, `player.dodge`, `player.hit_unmitigated` |
| `opportunity/types.ts` | `OppType`, `OppOutcome`, `InvalidReason`, payloads |
| `opportunity/opportunitySystem.ts` | Abre, resolve e expira janelas; gancho `onExpire` decide `expired` ou `invalid` |
| `combat/actionRegistry.ts` | Registro data-driven de ações por arma, com validação (IDs duplicados, arma desconhecida); `totalCommitmentMs` |
| `combat/actionDefs.ts` | Constantes de esquiva, troca de arma, postura, stagger, parry |
| `combat/movementDefs.ts` | Velocidades, dash, limites da arena, alcance e abertura do leque |
| `combat/movement.ts` | Normalização, integração de movimento, *clamp* na arena |
| `combat/collision.ts` | Sobreposição AABB |
| `combat/sector.ts` | `AttackSector` (cone): teste ponto-no-setor e setor-vs-caixa |
| `combat/playerController.ts` | FSM do jogador: `idle`, `acting`, `dodging`, `blocking`, `staggered`; carga, troca de arma, postura |
| `combat/assaltanteController.ts` | FSM do Assaltante: `idle`, `chasing`, `attacking`, `recovering`; abre oportunidades; implementa `ThreatAssessor` |
| `combat/threatPrediction.ts` | Simulador puro, fase a fase, de quando o inimigo atingiria um alvo |
| `combat/patience.ts` | Interface `ThreatAssessor` e combinador `isPatientAttack` |
| `combat/encounter.ts` | Orquestrador: instancia tudo, liga eventos ao perfil, resolve colisões e defesas, ordena o passo |
| `ai/rules/assaltanteRules.ts` | Regras com pré-condição e `opportunity_tags` (a futura base de pesos) |
| `profile/decayedRatio.ts`, `decayedCount.ts` | Primitivas de contagem decaída com buffer pendente |
| `profile/entropyAccumulator.ts` | Entropia normalizada sobre conjunto fixo de rótulos, dois relógios |
| `profile/profileAccumulator.ts` | Fachada do perfil: Família A + Família B, fronteiras, omissão, snapshot |
| `visual/isometricProjection.ts` | `toScreen`, `fromScreen`, `screenDepth` |
| `visual/spriteDirection.ts` | Vetor → balde de 8 direções |
| `visual/directionalSprite.ts` | Sprite animado (idle/walk × 8 linhas) sincronizado com posição e direção |
| `visual/groundTilemap.ts` | Grade de tiles isométricos (grama no interior, água na borda) |
| `visual/placeholderTextures.ts`, `assetRegistry.ts` | Configuração isométrica, chaves de assets, textura gerada por código |
| `debug/opportunityOverlay.ts`, `hudState.ts` | Texto de oportunidades abertas; contadores de dash, acertos e golpes sofridos |
| `scenes/ArenaScene.ts` | Carregamento, criação, mapeamento de input, laço `update`, desenho de debug |

### 11.3 Padrões de projeto utilizados

| Padrão | Onde | Por quê |
|---|---|---|
| **Observer / Publish-Subscribe** (event bus tipado) | `core/eventBus.ts` | Desacopla quem gera sinal (combate) de quem mede (perfil, HUD, overlay). O tipo do payload é verificado em compilação por evento |
| **Máquina de estados finitos** | `PlayerController`, `AssaltanteController` | Estados de combate com fases temporizadas (startup/active/recovery; telegraph/swing/recovery) |
| **Data-driven design / Registry** | `actionRegistry.ts` | Nova ação = nova linha de dados. Validação em tempo de carga |
| **Game Loop com timestep fixo** | `fixedTimestepLoop.ts` | Simulação determinística e independente do FPS |
| **Strategy / interface por arquétipo** | `ThreatAssessor` | Cada futuro inimigo implementa sua própria previsão de ameaça; o combinador não muda |
| **Facade** | `ProfileAccumulator`, `Encounter` | Uma API única esconde duas famílias matemáticas / vários controladores |
| **Mediator / orquestrador** | `Encounter` | Resolve interações jogador↔inimigo e impõe a ordem do passo |
| **Blackboard + regras com pré-condição** | `ai/rules` | Base do Dynamic Scripting planejado (`opportunity_tags` serão os `tag_alvo,i`) |
| **Separação modelo/visão** | lógica vs. `visual/` | Permite trocar o renderizador sem tocar no instrumento |
| **Funções puras** | projeção, setor, predição, entropia | Testáveis isoladamente, sem mocks |

### 11.4 Ordem do passo de simulação (invariante crítica)

`Encounter.step(16,67 ms)`:

1. Assaltante avança (decide regra, persegue ou progride fase, abre oportunidades).
2. Jogador avança (fases de ação, dash, postura, stagger).
3. Colisão do golpe inimigo → esquiva (i-frames) / parry / bloqueio / golpe não mitigado, **no máximo uma resolução defensiva por ataque**.
4. Colisão do golpe do jogador → punição `taken`.
5. **Por último**, `OpportunitySystem.step()` expira janelas. Se rodasse antes, uma janela resolvida neste mesmo passo seria fechada como `expired` um passo antes (condição de corrida encontrada e corrigida em 13/08).
6. Registro da distância operacional (dim 5).

---

## 12. Algoritmos e modelos matemáticos implementados

### 12.1 PRNG Mulberry32

Gerador de 32 bits com estado único; incremento por constante de Weyl `0x6D2B79F5` seguido de misturas com `Math.imul` e *xorshifts*; saída em [0, 1). Mesma semente, mesma sequência (testado).

### 12.2 Timestep fixo

```
acumulador += Δt_real
enquanto acumulador ≥ passo:  simular(passo); acumulador −= passo      passo = 1000/60 ms
```

### 12.3 Projeção isométrica (dimétrica 2:1)

Tile lógico de 64 unidades de mundo; losango de tela com meia-largura 32 px e meia-altura 16 px.

```
col = x / 64,  row = y / 64
tela.x = (col − row) · 32
tela.y = (col + row) · 16
profundidade = x + y                       (ordem de desenho, não física)
```

Inversa (`fromScreen`, usada para converter o mouse em direção de mira no mundo):

```
col = (Δx/32 + Δy/16) / 2
row = (Δy/16 − Δx/32) / 2
```

Como a projeção é linear (sem termo aditivo), vetores de direção projetam direto. **Input WASD rotacionado 45°** (`dx = ix + iy`, `dy = iy − ix`) para que "cima" na tela seja cima no losango. A elevação da câmera do Blender (26,57° = arctan(0,5)) casa com a razão 2:1 dos tiles.

### 12.4 Leque de ataque (setor circular)

```
AttackSector = { origem, direção (unitária), alcance, meio_ângulo = π/4 }  → cone de 90°
ponto p dentro ⇔ |p − o| ≤ alcance  e  cos∠(p − o, direção) ≥ cos(meio_ângulo)
setor × caixa   ⇔ algum dos 4 cantos ou o centro da caixa está dentro
```

O alcance efetivo soma meia largura do atacante. Substituiu o AABB de 4 quadrantes, que errava alvos em diagonal (§16.3).

### 12.5 Balde de 8 direções (sprites)

```
bucket = round(atan2(y, x) / (π/4)) mod 8        0 = leste, sentido horário na tela
linha_da_sheet = (bucket + 4) mod 8               calibrado empiricamente (§14.3)
```

### 12.6 Predição de ameaça e janela segura (dim 6)

`predictThreatMs(config, snapshot, alvo, horizonte)` simula a FSM do inimigo **fase a fase** (não frame a frame, máx. 8 iterações):

- `idle/chasing`: se já está no alcance → `attacking`; senão calcula o tempo para fechar a distância `(d − alcance) / velocidade` e, se passar do horizonte, devolve `null` (seguro).
- `attacking`: se o golpe ficaria ativo dentro do horizonte **e** o leque cobre o alvo → devolve os ms até o impacto; senão avança para `recovering`.
- `recovering`: avança para `idle` ou devolve `null`.

```
isPatientAttack(comprometimento, ameaças, alvo) = ∀ a ∈ ameaças: a.msUntilThreatens(alvo, comprometimento) = null
comprometimento = startup + active + recovery        (ação carregada: active + recovery, pois o evento só sai ao soltar)
```

Contrato: `null` significa **seguro**, nunca "desconhecido". O modelo contínuo tem **viés de até ~1 passo (≈16 ms)** em relação ao jogo discreto, sempre na direção conservadora; isso está documentado e coberto por um teste de equivalência simulação-vs-realidade.

### 12.7 Entropia normalizada, contagem decaída, prior Beta, confiança

Ver §2. Fórmulas implementadas literalmente em `entropyAccumulator.ts` e `profileAccumulator.ts`.

### 12.8 Carga, postura e parry

```
alcance_carregado = interpolação linear entre reach (minHold) e reachMax (maxHold)
postura: 100 máx; −40 por bloqueio (3 bloqueios seguidos quebram) → stagger 350 ms
         regenera 50/s após 1 s parado em idle
parry ⇔ guarda levantada há < 150 ms quando o golpe conecta
        → o inimigo pula o resto do golpe e abre punição de 750 ms (vs. 500 ms normal)
```

### 12.9 Fórmulas planejadas (spec v2, ainda não implementadas)

```
score(s) = confiança(s) × déficit(s)                  entre dimensões com confiança ≥ 0,6
alvo inicial = argmax score(s)
troca de alvo só se: domínio(alvo) ≥ 0,75  ou  score(cand) > 1,15·score(alvo)  ou  confiança(alvo) < 0,6
w_i = base_i · exp(λ · déficit(alvo) · confiança(alvo) · tag_alvo,i)      clip em [0,25·base, 4·base]
λ ∈ [0, 1,1] (amplificação máx. e^1,1 ≈ 3×), ajuste ×0,8 / ×1,2 para manter taxa de falha em [0,25; 0,45]
λ = 0  ⇒  pesos-base  ⇒  grupo controle
```

---

## 13. Mecânicas de jogo e parâmetros

### 13.1 Controles

| Entrada | Ação |
|---|---|
| WASD | mover (rotacionado 45° para o losango) |
| Mouse | mira 360° |
| Clique esquerdo | ataque leve (ou disparo, no arco) |
| Clique direito | ataque pesado |
| Q (segurar/soltar) | ataque carregado |
| 1 / 2 / 3 | espada+escudo / arco / arma pesada |
| Espaço | esquiva com i-frames |
| E (segurar) | guarda: apertar em cima do golpe = parry; segurar antes = bloqueio |

### 13.2 Tabela de ações (ms; alcance em unidades de mundo)

| Ação | Tipo | Startup | Active | Recovery | Alcance |
|---|---|---|---|---|---|
| `sword_shield.light` | light | 100 | 100 | 150 | 45 |
| `sword_shield.heavy` | heavy | 220 | 120 | 300 | 55 |
| `sword_shield.charged` | charged | hold 150–900 | 140 | 350 | 50 → 70 |
| `heavy_weapon.light` | light | 160 | 120 | 220 | 55 |
| `heavy_weapon.heavy` | heavy | 320 | 150 | 420 | 70 |
| `heavy_weapon.charged` | charged | hold 200–1100 | 180 | 500 | 65 → 90 |
| `bow.shot` | throw | 80 | 60 | 200 | 220 |

O tipo `utility` existe no conjunto da dim 2 (n = 5), mas **nenhuma ação o usa ainda**. Isso limita o domínio máximo alcançável da dim 2 e deve ser discutido (ou uma ação utilitária adicionada) antes do Estudo 1.

### 13.3 Outros parâmetros

| Parâmetro | Valor |
|---|---|
| Esquiva | 250 ms de duração, 200 ms de i-frames, 300 ms de cooldown, 80 de deslocamento |
| Velocidade do jogador / Assaltante | 160 / 90 unidades por segundo |
| Arena | 1600 × 1200 unidades (25 × 19 tiles) |
| Hurtbox das entidades | 20 × 20 |
| Assaltante | alcance de decisão 60; telegraph 400 ms (= janela de esquiva); swing 150 ms; recuperação 500 ms (= janela de punição) |
| Troca de arma | 250 ms de bloqueio de ataque |

### 13.4 O inimigo: Assaltante

IA baseada em regras com prioridade fixa (primeira pré-condição verdadeira vence): `assaltante.attack` se distância ≤ 60, senão `assaltante.chase`. O ataque tem telegrafia de 400 ms (a janela `dodge` é aberta aqui), golpe de 150 ms e recuperação de 500 ms (janela `punish`). Se o jogador nunca esteve ao alcance durante a recuperação, a punição fecha como `invalid/out_of_range` em vez de `expired`, para não penalizar uma oportunidade que não existiu.

---

## 14. Pipeline de assets 3D → sprites

### 14.1 Por que pré-renderizar

O Phaser é 2D e não carrega FBX. A decisão (06/09) foi usar modelos 3D CC0 e **pré-renderizá-los** em sprite sheets multidirecionais, técnica clássica de jogos isométricos. Isso dá personagens com volume e animação fluida sem trocar de engine e sem tocar em nenhuma camada de lógica. O chão continua em tiles 2D.

### 14.2 Etapas

1. Baixar KayKit Adventurers e KayKit Character Animations (CC0) para `tools/blender/source/` (ignorado pelo git).
2. `blender --background --python tools/blender/render_character.py -- --character Knight.fbx --idle-fbx … --idle-action "Rig_Medium|Idle_A" --walk-fbx … --walk-action "Rig_Medium|Walking_A" --walk-frames 6 --out-key player`
3. O script: limpa a cena → importa o personagem → importa o FBX de animação → remove objetos que não pertencem ao personagem → atribui a *action* (e o *slot*) à armadura → luz de três pontos (key/fill/top) + ambiente → câmera **ortográfica** a 26,57° de elevação → 8 azimutes (45° cada) × frames (idle: 1 frame, o 17 de 33; walk: 6 frames uniformes de 33) → PNG 128×128 com fundo transparente.
4. Composição em grade: 8 linhas (direções) × N colunas (frames) → `public/assets/characters/<entidade>/{idle,walk}.png`.
5. No jogo: `load.spritesheet` (128×128), animações `idle_<linha>` (1 fps) e `walk_<linha>` (8 fps), escala uniforme pela altura visual (32).

### 14.3 Problemas técnicos encontrados e resolvidos (bom material de "desafios")

| Problema | Causa | Solução |
|---|---|---|
| Animação estática | Blender 4.4+ usa *Actions* em camadas/slots: atribuir `.action` sem `.action_slot` avalia a pose de repouso sem erro | atribuir `action.slots[0]` |
| Nome da action não encontrado | Segundo import renomeia o rig para `Rig_Medium.001` | casar pelo sufixo `\|Idle_A` |
| Arquivos não gravados | caminhos relativos não resolvidos para o cwd | `os.path.abspath()` em toda saída |
| Enum `BLENDER_EEVEE_NEXT` inexistente | renomeado de volta no Blender 5.2 | usar `BLENDER_EEVEE` |
| Silhuetas pretas em alguns ângulos | uma única luz sol | iluminação de 3 pontos + ambiente |
| NLA sobrepondo a action | trilhas NLA deixadas pelo import | remover trilhas NLA |
| **"Manequim fantasma" em T-pose** (12/09) | o FBX de animação traz um mesh de referência com armadura própria que nunca recebe action; renderizava por cima do personagem | apagar todo objeto que não seja a armadura do personagem ou mesh ligado a ela |
| **Direção do sprite invertida** (3 calibrações erradas, 07/09 a 13/09) | dupla inversão de linhas (array de pixels do Blender é de baixo para cima) mal interpretada; conferir só frente/costas não detecta o erro, porque a inversão preserva a simetria de pares antipodais | remover a inversão, `offset = 4`, verificado por projeção do vetor *forward* do personagem e renders de 512 px (*em working tree, não commitado*) |

**Lição metodológica:** uma verificação que só testa pares simétricos (frente/costas) passa mesmo com o sistema quebrado; é preciso testar um eixo assimétrico (esquerda/direita). É um bom exemplo, para o texto, de por que a validação precisa ser desenhada para *falhar* quando há erro.

---

# PARTE III: PROCESSO

## 15. Metodologia de desenvolvimento

### 15.1 Ciclo por sub-projeto

Todo incremento seguiu o mesmo ciclo, documentado no repositório:

1. **Brainstorming / design** com levantamento de alternativas e decisões explícitas.
2. **Spec** (`docs/superpowers/specs/AAAA-MM-DD-<tema>-design.md`): motivação ("por que este recorte"), escopo, fora de escopo, contratos, critérios de pronto, riscos.
3. **Plano de implementação** (`docs/superpowers/plans/…`): tarefas pequenas, cada uma com teste primeiro.
4. **Implementação com TDD**: teste falhando → código mínimo → refatoração; um commit por tarefa.
5. **Revisão de código** por tarefa e **revisão final do branch inteiro**; achados classificados como bloqueantes (corrigidos na hora) ou não bloqueantes (registrados na seção "Pendências conhecidas" do spec).
6. **Playtest manual** no navegador para aspectos visuais e de sensação (vários bugs de input/câmera/sprite só apareceram assim).
7. **Atualização da documentação** de estado (este arquivo).

São 13 specs e 13 planos, um par por sub-projeto.

### 15.2 Princípios aplicados

- **Fatiamento vertical fino:** cada sub-projeto entrega uma dimensão medindo de ponta a ponta (dado → evento → perfil → teste), em vez de construir camadas horizontais incompletas.
- **Riscos primeiro:** o `OpportunitySystem` foi construído e validado antes de tudo por ser a peça de maior risco (denominador vazando = falha silenciosa).
- **Instrumento antes da intervenção:** o perfil precisa ser estável antes que o boss seja construído em cima dele.
- **YAGNI e dependências mínimas:** nenhuma lib para problemas de poucas linhas (FSM, entropia, colisão).
- **Determinismo por construção** (PRNG único, timestep fixo, sem `Math.random()`).
- **Decisões rastreáveis:** cada decisão travada tem ID e documento de origem; mudanças de decisão viram emendas explícitas (ex.: D9).
- **Honestidade metodológica nos documentos:** seções "leitura honesta", "risco aceito" e "limitações" registram o que não funciona ainda.

### 15.3 Estratégia de testes

| Tipo | Exemplos |
|---|---|
| Unitário puro | projeção e inversa (ida e volta), setor, entropia (casos-limite), decaimento, PRNG (reprodutibilidade), balde de direção |
| Máquina de estados | transições e temporizações do jogador (46 testes) e do Assaltante (23 testes) |
| Invariante / conservação | soma dos desfechos = aberturas; reentrância de listeners; precedência |
| Integração | `Encounter` com jogador + inimigo + oportunidades + perfil (28 testes), incluindo alcançabilidade das oportunidades |
| Equivalência simulação-vs-realidade | `predictThreatMs` comparado com o `Encounter.step()` real pelo mesmo intervalo |
| Verificação estática | `tsc --noEmit` com `strict` |
| Manual | playtest no navegador e overlay de debug (hurtbox, leque, alcance, janelas abertas) |

**Resultado atual: 259 testes em 22 arquivos, todos passando (~1,7 s); typecheck limpo.**

### 15.4 Uso de IA generativa no desenvolvimento *(declarar no TCC conforme as normas da instituição)*

O desenvolvimento foi feito com o **Claude Code** (assistente de programação da Anthropic, modelos da família Claude) atuando como par de programação, com o plugin **superpowers**, que impõe o fluxo da §15.1:

- *brainstorming* guiado antes de qualquer código;
- escrita de spec e plano pelo assistente, revisados e aprovados pelo autor;
- execução por **subagentes** (um por tarefa do plano) com revisão de código por outro agente/modelo entre tarefas e ao fim do branch;
- mensagens de commit sempre aprovadas pelo autor antes do commit.

Integrações MCP usadas: **Blender MCP** (inspeção da cena para calibrar a direção dos sprites) e navegador para verificação visual. **O autor tomou todas as decisões de pesquisa e de design** (enquadramento, dimensões, parâmetros, escolhas de mecânica); o assistente propôs alternativas, implementou sob TDD e revisou. É recomendável descrever isso na seção de metodologia e, se a instituição exigir, numa declaração de uso de IA.

---

## 16. Verificação, validação e lições aprendidas

Bugs e achados relevantes, úteis para uma seção de "desafios e soluções" ou "ameaças à validade":

### 16.1 Condição de corrida na ordem do passo (13/08)

A janela de esquiva era fechada como `expired` um passo antes, porque a expiração rodava antes da resolução do acerto. Solução: `OpportunitySystem.step()` sempre por último (§11.4).

### 16.2 Unidade da dim 5 (18/08)

A confiança da distância operacional era calculada em milissegundos, o que fazia o gate de confiança disparar quase instantaneamente. Passou a ser medida em segundos.

### 16.3 Hitbox diagonal → falso `retreat` (07/09 a 12/09)

Com mira livre por mouse, o hitbox retangular de 4 quadrantes errava alvos parados em diagonal. Como a dim 4 infere `retreat` por "ataque expirou sem contato", cada erro geométrico virava um **falso recuo**, inflando a dimensão justamente na geometria mais comum de uma arena isométrica. Um problema de "sensação de jogo" virou, assim, um **problema de validade de dados**, e a correção (leque angular) foi antecipada. Consequência: dados anteriores a essa correção não são comparáveis.

### 16.4 Ação carregada contada cedo demais (06/09)

A dim 2 contava a ação carregada ao começar a carregar, mesmo se cancelada. Passou a contar só na execução.

### 16.5 Parry disparando várias vezes (07/09)

A colisão persiste por vários passos durante o golpe; sem trava, parry, bloqueio e stagger se repetiam a cada passo (a postura sumia em ~3 passos). Solução: uma resolução defensiva por ataque.

### 16.6 Critério de aceitação "argumentado" em vez de testado (12/09)

A revisão final encontrou que o critério "a simulação concorda com a colisão real" tinha sido justificado no plano em vez de testado. O teste foi adicionado e revelou o viés de discretização (~16 ms, conservador), que foi documentado.

### 16.7 Direção dos sprites e manequim fantasma

Ver §14.3.

### 16.8 Ameaças à validade já identificadas

- Dados anteriores ao leque angular não são comparáveis.
- Viés de discretização na dim 6 (conservador).
- `utility` sem nenhuma ação: a dim 2 não consegue chegar a H = 1.
- A regra de 8 ações mínimas por segmento de H não está implementada.
- `retreat` é **inferido** (ausência de contato e de defesa), não observado diretamente.
- As 7 dimensões competem pelo mesmo orçamento de oportunidades.
- Um único arquétipo de inimigo por enquanto: o perfil é medido diante de um só padrão de ataque.

---

## 17. Desenho experimental planejado

### 17.1 Unidades temporais

| Unidade | Definição | Perfil |
|---|---|---|
| encontro | um combate numa sala | alimenta o relógio *estado* |
| run | tentativa completa (`run_id` + `seed`) | não reseta o perfil |
| sessão | uma visita do participante: calibração → treino → transferência | unidade de reset |
| participante | pessoa ou agente sintético | — |

> **PENDENTE (30/09/2026): redesenho dos Estudos 1 e 2.** Com a D4 revisada (perfil não reseta por sessão) e o reenquadramento da §1, o desenho abaixo não se sustenta como está: o `ICC(1,1)` sobre sessões independentes pressupõe reset por sessão, e a transferência deixou de ser a variável central. Eixos candidatos: **acurácia de previsão ao longo do tempo de jogo** (5b) e **ablação do boss** (6). O texto abaixo fica como registro do desenho anterior até o redesenho.

### 17.2 Estudo 1: validação do instrumento

- **Objetivo:** verificar a confiabilidade de cada dimensão e selecionar as que ficam.
- **Medida:** `ICC(1,1)` por dimensão sobre os `profile.snapshot` de saída de sala (relógio traço).
- **Critério (D1):** dimensões com `ICC(1,1) < 0,50` são removidas antes do Estudo 2.
- **Não precisa da adaptação** funcionando.
- **Pré-requisito ainda não atendido:** telemetria mínima (§4, §9).

### 17.3 Estudo 2: efeito da adaptação

- **Grupos:** `condition: 'adaptive' | 'control'`. O controle recebe o mesmo jogo com `λ = 0` (pesos-base), e a progressão deve ser idêntica entre os grupos.
- **Intervenção:** o boss consome o perfil congelado na entrada e adapta seus pesos ao déficit-alvo.
- **Variável dependente:** **transferência próxima**, ou seja, desempenho na habilidade-alvo numa sala de transferência (`transfer.entry`) com arquétipo novo.
- **Opcional (D5):** retenção numa segunda sessão (`session_idx = 2`).

### 17.4 Esquema de eventos v2 (planejado; parcialmente implementado)

Envelope `{v: 2, t_ms, session_id, run_id, room_id, seq}` e eventos `session.start`, `run.start`, `room.enter`, `enemy.spawn`, `opp.open` (+`n_options`), `opp.close` (+`reason`, +`attempt`), `profile.snapshot`, `player.action`, `player.hurt`, `boss.attempt`, `transfer`.

**Implementado hoje:** `opp.open`, `opp.close` (com `reason` e `attempt`), `player.action` (com `actionId`, `actionType`, `weaponId`), `player.dodge`, `player.hit_unmitigated`, além do formato de `profile.snapshot` como retorno de função. **Não implementado:** envelope, sessão/run/sala, persistência.

### 17.5 Parâmetros consolidados

| Parâmetro | Valor | Status |
|---|---|---|
| α, β | 1, 1 | ✅ código |
| κ (Família A) | 10 | ✅ código |
| κ_H (Família B) | 25 | ✅ código |
| γ traço / estado | 0,87 / 0,55 | ✅ código |
| gate de confiança | 0,60 | planejado |
| mínimo de ações por segmento de H | 8 | ❌ não implementado |
| limiares de omissão | 0,35 / 0,65 | planejado |
| histerese: margem / teto | 15% / domínio 0,75 | planejado |
| clipping de pesos | [0,25; 4,0]·base | planejado |
| λ_max, ajuste | 1,1; ×0,8/×1,2 | planejado |
| banda de taxa de falha | 0,25 a 0,45 | planejado |

---

## 18. Cronologia do projeto

| Data | Marco |
|---|---|
| 13/08/2026 | Spec e plano do núcleo jogável; scaffold Vite + TS + Phaser + Vitest; PRNG, event bus, loop fixo, `OpportunitySystem`, jogador, Assaltante, `Encounter`, overlay; movimento em 8 direções e câmera |
| 18/08/2026 | HUD de debug; esqueleto visual 2.5D; **especificação de perfil v2**; ciclo de 4 desfechos; `ProfileAccumulator`; dims 3 e 5 ligadas |
| 24–25/08/2026 | Migração para **projeção isométrica real**; tiles reais; WASD rotacionado; documento "estado atual" |
| 06/09/2026 | Documento consolidado (este); registro de ações data-driven; `EntropyAccumulator`; **dim 2**; mira por mouse, `fromScreen`, arco, arma pesada, troca de arma; **dim 1**; decisão do pipeline visual |
| 07/09/2026 | Pipeline Blender → sprites 3D; canvas escalado; HUD da arma; **kit defensivo e postura, dim 4**; **leque de ataque angular** |
| 12/09/2026 | **Janela segura, dim 6**; teste de equivalência simulação-vs-realidade; revisão final; reconciliação do documento (dims 1/2/4 ligadas); correção do manequim fantasma no pipeline |
| 13/09/2026 | Causa raiz da direção dos sprites encontrada (não commitado) |
| 28/09/2026 | Esta revisão completa do documento |

---

## 19. Métricas do repositório

*(medidas em 28/09/2026, sobre o que está commitado em `master`)*

| Métrica | Valor |
|---|---|
| Commits | 127 (13/08 a 12/09/2026, ~1 mês) |
| Por tipo | 62 `feat`, 30 `docs`, 16 `fix`, 6 `refactor`, 2 `test`, 2 `chore`, demais sem prefixo (spec/plano iniciais) |
| Código de produção TypeScript | 34 arquivos, ~2.280 linhas |
| Código de teste TypeScript | 22 arquivos, ~2.770 linhas (**mais teste que código**, razão ≈ 1,2:1) |
| Testes | 259, todos passando |
| Scripts Python (Blender) | 2 arquivos, ~280 linhas |
| Specs + planos + especificação v2 | 27 documentos, ~13.500 linhas de Markdown |
| Dependências de runtime | 1 (Phaser) |
| Dependências de desenvolvimento | 3 (TypeScript, Vite, Vitest) |
| Assets em uso | 2 tiles + 4 sprite sheets (2 personagens × idle/walk, 8 direções) |

---

## 20. Mapa para os capítulos do TCC

| Capítulo típico | Seções deste documento |
|---|---|
| Introdução (problema, pergunta, objetivos) | §1 |
| Fundamentação teórica | §8, §1.3, §2 (fundamentos matemáticos) |
| Trabalhos relacionados | §8.1, §8.2, §1.3 (DDA por contraste, player modeling) |
| Metodologia de pesquisa | §17, §6 (D1–D9), §3 |
| Metodologia de desenvolvimento | §15 (inclusive o uso de IA, §15.4) |
| Tecnologias utilizadas | §10, §7 |
| Arquitetura e implementação | §11, §12, §13, §14 |
| Verificação e validação | §15.3, §16 |
| Resultados parciais | §4, §5, §19 |
| Limitações e ameaças à validade | §16.8, §9, §2.2 (nota), §3 (comparabilidade) |
| Trabalhos futuros | §5.2, §9, §12.9, §7.7, §7.8 |
