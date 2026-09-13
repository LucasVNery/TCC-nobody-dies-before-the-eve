# Instrumento de Perfil Adaptativo — Documento de Referência

**Atualizado:** 06/09/2026
**Stack:** Phaser 3 · TypeScript · Vite · Vitest
**Estágio:** Instrumentação — passo 3,5 de 7

Roguelike isométrico cuja contribuição de pesquisa não é o jogo, mas um instrumento de medição: um perfil de sete dimensões que detecta o que o jogador evita, e um boss que usa esse perfil para forçar prática da habilidade evitada.

> Documento gerado a partir dos specs em `docs/superpowers/specs/`, da especificação de perfil `docs/especificacao-perfil-instrumentacao-v2.md` e do estado do código em `src/`. É uma fotografia — vai desatualizar conforme o projeto avança.
>
> Versão navegável (Artifact): https://claude.ai/code/artifact/12ec32ec-d477-4993-bd33-525bd6245efb

---

## Sumário

1. [Objetivo de pesquisa](#1-objetivo-de-pesquisa)
2. [As duas famílias](#2-as-duas-famílias)
3. [Registro das 7 dimensões](#3-registro-das-7-dimensões)
4. [Estágio atual](#4-estágio-atual)
5. [Trilha de sub-projetos](#5-trilha-de-sub-projetos)
6. [Decisões travadas](#6-decisões-travadas)
7. [Tecnologias avaliadas](#7-tecnologias-avaliadas)
8. [Referências científicas](#8-referências-científicas)
9. [Pendências abertas](#9-pendências-abertas)

---

## 1. Objetivo de pesquisa

O jogo é um **instrumento**. A pergunta da tese não é "esse inimigo é divertido" nem "esse algoritmo vence o jogador", e sim: **um inimigo que adapta seu comportamento para criar oportunidades de prática da habilidade que o jogador evita produz aprendizado transferível?** Ou seja: o jogador melhora de verdade, ou só aprende a matar aquele inimigo específico?

### 1.1 O enquadramento reconciliado

Duas leituras do projeto coexistiam e precisavam ser unificadas:

- **Pedagógica** — o inimigo cria oportunidades de prática, e a variável medida é aprendizado transferível.
- **Adversarial** — o boss prevê o jogador para abrir janelas de ataque para si mesmo.

São perguntas de pesquisa diferentes, com experimentos diferentes — mas há uma ponte.

> **DECISÃO DE ENQUADRAMENTO**
>
> O preditor do boss **não existe para maximizar dano**. Ele existe para tornar *previsível = ineficaz*: quando o modelo prevê a ação do jogador com alta confiança, o boss escolhe a resposta que **nega aquele padrão**, forçando o jogador a sair do vício.
>
> "Abrir janela de ataque para o boss" e "criar oportunidade de prática da habilidade evitada" passam a ser **a mesma operação, vista dos dois lados**. Isso preserva a tese original e entrega a sensação de boss inteligente que pune repetição.

### 1.2 Quem adapta, e quem não adapta

Decisão travada: **apenas o boss adapta.**

Os inimigos comuns têm IA fixa e funcionam como instrumento de coleta estável — é diante deles que o perfil do jogador é medido, sem que a própria medição altere o alvo. O boss consome o perfil **congelado na entrada** da sala e concentra toda a adaptação num único ponto, o que isola a variável experimental.

> **CONFUNDIDOR DESCARTADO**
>
> "Inimigos progressivamente mais fortes" foi **rejeitado** como mecânica. Uma rampa monotônica de dificuldade impede separar "o jogador aprendeu" de "o jogo ficou mais difícil" nos dados. Se houver progressão, ela precisa ser idêntica entre grupo controle e grupo adaptativo.

---

## 2. As duas famílias

As sete dimensões não compartilham matemática. Tratá-las na mesma tabela foi o erro da v1 da especificação.

### 2.1 Família A — razão sobre oportunidades

Dimensões **3, 5, 6 e 7**. Cada uma tem numerador e denominador reais: quantas oportunidades apareceram, e quantas o jogador aproveitou. O domínio usa um prior Beta (α = β = 1) para não explodir com poucas amostras.

```
domínio(s)   = (aproveitadas_s + α) / (oportunidades_s + α + β)   α = β = 1
déficit(s)   = 1 − domínio(s)
confiança(s) = oportunidades_s / (oportunidades_s + κ)            κ = 10
```

### 2.2 Família B — entropia de repertório

Dimensões **1, 2 e 4**. Não têm numerador nem denominador de oportunidade — o valor *é* a entropia normalizada da distribuição de uso. É aqui que vivem "vício" e "criatividade": um jogador que só usa uma opção tem entropia baixa, ou seja, déficit de repertório.

```
p_i          = count_i / Σ count              i sobre rótulos com count > 0
domínio(s)   = H(s) = −Σ p_i·ln(p_i) / ln(n)
déficit(s)   = 1 − H(s)
confiança(s) = contagem_s / (contagem_s + κ_H)   κ_H = 25
```

`n` é o número de opções **disponíveis** ao jogador, não o número de opções que ele usou. Um jogador com 5 ações disponíveis que só usa 2 tem `H = ln(2)/ln(5) ≈ 0,43` — déficit real. O `κ_H` é maior que o `κ` da Família A porque entropia precisa de mais amostras que uma razão simples para estabilizar.

#### Casos-limite da entropia

| Situação | `domínio()` | Conta p/ confiança | Pode ser déficit-alvo |
|---|---|---|---|
| `totalCount == 0` | `null` | não | não |
| 1 rótulo distinto (n efetivo < 2) | `null` | sim | **não** |
| ≥ 2 rótulos distintos | `H ∈ [0, 1]` | sim | sim |

A regra do meio é a que evita um absurdo: um jogador com uma arma só não tem "déficit de repertório de armas" — ele tem uma arma só.

### 2.3 Mecanismo comum: contagens decaídas

Ambas as famílias usam **contagens decaídas** em vez de EWMA sobre a razão — isso unifica domínio e confiança num só mecanismo. Cada dimensão roda em dois relógios independentes:

| Relógio | γ | Decai em | Representa | Consumido por |
|---|---|---|---|---|
| `trait` | 0,87 | saída de sala | o jogador ao longo da sessão | boss (congelado na entrada), Estudo 1 |
| `state` | 0,55 | fim de encontro | a janela recente | inimigos comuns |

O perfil **persiste entre runs e reseta entre sessões** — é do jogador, não da tentativa. Num roguelike com mortes frequentes, resetar por run faria a confiança nunca cruzar o gate de 0,6, e a adaptação nunca ligaria.

### 2.4 Os quatro desfechos de oportunidade

Toda janela anotada pelo `OpportunitySystem` fecha com exatamente um desfecho, resolvido por tabela de precedência (`invalid` > `taken` > `missed` > `expired`):

| Desfecho | Numerador | Denominador | Significado diagnóstico |
|---|---|---|---|
| `taken` | sim | sim | aproveitou a janela |
| `missed` | não | sim | tentou e errou |
| `expired` | não | sim | não tentou — alimenta o sinal de *omissão* |
| `invalid` | não | **não** | janela inválida; não conta em nada |

> **MODO DE FALHA JÁ MITIGADO**
>
> Um denominador "vazando" — janela aberta que nunca fecha — corromperia todas as razões em silêncio. Existe um harness de teste que verifica que a soma dos desfechos sempre fecha com o número de aberturas.

---

## 3. Registro das 7 dimensões

Nenhum corte a priori. As dimensões que sobrevivem são resultado empírico do Estudo 1, não decisão de projeto.

| # | Dimensão | Fam. | Distribuição ou razão | Status | Bloqueio |
|---|---|---|---|---|---|
| 1 | Repertório de armas | B | uso entre as armas disponíveis · **n = 3** | ❌ Não iniciada | só existe uma "arma" hoje |
| 2 | Repertório de ações | B | `{leve, pesado, carregado, arremesso, utilitário}` · **n = 5** | 🔵 Em spec | sub-projeto atual |
| 3 | Aproveitamento de punição | A | punições `taken` / `taken+missed+expired` | ✅ Ligada | — |
| 4 | Repertório defensivo | B | `{esquiva, bloqueio, recuo, contra-ataque}` · **n = 4** | ❌ Não iniciada | só a esquiva existe |
| 5 | Distância operacional | A | tempo em alcance corpo-a-corpo / tempo total | ✅ Ligada | — |
| 6 | Paciência / comprometimento | A | ataques em janela segura / total de ataques | ✅ Ligada | — |
| 7 | Uso de espaço | A | oportunidades `reposition` `taken` / total | ❌ Fora de escopo | sem `OppType reposition` · sem eixo Z |

Só **três das sete** estão conectadas a dados reais do jogo. As três da Família B — justamente as que medem vício e criatividade — dependem de conteúdo de jogo que ainda não existe: o jogador tem duas ações e uma arma.

> **RISCO ACEITO**
>
> Sete dimensões dividem o mesmo orçamento de oportunidades por sala, o que rala os denominadores e retarda o gate de confiança. Mitigação obrigatória: o orçamento mínimo por sala precisa ser dimensionado para 7 dimensões, não para 4.

---

## 4. Estágio atual

Roadmap oficial de sete passos. A metade de instrumentação está sólida; a metade de adaptação ainda não existe em código.

**4 completos · 3 não iniciados**

| # | Passo | Status | Nota |
|---|---|---|---|
| 1 | `opp.open`/`opp.close` com os 4 desfechos e precedência | ✅ Feito | |
| 2 | Harness verificando que os desfechos fecham com as aberturas | ✅ Feito | |
| 3 | Acumuladores decaídos + `profile.snapshot` | ✅ Feito | |
| 4 | Família A — dims 3, 5, 6, 7 | ✅ Feito no escopo | 3, 5 e 6 ligadas; 7 fora de escopo (sem eixo Z) |
| 5 | Família B — dims 1, 2, 4 | 🔵 Em spec | Estudo 1 pode rodar ao fim deste passo |
| 6 | Seleção de déficit-alvo com histerese | ❌ Não iniciado | `snapshot.target` é sempre `null` hoje |
| 7 | Pesos de regra, boss adaptativo e preditor | ❌ Não iniciado | `snapshot.lambda` é sempre `0` hoje |

> **LEITURA HONESTA**
>
> O jogador já gera dados de perfil em tempo real, mas **nenhum inimigo reage a esses dados ainda**. A ponte déficit-alvo → peso de regra → comportamento do inimigo é onde a contribuição central da tese começa a existir em código — e ela está inteiramente à frente, não atrás.
>
> A ordem, porém, está certa: o perfil precisa ser *provado estável* antes de qualquer coisa ser construída em cima dele. Construir o boss antes do passo 5 seria construí-lo sobre um instrumento não validado.

### 4.1 Estado por camada de código

| Camada | Conteúdo | Status |
|---|---|---|
| `core/` | loop de timestep fixo 60 Hz, PRNG semeado, barramento de eventos tipado | ✅ Completo |
| `combat/` | hitboxes AABB, ações, estados do jogador e do Assaltante, `Encounter` | ✅ Completo p/ escopo |
| `opportunity/` | `OpportunitySystem` com 4 desfechos; tipos `dodge` e `punish` | ✅ Completo |
| `profile/` | `ProfileAccumulator` genérico; 3 de 7 dimensões ligadas | 🟡 Parcial |
| `ai/` | 2 regras fixas do Assaltante; nada lê o perfil | 🟡 Mínimo |
| `visual/` | projeção isométrica 2:1, tiles reais, entidades como retângulos | ✅ Completo p/ escopo |
| `debug/` | overlay de oportunidades + HUD de contadores | ✅ Completo |

Determinismo é um ativo de pesquisa deliberado: **um único PRNG semeado**, sem `Math.random()` em nenhuma camada de lógica, e loop de timestep fixo desacoplado do framerate de render. Isso torna qualquer sessão reproduzível por replay — condição para reconstruir o perfil se um `profile.snapshot` se perder.

---

## 5. Trilha de sub-projetos

Cada passo é um ciclo completo: spec → plano → implementação TDD → revisão. Fatiamento vertical fino — cada passo entrega uma dimensão medindo de ponta a ponta.

| # | Sub-projeto | Entrega | Status |
|---|---|---|---|
| 1 | Registro de ações + espada&nbsp;+&nbsp;escudo | **dim 2** — refactor do `PlayerController` para modelo data-driven; ações leve, pesado e carregado; entropia ligada ao snapshot | 🔵 Spec pronta |
| 2 | Arco + arma pesada + troca de arma | **dim 1** — 3 armas carregadas simultaneamente, troca com recovery de ~250 ms cancelável por esquiva | Planejado |
| 3 | Kit defensivo + barra de postura | **dim 4** — recuo, bloqueio e parry universais; escudo com bloqueio superior; postura quebra e causa stagger | Planejado |
| 4 | Predicado de "janela segura" | **dim 6** — ausência de hitbox ativa ou telegrafada que alcance o jogador dentro do recovery da ação escolhida | Planejado |
| 5 | Seleção de déficit-alvo com histerese | Primeira vez que o perfil influencia alguma coisa. Estudo 1 roda antes daqui. | Planejado |
| 6 | Boss adaptativo: pesos de regra + preditor N-gram | A contribuição central da tese em código | Planejado |

### 5.1 Decisões de design do repertório

| Questão | Decisão | Consequência de medição |
|---|---|---|
| Acesso às armas | Carrega as 3, troca livre em combate | dim 1 com `n=3` fixo dentro da run; vício aparece como distribuição enviesada |
| Custo da troca | ~250 ms de recovery, cancelável por esquiva | troca vira decisão tática, não reflexo; gera janela previsível que o boss pode aprender a punir |
| Ação carregada | Não é ação à parte — é `actionType: 'charged'` com campo `charge`; dano escala linearmente com o hold | uma entrada na tabela de ações, não um estado novo na máquina |
| Defesas | Bloqueio e parry universais; escudo bloqueia muito melhor | dim 4 com `n=4` fixo e **sem efeito de loadout** — mais limpa para o ICC |
| Custo do bloqueio | Barra de postura exclusiva do bloqueio; sem stamina global | stamina global acoplaria ofensiva e defensiva e contaminaria dims 2 e 4 de uma vez |
| Esquiva vs. recuo | Esquiva tem i-frames (vence por timing); recuo não tem (vence por espaçamento) | categorias disjuntas — sem sobreposição, a entropia da dim 4 não mede ruído |

---

## 6. Decisões travadas

Não mudam sem discussão explícita. Cada uma tem um documento de origem citável.

| ID | Questão | Decisão |
|---|---|---|
| D1 | Corte de dimensões | Nenhum corte a priori — mantêm-se as 7. Dimensões com `ICC(1,1) < 0,50` no Estudo 1 são removidas antes do Estudo 2. *O corte vira resultado do trabalho, com justificativa estatística.* |
| D2 | `missed` vs `expired` | Ambos contam no denominador. A distinção é diagnóstica, não aritmética. |
| D3 | `invalid` | Excluído de numerador *e* denominador. |
| D4 | Persistência do perfil | Continua entre runs, reseta entre sessões. O perfil é do jogador, não da tentativa. |
| D5 | Retenção / 2ª sessão | Não decidido. Esquema instrumentado para suportar, sem compromisso de execução. |
| D6 | Suavização | Contagens decaídas, não EWMA sobre a razão. Unifica domínio e confiança num só mecanismo. |
| D9 | Taxonomia da dim 2 | Remove `aéreo`. Conjunto passa a `{leve, pesado, carregado, arremesso, utilitário}`, `n = 5`. Consequência da decisão "combate 100% planar", não corte arbitrário. |

### 6.1 Decisões de arquitetura

| Questão | Escolha |
|---|---|
| Câmera | Isométrica real (losango 2:1), câmera "de ladinho" estilo Hades/Diablo |
| Eixo Z | **Não existe.** Combate inteiro no plano do chão; depth isométrico é ordem de desenho, não física |
| Separação lógica/visual | `combat/`, `opportunity/`, `ai/` e `profile/` nunca importam de `visual/`. Só `ArenaScene` enxerga os dois lados |
| Ações do jogador | Data-driven: adicionar ação é acrescentar dado numa tabela, não escrever código |
| Determinismo | PRNG único semeado; sem `Math.random()` na lógica; timestep fixo |
| Estética | Última prioridade. Entidades como prismas isométricos; ataques como volumes de hitbox projetados |

> **EFEITO DOMINÓ DO EIXO Z**
>
> "Sem eixo Z" é a decisão mais fundamental do projeto e ela bloqueia duas coisas de uma vez: a ação `aéreo` da dim 2 (resolvida por D9, que a remove) e a **dim 7 inteira** (uso de espaço). Reintroduzir o eixo Z não é ajuste — é decisão de arquitetura que invalidaria parte do `OpportunitySystem`, das hitboxes e da projeção isométrica.

---

## 7. Tecnologias avaliadas

O que foi considerado e por que foi ou não adotado. Material direto para a seção de decisões técnicas do TCC.

### 7.1 Máquina de estados do jogador

| Opção | Veredito | Razão |
|---|---|---|
| XState | ❌ Rejeitado | Statecharts hierárquicos e visualizador são poderosos, mas é dependência grande e declarativa que destoa do estilo imperativo de `combat/`. A máquina do player tem 3 estados. |
| fiume / robot | ❌ Rejeitado | FSMs minimalistas e zero-dependência — ainda assim, lib para um problema de 3 estados. |
| Máquina à mão | ✅ Adotado | Discriminated union + `switch` exaustivo. É o padrão que o resto do código usa, e o compilador garante exaustividade. |

### 7.2 Cálculo de entropia

| Opção | Veredito | Razão |
|---|---|---|
| `shannon-entropy` (npm) | ❌ Rejeitado | Descontinuado — sem release há mais de 12 meses. |
| `binary-shannon-entropy` | ❌ Rejeitado | Opera sobre buffers binários, log base 2 não normalizado. Não faz o que a Família B pede (normalização por `ln(n)` com `n` fixo). |
| Implementação própria | ✅ Adotado | A fórmula inteira são ~8 linhas. Mais fácil de testar e de defender perante a banca do que justificar uma dependência. |

### 7.3 Combate e hitbox em Phaser

Não existe lib madura de "sistema de combate data-driven" para Phaser 3. `phaser3-hadoken` resolve *sequências de input* (comandos estilo jogo de luta), não ciclo de vida de ação e hitbox. O projeto já tem colisão AABB determinística própria. **Nada a adotar.**

### 7.4 Assets e placeholders

| Recurso | Licença | Aplicabilidade |
|---|---|---|
| [Kenney — Prototype Kit](https://kenney.nl/assets/prototype-kit) | CC0 | 145 peças de blockout. Phaser é 2D → exige pré-renderizar sprites via Blender headless. Sub-projeto visual futuro. |
| [Kenney — Blocky Characters](https://kenney.nl/assets/blocky-characters) | CC0 | 20 modelos com 27 animações. "Boneco 3D de prototipagem" pronto, mesma ressalva de pipeline. |
| [KayKit](https://www.kaylousberg.com) / Quaternius | CC0 | Packs low-poly de personagens e dungeon. Mesma ressalva. |

> **RECOMENDAÇÃO PARA AGORA**
>
> Desenhar **prismas isométricos** — três faces com tons diferentes — direto em `src/visual/`, com hitboxes de ataque como volumes projetados na mesma malha. Custo quase zero, sem dependência, sem pipeline, e entrega a leitura "caixa 3D com margens de hitbox".
>
> Migração para Three.js ou Babylon fica registrada como sub-projeto visual futuro possível: a separação lógica/visual atual é real, então `combat/`, `opportunity/`, `ai/` e `profile/` sobreviveriam intactos.

---

## 8. Referências científicas

Fundamentação por função no argumento. **Confira cada entrada na fonte primária antes de citar no texto final.**

### 8.1 Predição de comportamento do jogador

**Laird, J. E. (2001).** *It Knows What You're Going to Do: Adding Anticipation to a Quakebot.* Proceedings of the Fifth International Conference on Autonomous Agents, AAAI / ACM.

> **Função:** referência canônica de antecipação de jogador em jogo de ação. O bot usa predição interna baseada nas próprias táticas para antecipar o oponente — é praticamente o caso de uso do boss. Fundamenta a escolha do preditor como mecanismo, não como enfeite.

**Millington, I.** — capítulo *Implementing N-Grams for Player Prediction*, em **Game AI Pro**. Complementado por **Chiu et al. (2014)**, *Online Opponent Modeling for Action Prediction*, Journal of Internet Technology.

> **Função:** técnica concreta. N-gram sobre sequência discretizada de ações e direções é determinístico (compatível com o PRNG semeado e com replay), explicável perante a banca, barato em amostras — crítico num TCC sem dataset grande — e implementável em poucas centenas de linhas.

> **O QUE EVITAR**
>
> LSTM ou qualquer aprendizado profundo para predição de trajetória: dados insuficientes, não-determinismo que quebra o replay, e perda da explicabilidade que a banca vai cobrar.

### 8.2 Adaptação de IA de jogo

**Spronck, P., Ponsen, M., Sprinkhuizen-Kuyper, I., & Postma, E. (2006).** *Adaptive Game AI with Dynamic Scripting.* Machine Learning, 63(3), 217–248.

> **Função:** espinha dorsal do mecanismo adaptativo — a base dos *pesos de regra* do passo 7. Também fornece o enquadramento de requisitos que o TCC pode adotar diretamente: computacionais (velocidade, eficácia, robustez, eficiência) e funcionais (clareza, variedade, consistência, escalabilidade).

**Hunicke, R., & Chapman, V. (2004).** *AI for Dynamic Difficulty Adjustment in Games.* Challenges in Game AI Workshop, AAAI 2004. Ver também **Hunicke (2005)**, *The case for dynamic difficulty adjustment in games*, ACE '05.

> **Função:** literatura de DDA — necessária para *delimitar por contraste*. O trabalho precisa deixar explícito que não faz ajuste de dificuldade: adapta para criar oportunidade de prática, não para manter taxa de vitória.

**Yannakakis, G. N., & Togelius, J.** *Artificial Intelligence and Games.* Springer (1ª ed. 2018; 2ª ed. 2025), capítulo *Player Modeling*.

> **Função:** livro-texto de referência. Fornece a taxonomia de *player modeling* na qual o perfil de 7 dimensões deve ser posicionado, e a distinção entre modelagem e imitação de jogador.

### 8.3 Fundamentação pedagógica

**Ericsson, K. A., Krampe, R. Th., & Tesch-Römer, C. (1993).** *The role of deliberate practice in the acquisition of expert performance.* Psychological Review, 100(3), 363–406.

> **Função:** sustenta a *pergunta* da tese. Prática deliberada é prática dirigida à fraqueza, com feedback imediato — que é exatamente o que "criar oportunidades de prática da habilidade evitada" operacionaliza dentro do jogo.

**Gick, M. L., & Holyoak, K. J. (1983).** *Schema induction and analogical transfer.* Cognitive Psychology, 15(1), 1–38. Literatura de transferência próxima vs. distante.

> **Função:** define a variável dependente. A literatura documenta que transferência distante é difícil de demonstrar — o desenho experimental deve medir **transferência próxima** (nova sala, novo arquétipo de inimigo, mesma habilidade) e ser explícito quanto a isso, em vez de prometer transferência distante.

### 8.4 Validação do instrumento

**Shrout, P. E., & Fleiss, J. L. (1979).** *Intraclass correlations: Uses in assessing rater reliability.* Psychological Bulletin, 86(2), 420–428.

> **Função:** origem formal do `ICC(1,1)`, o critério do Estudo 1. É a referência que justifica *qual* das dez formas de ICC está sendo usada e por quê.

**Koo, T. K., & Li, M. Y. (2016).** *A Guideline of Selecting and Reporting Intraclass Correlation Coefficients for Reliability Research.* Journal of Chiropractic Medicine, 15(2), 155–163.

> **Função:** guia prático de escolha e de reporte, e fonte das faixas de interpretação que embasam o corte em 0,50 da D1.
>
> ⚠️ **Atenção:** há erratum publicado — na Tabela 3, o termo `(k+1)` do denominador de ICC(1,1) deve ser `(k−1)`.

**Shannon, C. E. (1948).** *A Mathematical Theory of Communication.* Bell System Technical Journal, 27, 379–423 e 623–656.

> **Função:** origem da medida de entropia usada na Família B. A normalização por `ln(n)` — para tornar dimensões com números diferentes de opções comparáveis — é escolha deste trabalho e deve ser justificada como tal.

---

## 9. Pendências abertas

Decisões que ainda não foram tomadas, com o que cada uma bloqueia.

| Pendência | Natureza | Bloqueia |
|---|---|---|
| Documento de arquitetura v1.1 fora do repositório | Organizacional | Todos os specs citam `v1 §3.5`, `§11` etc. como fonte da verdade, mas o arquivo vive fora do repo. Qualquer revisão de arquitetura é feita sobre base que ninguém consegue ler junto com o código. |
| Humanos vs. agentes sintéticos como participantes | Metodológica | Sem impacto no formato de dados — o campo `participant` serve aos dois. Impacta cálculo amostral e comitê de ética. |
| Retenção em segunda sessão | Metodológica | Adiada. Esquema já preparado (mesmo `participant`, `session_idx` diferente). |
| Eixo Z real no combate | Arquitetural | Dim 7 inteira. Decisão grande — mudá-la invalidaria parte do `OpportunitySystem`, das hitboxes e da projeção isométrica. |
| Predicado de "janela segura" | Design | Dim 6. Definição esboçada existe; falta virar código. |
| Verificação bibliográfica de 11 entradas | Revisão de literatura | Nada em código. Pendência de escrita. |
| Telemetria rica (heatmap, direção de dash) | Escopo | Nada — mas a recomendação registrada é **fechar o loop mínimo antes de expandir a coleta**, para não remodelar telemetria depois que a adaptação estiver rodando. |
| Redesign de HUD (gameplay vs. dev mode) | Design/UX | Nada bloqueado, mas registrado 07/09/2026: a HUD atual é texto cru mal dimensionado. Quando for redesenhada, precisa de dois modos — **gameplay** (o mínimo: ataque, esquiva, o que um jogador comum precisa ver) e **dev** (tudo: todos os inputs, dados sendo coletados pelo perfil, behavior tree do boss e suas decisões). Até lá, qualquer adição de HUD (ex: kit defensivo) fica no estilo texto cru já existente, sem investir em polimento visual prematuro. |

### 9.1 O maior bloqueio não é o boss

Três das sete dimensões — 1, 2 e 4, justamente as que medem vício e criatividade — estão bloqueadas por **falta de conteúdo de jogo, não por falta de algoritmo**. O jogador tem duas ações e uma arma; a entropia sobre isso é matematicamente quase degenerada. Nenhuma quantidade de trabalho no boss resolve isso, e é por isso que a trilha de repertório (§5) vem antes da trilha de adaptação.
