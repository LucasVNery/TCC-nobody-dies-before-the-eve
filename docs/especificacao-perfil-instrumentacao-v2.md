# Especificação de Perfil e Instrumentação — v2

**Versão:** 2 · **Data:** 18/08/2026
**Escopo:** preenche as lacunas de `claude/arquitetura-v1.md` nas camadas PERFIL e TELEMETRIA.
**Relação com a v1:** a v1 continua valendo como documento de arquitetura e justificativa bibliográfica. Este documento **substitui** a v1 apenas nos pontos marcados como *(revisa v1 §X)*.

---

## 0. Decisões travadas nesta rodada

| # | Questão | Decisão | Revisa |
|---|---|---|---|
| D1 | Corte de dimensões (pendência §11.3) | **Nenhum corte a priori — mantêm-se as 7.** O corte passa a ser empírico: dimensões com ICC(1,1) < 0,50 no Estudo 1 são removidas antes do Estudo 2. | v1 §3.5, §11 |
| D2 | Semântica de `missed` / `expired` | Ambos contam no denominador. A distinção é **diagnóstica**, não aritmética. | v1 §4.1 |
| D3 | Semântica de `invalid` | Excluído de numerador **e** denominador. | v1 §4.1 |
| D4 | Persistência do perfil | **Continua entre runs, reseta entre sessões.** O perfil é do jogador, não da tentativa. | v1 §3.3 |
| D5 | Retenção / 2ª sessão | Não decidido. Esquema instrumentado para suportar, sem compromisso de execução. | v1 §11.2 |
| D6 | Mecanismo de suavização | **Contagens decaídas**, não EWMA sobre a razão. Unifica domínio e confiança num só mecanismo. | v1 §3.3, §3.4 |
| D9 | Taxonomia da dim 2 (repertório de ações) | **Remove `aéreo` do conjunto.** Novo conjunto: `{leve, pesado, carregado, arremesso, utilitário}`, **n = 5** fixo. `aéreo` exige eixo Z no combate; a decisão "combate 100% planar" (spec do núcleo jogável, 13/08) está travada, logo a remoção é consequência dela, não corte arbitrário. Se o eixo Z for reintroduzido num sub-projeto futuro, `aéreo` volta e `n` passa a 6. A dim 7 (uso de espaço) permanece bloqueada pelo mesmo motivo — fora de escopo até haver decisão sobre eixo Z, não pendência aberta. | §3.2 (06/09/2026) |

**Consequência de D1 no cronograma:** o Estudo 1 deixa de ser só validação e passa a ser **critério de seleção de dimensões**. Isso é uma melhoria de posicionamento — o corte vira resultado do trabalho, com justificativa estatística, em vez de decisão de projeto arbitrária. O texto do TCC deve enquadrar assim.

**Risco aceito de D1:** 7 dimensões dividem o mesmo orçamento de oportunidades por sala (v1 §6), o que rala os denominadores e retarda o gate de confiança. Mitigação obrigatória: o orçamento mínimo por dimensão da §6 precisa ser dimensionado para 7, não para 4. Ver §5 abaixo.

---

## 1. Taxonomia de unidades temporais

Quatro níveis, distintos e não intercambiáveis. Confundi-los foi a causa da ambiguidade original.

| Unidade | Definição | Identificador | Perfil |
|---|---|---|---|
| **encontro** | Um combate contra um grupo de inimigos numa sala | — | alimenta o *estado* |
| **run** | Uma tentativa completa pelo conteúdo roguelike, do início até morte ou conclusão | `run_id` + `seed` | **não reseta o perfil** |
| **sessão** | Uma visita do participante ao estudo, de uma sentada: calibração → treino → transferência. Contém N runs. | `session_id`, `session_idx` | **unidade de reset do perfil** |
| **participante** | A pessoa (ou agente sintético). Estável entre sessões. | `participant` | — |

**Retenção**, se vier a ser executada, é uma segunda **sessão** do mesmo **participante** dias depois.

---

## 2. Ciclo de vida da oportunidade *(revisa v1 §4.1)*

### 2.1 Os quatro desfechos

| Outcome | Regra | Ponto de decisão |
|---|---|---|
| `taken` | Jogador executou a ação qualificadora do `OppType` dentro de `window_ms` | No instante da ação — fecha a oportunidade imediatamente |
| `missed` | Jogador **respondeu, mas errado**. Duas sub-condições: (a) executou ação de classe incompatível com o `OppType` (atacou numa janela de esquiva, bloqueou golpe imbloqueável); (b) tentou a ação certa e falhou por execução (punish fora do timing, whiff, esquiva com i-frames fora de fase) | (a) no instante da ação desqualificadora; (b) no fim da janela, se houve tentativa registrada e não qualificadora |
| `expired` | Janela fechou por tempo **sem nenhuma tentativa registrada**, com o jogador apto a responder | No timer de `window_ms` |
| `invalid` | A oportunidade **nunca foi realmente oferecida** ao jogador | No fechamento, com pré-filtro possível na abertura |

**Precedência:** `invalid` > `taken` > `missed` > `expired`.

### 2.2 Condições canônicas de `invalid`

Uma oportunidade é `invalid` se, durante **a totalidade** da janela, ao menos uma valer:

1. Jogador preso em animação, hitstun ou knockdown originado de **outra fonte** que não a desta oportunidade.
2. Jogador fora de alcance efetivo ou fora da tela em relação à fonte.
3. Jogador morto, morrendo ou em i-frames de respawn.
4. A ferramenta exigida pelo `OppType` não está desbloqueada (ex.: `parry` sem o escudo).
5. A fonte da oportunidade (inimigo) morreu ou foi interrompida antes da janela materializar.
6. Outra oportunidade sobreposta de prioridade maior consumiu o input no mesmo frame.

Toda emissão de `invalid` **deve** carregar o motivo, para auditoria: sem isso não há como distinguir "instrumentação correta" de "bug que está engolindo denominador".

```ts
| { k:'opp.close'; opp_id:string;
    outcome:'taken'|'missed'|'expired'|'invalid';
    reason?: InvalidReason;      // obrigatório quando outcome==='invalid'
    attempt?: ActionId }          // ação registrada, quando outcome==='missed'
```

### 2.3 Aritmética no knowledge tracing

```
taken   → aproveitadas += 1 ; oportunidades += 1
missed  → oportunidades += 1
expired → oportunidades += 1
invalid → (nada)
```

`missed` e `expired` são **aritmeticamente idênticos** para `domínio(s)`. A separação existe pelo valor diagnóstico.

### 2.4 O sinal diagnóstico — uso na adaptação

```
omissao(s) = expired_s / (expired_s + missed_s)
```

| Leitura | Interpretação | Resposta do sistema |
|---|---|---|
| `omissao(s) > 0,65` | O jogador **não vê ou não conhece** a opção | Aumentar legibilidade: `window_ms` maior, telegrafia mais longa, frequência maior (`p_punish_window` ↑). Não aumentar dificuldade. |
| `omissao(s) < 0,35` | O jogador **conhece e executa mal** | Manter janela e telegrafia; aumentar apenas repetições no mesmo timing. Alargar a janela aqui seria remover a prática. |
| entre 0,35 e 0,65 | misto | Comportamento padrão do §5.2 da v1, sem modulação. |

Isto não estava na v1 e é o ganho mais barato disponível: os quatro outcomes já existiam no esquema, faltava usar os dois do meio. Também é material de defesa — é uma forma de exposição graduada (ref 8) que distingue *andaime* de *carga*.

---

## 3. As sete dimensões *(revisa v1 §3.5)*

As dimensões formam **duas famílias com matemática diferente**. A v1 tratou as duas na mesma tabela, o que produzia uma fórmula de domínio inaplicável a metade delas.

### 3.1 Família A — razão sobre oportunidades (dims 3, 5, 6, 7)

Usam a fórmula da v1 §3.4 sem alteração:

```
domínio(s)   = (aproveitadas_s + α) / (oportunidades_s + α + β)     α = β = 1
déficit(s)   = 1 − domínio(s)
confiança(s) = oportunidades_s / (oportunidades_s + κ)              κ = 10
```

| # | Dimensão | Numerador | Denominador |
|---|---|---|---|
| 3 ★ | Aproveitamento de punição | janelas `punish` com outcome `taken` | janelas `punish` com outcome ∈ {taken, missed, expired} |
| 5 | Distância operacional | tempo em alcance corpo-a-corpo | tempo total de combate |
| 6 | Paciência / comprometimento | ataques iniciados em janela segura | total de ataques iniciados |
| 7 | Uso de espaço | oportunidades `reposition` com outcome `taken` | oportunidades `reposition` ∈ {taken, missed, expired} |

**Bloqueio da dim 7 (revisto por D9):** exige um `OppType` `reposition` que não existe **e** esbarra na decisão "sem eixo Z". Fora de escopo até haver decisão explícita de arquitetura sobre eixo Z — não é pendência aberta a ser resolvida no fluxo normal de sub-projetos.

**Nota sobre 5 e 6:** não passam pelo `OpportunitySystem` — o denominador é tempo ou contagem de ações, não janela anotada. São mais baratas de instrumentar, e por isso devem estabilizar mais rápido no ICC. A confiança delas usa `κ` sobre a mesma contagem (segundos de combate para a 5, ataques para a 6).

### 3.2 Família B — entropia de repertório (dims 1, 2, 4)

**Não têm numerador nem denominador de oportunidade.** O valor é a entropia normalizada diretamente:

```
domínio(s) = H(s) = −Σ pᵢ·log(pᵢ) / log(n)
déficit(s) = 1 − H(s)
```

com `n` = número de opções **disponíveis ao jogador naquele momento** (v1 §3.5).

| # | Dimensão | Distribuição sobre | Base de contagem | Confiança sobre |
|---|---|---|---|---|
| 1 ★ | Entropia de repertório de armas | armas desbloqueadas | ações de ataque executadas | nº de ações de ataque |
| 2 ★ | Entropia de repertório de ações | {leve, pesado, carregado, arremesso, utilitário} — **n = 5**, ver D9 | ações executadas | nº de ações |
| 4 | Repertório defensivo | {esquiva, bloqueio, recuo, contra-ataque} | **apenas janelas defensivas resolvidas como `taken`** | nº de janelas defensivas `taken` |

Confiança da Família B: `confiança(s) = contagem_s / (contagem_s + κ_H)`, com `κ_H = 25` (entropia precisa de mais amostras que uma razão para estabilizar).

**Sobre a dim 4:** na v1, a coluna "denominador" dizia *janelas defensivas abertas*. Isso não é denominador aritmético — é a **base de contagem e de confiança**. A entropia é calculada só sobre as janelas efetivamente respondidas; janelas `expired` e `missed` não entram na distribuição (não há opção defensiva a contabilizar), mas alimentam o sinal `omissao` da §2.4 para o `OppType` defensivo.

### 3.3 Três casos-limite que quebram a entropia

Devem ser tratados explicitamente, não deixados para o runtime descobrir:

1. **`n < 2`** → `log(n) ≤ 0`, divisão por zero ou negativo. Regra: quando `n < 2`, a dimensão é **indefinida** naquele segmento — não contribui, não conta para confiança, e nunca pode ser déficit alvo. Um jogador com uma arma só não tem déficit de repertório de armas.
2. **`n` muda no meio da agregação** (desbloqueio de arma). Não se pode acumular contagens entre períodos com `n` diferente. Regra: **`n` só muda em fronteira de sala**. Calcula-se `H` por segmento de `n` constante, e agrega-se os valores de `H` pelo decaimento da §4, ponderados por contagem de ações do segmento.
3. **Contagem muito baixa no segmento** → `H` instável (2 ações dão H=1,0 ou H=0,0 e nada entre). Regra: segmentos com menos de 8 ações não produzem valor de `H` — as contagens transbordam para o segmento seguinte de mesmo `n`.

---

## 4. Agregação: contagens decaídas *(revisa v1 §3.3 e §3.4)*

A v1 descrevia "EWMA lenta" para o perfil e contagem cumulativa para a confiança. Os dois se descolam: a confiança sobe para sempre enquanto o domínio já esqueceu os dados antigos. **Um só mecanismo**, aplicado em **fronteira de sala**:

```
oportunidades_s ← γ · oportunidades_s + novas_s
aproveitadas_s  ← γ · aproveitadas_s  + novas_taken_s
```

Domínio e confiança são então derivados dessas contagens pelas fórmulas da §3.1. EWMA e confiança passam a ser **o mesmo objeto**, o que também simplifica a persistência (§6).

### Dois relógios, mesmo mecanismo *(mantém a intenção da v1 §3.3)*

| | Perfil (traço) | Estado (contexto) |
|---|---|---|
| `γ` | **0,87** (meia-vida ≈ 5 salas) | **0,55** (meia-vida ≈ 1,2 encontros) |
| Aplicado em | fronteira de **sala** | fronteira de **encontro** |
| Reset | fim de sessão *(D4)* | fim de encontro relevante |
| Consumido por | boss (congelado na entrada), Estudo 1 | inimigos comuns |
| Testado por | ICC(1,1) | não é testado |

**Persistência entre runs *(D4)*:** os acumuladores decaídos **não** são zerados em `run.start`. São zerados apenas em `session.start`. A morte do jogador é uma fronteira de sala como outra qualquer para efeito de decaimento.

> Isto revisa a frase "EWMA lenta sobre toda a **run**" da v1 §3.3, que agora lê **"sobre toda a sessão"**. Sem essa mudança, num roguelike com mortes frequentes a `confiança` poderia nunca cruzar 0,6 e a adaptação nunca ligaria — o grupo A viraria acidentalmente um segundo grupo controle, o que invalidaria o Estudo 2 silenciosamente.

---

## 5. Inventário de parâmetros

Valores propostos para tudo que a v1 deixou simbólico. Marcados **[v1]** os que já vinham do documento original.

| Parâmetro | Onde | Valor | Justificativa |
|---|---|---|---|
| `α`, `β` (prior Beta) | §3.1 | **1, 1** **[v1]** | Prior uniforme; evita que 1/1 vire domínio 100% |
| `κ` (confiança, Família A) | §3.1 | **10** | Gate 0,6 dispara em 15 oportunidades |
| `κ_H` (confiança, Família B) | §3.2 | **25** | Entropia precisa de mais amostras |
| gate de confiança | §3.1 | **0,60** **[v1]** | — |
| `γ_traço` | §4 | **0,87** | Meia-vida ≈ 5 salas |
| `γ_estado` | §4 | **0,55** | Meia-vida ≈ 1,2 encontros ("últimos 2–3", v1 §3.3) |
| mínimo de ações por segmento de H | §3.3 | **8** | Abaixo disso H é degenerada |
| `w_min`, `w_max` | v1 §5.2 | **0,25·base**, **4,0·base** | Weight clipping de Spronck (ref 1) |
| `λ_max` | v1 §5.5 | **1,1** | `e^1,1 ≈ 3` — amplificação máxima de 3× |
| ajuste de λ | v1 §5.5 | **×0,8 / ×1,2** **[v1]** | — |
| `banda_inf`, `banda_sup` | v1 §5.5 | **0,25 / 0,45** | Ver definição de taxa de falha abaixo |
| `λ_boss` | v1 §5.3 | mesma escala, regulado separadamente por tentativa | — |
| margem de troca de déficit alvo | §6 abaixo | **15%** | Histerese |
| teto de saída do déficit alvo | §6 abaixo | domínio **0,75** | — |

**Definição pendente resolvida — `taxa_de_falha` (v1 §5.5).** A v1 usa o termo sem defini-lo. Proposta:

```
inimigos comuns: mortes / salas jogadas, janela deslizante das últimas 5 salas
boss:            tentativas fracassadas / tentativas totais, acumulado na sessão
```

**Orçamento de oportunidades com 7 dimensões *(consequência de D1)*.** A v1 §6 pede "mínimo por dimensão, com reforço no déficit alvo". Com `κ = 10` e gate em 0,6, cada dimensão da Família A precisa de **15 oportunidades** para entrar na adaptação. Com 7 dimensões concorrendo, o mínimo por sala precisa ser dimensionado para que todas cruzem o gate dentro da fase de calibração + primeiras salas de treino. Se o orçamento não couber, a alternativa é aceitar que as dimensões caras (3, 7) demorem mais a ligar — **e registrar isso**, porque produz assimetria sistemática entre dimensões que vai aparecer no ICC.

---

## 6. "Déficit" e "déficit alvo"

**Déficit é contínuo, não binário.** `déficit(s) = 1 − domínio(s)` ∈ [0,1]. Toda dimensão sempre tem um déficit. Não existe limiar que classifique uma dimensão como "deficitária".

Os limiares existem em outros dois lugares:

1. **Gate de confiança:** `confiança(s) < 0,6` → o déficit é ignorado pela adaptação (não diz que não há déficit; diz que não há dado para agir).
2. **Seleção do alvo (v1 §5.5b — um déficit por vez):** entre as dimensões que passaram do gate, escolhe-se `argmax(confiança(s) × déficit(s))`.

**Déficit alvo** é sempre exatamente **um**, e é ele que vai para o orçamento de oportunidades do PCG (v1 §6, passo 1) e para o reforço da adaptação.

### Histerese na troca de alvo *(não existia na v1)*

Sem isso, duas dimensões próximas fazem o alvo oscilar sala a sala — o oposto de exposição graduada (ref 8). Regra:

```
trocar o déficit alvo somente se:
    (a) domínio(alvo_atual) ≥ 0,75              // objetivo atingido, passar ao próximo
 ou (b) score(candidato) > score(alvo_atual) · 1,15   // superioridade clara
 ou (c) confiança(alvo_atual) caiu abaixo de 0,6      // decaimento tirou do gate

onde score(s) = confiança(s) × déficit(s)
```

**Nota de honestidade metodológica:** a fórmula de pesos da v1 §5.2 soma sobre **todas** as dimensões (`Σₛ déficitₛ · confiançaₛ · tagₛ,ᵢ`), o que contradiz o "um déficit por vez" da §5.5(b). Os dois não podem valer ao mesmo tempo. **Decisão:** vale o §5.5(b) — a soma é restrita ao déficit alvo, e a fórmula da v1 §5.2 passa a ler:

```
wᵢ = base_weightᵢ · exp( λ · déficit(alvo) · confiança(alvo) · tag_alvo,ᵢ )
```

Isso mantém `λ = 0 ⟹ pesos-base`, portanto o grupo controle continua saindo de graça (v1 §5.2), que é a propriedade que não se pode perder.

---

## 7. Deltas no esquema de eventos *(revisa v1 §4.1)*

Bump de versão: `v: 2`.

```ts
type Evt =
  | { k:'session.start';    participant:string; session_idx:number;   // ← NOVO
                            condition:'adaptive'|'control' }
  | { k:'run.start';        seed:number; session_id:string }           // participant/condition sobem para session.start
  | { k:'room.enter';       archetype:string; opp_budget:Record<SkillId,number> }
  | { k:'enemy.spawn';      enemy_id:string; archetype:string;
                            script_id:string; rule_ids:string[]; weights:number[] }
  | { k:'opp.open';         opp_id:string; type:OppType; src:string; window_ms:number;
                            n_options?:number }                        // ← NOVO (Família B, §3.3)
  | { k:'opp.close';        opp_id:string;
                            outcome:'taken'|'missed'|'expired'|'invalid';
                            reason?:InvalidReason;                     // ← NOVO, obrigatório se invalid
                            attempt?:ActionId }                        // ← NOVO, presente se missed
  | { k:'profile.snapshot'; at:'room.exit'|'boss.entry'|'transfer.entry';  // ← NOVO
                            counts:Record<SkillId,[number,number]>;    // [aproveitadas, oportunidades] decaídas
                            domain:Record<SkillId,number>;
                            confidence:Record<SkillId,number>;
                            target:SkillId|null; lambda:number }
  | { k:'player.action';    action:ActionId; weapon:WeaponId; opp_id?:string }
  | { k:'player.hurt';      amount:number; src:string; avoidable:boolean; opp_id?:string }
  | { k:'boss.attempt';     phase:'start'|'end'; profile:number[]; bt_params:Record<string,number> }
  | { k:'transfer';         phase:'start'|'end'; session_idx:number }  // ← session_idx NOVO
```

Envelope comum passa a ser `{v, t_ms, session_id, run_id, room_id, seq}`.

**Justificativa de cada campo novo:**

- `session.start` + `session_idx` — suporta retenção *(D5)* a custo próximo de zero. Se a segunda sessão não acontecer, `session_idx` fica constante em 1 e ninguém se importa. Se acontecer e o campo não existir, os dados das duas sessões viram um pool indistinguível e a retenção é immensurável *post hoc*.
- `reason` em `invalid` — auditoria. Sem isso não há como distinguir instrumentação correta de bug engolindo denominador (§2.2).
- `attempt` em `missed` — permite reconstruir *qual* erro o jogador cometeu, não só que errou.
- `n_options` em `opp.open` — reconstrução offline da entropia com o `n` correto do momento (§3.3, caso 2).
- `profile.snapshot` — **o mais importante para a análise.** Sem ele, o ICC do Estudo 1 precisa reconstruir o perfil por replay dos eventos, o que só funciona se o replay for perfeito. Com ele, o perfil medido é dado bruto. Emitir em toda saída de sala.

**Compatibilidade:** eventos com `v: 1` não têm esses campos. Como a coleta ainda não começou, não há dado legado — o bump é preventivo e o parser pode exigir `v ≥ 2`.

---

## 8. Ordem de implementação sugerida

1. `opp.open` / `opp.close` com os **quatro** outcomes e a tabela de precedência da §2.1 — é a peça de maior risco técnico (v1, próximos passos).
2. Harness de teste que dispara oportunidades sintéticas e verifica que a soma `taken + missed + expired + invalid` fecha com as aberturas. Denominador que vaza é o modo de falha silenciosa mais provável do projeto.
3. Acumuladores decaídos (§4) + `profile.snapshot`.
4. Família A (dims 3, 5, 6, 7) — mais simples.
5. Família B (dims 1, 2, 4) com os três casos-limite da §3.3.
6. Seleção de déficit alvo com histerese (§6).
7. Só então: pesos de regra e parâmetros de BT.

O Estudo 1 pode rodar ao fim do passo 5 — não precisa da adaptação funcionando, porque o perfil precisa ser provado estável **antes** de qualquer coisa ser construída em cima dele (v1 §3.6, §10).

---

## 9. Pendências remanescentes

**Da v1 §11, ainda abertas:**

- Humanos ou agentes sintéticos como participantes. *(Sem impacto no formato de dados — o campo `participant` serve aos dois. Impacta cálculo amostral e comitê de ética.)*
- Retenção em segunda sessão — **decisão adiada, esquema preparado** *(D5)*.
- Eixo Z real no combate. **Bloqueia a dim 7** (define se "vertical" existe) e a ação `aéreo` da dim 2. Precisa ser decidido antes do passo 4 da §8.
- Verificação bibliográfica das 11 entradas marcadas.

**Novas, criadas por esta especificação:**

- Dimensionamento do orçamento de oportunidades para 7 dimensões (§5).
- Conjunto fechado de `InvalidReason` (§2.2 dá 6 casos; confirmar se é exaustivo depois do protótipo).
- Valores de `base`, `min`, `max` para cada `p_*` da BT do boss (v1 §5.3) — decisão de design, não de análise.
