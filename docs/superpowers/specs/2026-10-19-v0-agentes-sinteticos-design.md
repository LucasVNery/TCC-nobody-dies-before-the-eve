# V0: validação do perfil com agentes sintéticos e relatório — Design

**Data:** 2026-10-19
**Status:** implementado em 2026-10-19; execução completa pendente. Origem: rascunho revisado pelo autor. O autor aprovou os três pontos de partida (estilos, unidade do ICC, tamanho); o restante são padrões do Claude, marcados como **[minha escolha]**.
**Contexto:** `Contexto_pesquisa/documento-tecnico-mestre.md` §4.3 (perfil), §8.4 (plano de validação V0 a V3), §8.5 (dados-piloto e congelamento). Decisão D-0: o sistema de perfil é o produto; o chefe preditivo é só validação.

## 1. Intenção

Hoje o perfil descritivo está implementado (seis de sete dimensões, `ProfileAccumulator`), mas **nenhuma dimensão foi validada**: a confiança do perfil mede só tamanho de amostra. A V0 responde, sem participantes humanos, sem comitê de ética e sem chefe: **o perfil distingue estilos de jogo conhecidos?** (validade discriminante). Ela também serve como teste de regressão do pipeline inteiro (jogo → log → reconstrução → perfil) e deixa pronta a infraestrutura que a V1 (estabilidade) e a V2 (previsibilidade) vão reaproveitar.

Entrega principal: um **comando que roda o experimento e gera um relatório** (Markdown e CSV) que o autor possa usar como rascunho de resultados da tese.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- 7 agentes sintéticos com estilos fixos (§4.1), jogando o jogo **de verdade** (mesmo núcleo, mesmo log), de forma determinística e reproduzível.
- Hipóteses de separação **pré-registradas** (§4.4) e avaliadas com tamanho de efeito e intervalo por *bootstrap*.
- Estabilidade por dimensão (ICC) sobre valores **por sala sem herdar o passado**, rotulada como limite superior (agentes têm política estacionária).
- Verificações do pipeline (igualdade entre perfil ao vivo e reconstruído, nenhum evento malformado).
- Relatório gerado automaticamente a partir dos logs.

**Não-objetivos**
- Participantes humanos, previsor (5b), chefe (E4), V2 e V3.
- Agentes aprendidos (RL) ou que usem informação que um jogador não tem.
- Qualquer mudança de jogabilidade, balanceamento, log ou HUD; `GAME_VERSION` não muda.
- Dimensão 7 (uso de espaço, sem eixo Z).

**Anti-objetivos (falha mesmo que "funcione")**
- Ajustar agentes ou hipóteses depois de ver os resultados para "fazer tudo passar". Hipóteses são fixadas **antes** da primeira execução completa; qualquer mudança posterior entra no relatório como mudança.
- Agentes que trapaceiam (ler temporizadores internos do inimigo, o futuro, ou o perfil).
- Reimplementar as dimensões fora do núcleo: todo valor do relatório vem de `ProfileAccumulator` / replay, nunca de contas paralelas.
- Resultados que mudam entre execuções com a mesma configuração.

## 3. Restrições

- A lógica de jogo não muda. Código novo em `src/experiments/v0/` (módulos **puros**, sem Phaser, testados com Vitest) e uma casca de linha de comando em `tools/` que usa o Node para ler/escrever arquivos (os módulos puros não tocam `fs`). Execução: `npx vite-node tools/run-v0.ts [--agents … --runs … --seed …]` (o `vite-node` já vem com o Vitest; nenhuma dependência nova). O repositório não tem `@types/node`: a casca de `tools/` fica fora do `tsconfig` de `src` e usa `import` de `node:*` sem tipos extras, ou o agente de implementação usa uma declaração mínima (como no `src/visual/floor/testing/nodeShims.d.ts`).
- Os agentes dirigem o jogo pela **mesma superfície que o jogador humano** (`Encounter`/`PlayerController`: `setMoveInput`, `setAimDirection`, `switchWeapon`, `tryAction`, `releaseAction`, `tryDodge`, `startBlock`/`stopBlock`) e **percebem** só o que um jogador vê: posição e estado do inimigo (`idle`, `chasing`, `attacking`, `recovering`), distância, a própria vida e postura. A informação é entregue com **atraso de reação** (§4.2).
- Gerador de números aleatórios dos agentes **separado** do PRNG do jogo e do dos *bootstraps*; tudo semeado.
- Cada agente é um "jogador" com `playerId` próprio, um `ProfileAccumulator` próprio e um histórico contínuo: as runs de um agente são sequenciais e o perfil dele acumula, como para uma pessoa.

## 4. Decisões

### 4.1 Os sete estilos (aprovados pelo autor)

| Id | Estilo | Comportamento esperado |
|---|---|---|
| `agressivo` | ataca muito, de perto | persegue, ataca em cadência alta, quase não defende |
| `evasivo` | esquiva e mantém distância | prefere o arco, recua, esquiva os golpes |
| `bloqueador` | guarda e dá *parry* | segura E, aperta no golpe para *parry*, contra-ataca |
| `paciente` | espera a abertura e pune | ataca só depois do golpe do inimigo, em janela segura |
| `variado` | alterna armas e ações | troca de arma e usa todos os tipos de ação |
| `repetitivo` | uma arma, um golpe | espada e escudo, só ataque leve |
| `aleatorio` | controle | escolhe ações com probabilidade uniforme |

Cada estilo é uma **política parametrizada** (probabilidades e limiares por dimensão: cadência de ataque, preferência de arma, mistura de tipos de ação, preferência defensiva, distância-alvo, espera por janela segura), definida num único arquivo de parâmetros versionado. **[minha escolha]** valores iniciais calibrados numa varredura piloto (registrada no relatório), com o único critério "o estilo faz o que o nome diz e produz runs com dados suficientes".

### 4.2 Humanizador **[minha escolha]**

Camada comum a todos os agentes: (a) **atraso de reação** amostrado por evento (padrão: log-normal com média ≈ 250 ms e desvio ≈ 60 ms; as decisões usam o estado de `t − atraso`); (b) **lapso** (padrão 5%): com essa probabilidade a ação planejada não é executada; (c) **ruído de mira** pequeno. Sem isso os agentes seriam perfeitos e o ICC sairia trivialmente alto. Os parâmetros do humanizador são iguais para todos os estilos (o estilo muda o que fazem, não a "habilidade").

### 4.3 Experimento

7 agentes × 30 runs, em sessões de 10 runs (seeds fixas por agente e por run). Uma run termina por morte do agente; para não haver runs infinitas, **teto de 5 minutos de tempo simulado por run** **[minha escolha]**: ao atingir, a run é encerrada pelo caminho de run abandonada já existente (`cause: 'abandoned'`), como acontece com um jogador que fecha a aba. O relatório separa runs completas e truncadas. Estimativa de custo: ≈ 1,5 milhão de passos de 16,7 ms; deve rodar em minutos num Node comum (verificar e registrar).

### 4.4 Hipóteses pré-registradas **[palpite do Claude; o autor revisa antes da primeira execução completa]**

Unidade de comparação: o valor de cada dimensão calculado **só com as observações de cada run** (um `ProfileAccumulator` novo por run), para os agentes não herdarem o passado uns dos outros nem de si mesmos. Dimensão indefinida (`null`) entra como "indefinida" e é reportada.

| Id | Dimensão | Hipótese (direção esperada) |
|---|---|---|
| H1 | repertório de armas | `variado` > `agressivo` |
| H1u | repertório de armas | `repetitivo` indefinido em ≥ 95% das runs |
| H2 | repertório de ações | `variado` > `bloqueador` |
| H2u | repertório de ações | `repetitivo` indefinido em ≥ 95% das runs |
| H3 | aproveitamento de punição | `paciente` > `evasivo` |
| H4 | aproveitamento de punição | `bloqueador` > `evasivo` |
| H5 | repertório defensivo | `aleatorio` > `agressivo` (ou `agressivo` indefinido) |
| H6 | repertório defensivo | `aleatorio` > `evasivo` |
| H7 | distância operacional | `agressivo` > `evasivo` |
| H8 | distância operacional | `agressivo` > `paciente` |
| H9 | paciência | `paciente` > `agressivo` |
| H10 | paciência | `evasivo` > `agressivo` |
| H11 | paciência | `paciente` > `aleatorio` |
| H12 | repertório de ações | `aleatorio` > `repetitivo` (ou `repetitivo` indefinido) |

Critério de uma hipótese **[minha escolha]**: o intervalo *bootstrap* de 95% do **delta de Cliff** (comparação das runs dos dois agentes) exclui 0 na direção esperada **e** `|delta| ≥ 0,33` (efeito médio). Hipóteses do tipo "indefinido em ≥ 95% das runs" são contagens simples. Hipóteses que falham são **resultado**, não defeito a corrigir; podem apontar uma dimensão mal definida ou um agente mal calibrado, e o relatório diz qual é a leitura mais provável sem alterar o registro.

### 4.5 Estabilidade (ICC) com agentes

Para cada dimensão e agente: valores **por sala** sem herdar o passado (um acumulador novo por sala, alimentado só com as observações daquela sala, no mesmo evento de borda de sala do log). `ICC(1,1)` (modelo de um fator, agentes como grupos, salas como medidas), com intervalo por *bootstrap* de agrupamentos (reamostrar runs dentro do agente). Rotulado **"limite superior"** (política estacionária). Critério D1 do documento mestre (`< 0,50` ⇒ dimensão candidata a remoção) é só **mostrado**, não aplicado.

### 4.6 Relatório

Gerado por `tools/run-v0.ts` em `experiments/v0/out/<data>-<seed>/` (pasta ignorada pelo git; o comando imprime o caminho): `relatorio.md`, e CSVs (`runs.csv` com um valor por agente × run × dimensão, `rooms.csv`, `hipoteses.csv`, `icc.csv`, `perfil_final.csv`). Seções do `relatorio.md`:
1. **Configuração** (versão do jogo, seeds, parâmetros dos agentes e do humanizador, data, tempo de execução).
2. **Perfil final por agente** (domínio, confiança e déficit por dimensão; quantas runs; quantas truncadas).
3. **Separação de estilos**: tabela das hipóteses com delta de Cliff, IC 95%, veredito (confirmada, refutada, indefinida por dados insuficientes) e uma matriz de direção por dimensão × estilo.
4. **Estabilidade** (ICC por dimensão com IC; rótulo de limite superior; marcação `< 0,50`).
5. **Verificações do pipeline**: igualdade entre o perfil ao vivo de cada agente e o reconstruído do log (`toEqual`), zero eventos malformados no agregador de métricas (`malformed === 0`), contagens por tipo de evento, runs completas × truncadas.
6. **Limitações** (texto fixo: política estacionária, agentes com atraso de reação mas sem aprendizado, hipóteses e calibração são decisões do autor/Claude, dimensão 7 fora).

## 5. Testes e aceitação

- **Agentes:** determinismo (mesma seed ⇒ mesmo log, `toEqual`); cada estilo faz o que o nome diz num cenário curto (`repetitivo` só usa `sword_shield.light`; `variado` usa as 3 armas; `bloqueador` produz `block`/`parry`; `evasivo` mantém distância média maior que `agressivo`); o humanizador respeita média e dispersão do atraso em amostra grande; agentes **não leem** campos internos do inimigo (teste de dependência sobre os imports do módulo de política).
- **Valores por janela:** o valor por run/sala calculado pelo auxiliar offline coincide com o perfil de um acumulador novo alimentado manualmente com as mesmas observações; uma janela sem dado devolve `null`, nunca `NaN`.
- **Estatística:** delta de Cliff em arrays com valor conhecido; `ICC(1,1)` reproduz um exemplo de livro-texto; *bootstrap* semeado é determinístico e cobre o valor verdadeiro em um caso sintético.
- **Relatório:** em uma configuração mínima (2 agentes × 3 runs) o `relatorio.md` e os CSVs saem idênticos em duas execuções (*golden*); tabelas bem formadas.
- **Pipeline:** a execução completa 7 × 30 termina em tempo razoável, com `igualdade perfil vivo = reconstruído` e `malformed = 0` para todos os agentes; se falhar, o comando termina com erro e diz qual agente.
- **A suíte atual (540 testes) passa sem alteração.** Nenhum arquivo de `core`, `combat`, `opportunity`, `profile`, `ai`, `game` ou `telemetry` muda.
- Os **resultados** (hipóteses confirmadas ou não) não são critério de aceitação do código, e sim o conteúdo do relatório.

## 6. Deixado ao implementador

Estrutura de módulos em `src/experiments/v0/`; valores iniciais dos parâmetros de cada estilo (a calibração piloto é registrada); a forma de ler o estado do inimigo e a distância "como o jogador vê"; o formato exato dos CSVs; como encerrar uma run truncada pelo caminho de run abandonada; paralelismo (não é necessário).

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Agentes bons demais ou ruins demais (morrem em segundos ⇒ poucos dados) | Varredura piloto de calibração registrada; relatório mostra contagens e confiança |
| Agentes viram "o jogo conhecendo suas regras" (informação privilegiada) | Só percepção de jogador, com atraso; teste de imports da política |
| Hipóteses escolhidas depois dos dados | Registro neste documento, versionado; mudanças listadas no relatório |
| Dimensão com muitos `null` (um rótulo só) | Contagem de indefinidos por dimensão/estilo no relatório; hipóteses H1/H2 já tratam o caso |
| Resultado diferente a cada execução | Todas as fontes de aleatoriedade semeadas; teste *golden* |
| Confundir validade discriminante com validade do perfil em humanos | Seção de limitações fixa no relatório |

## 8. Decisões do autor ainda abertas (não bloqueiam a implementação)

1. Revisar as hipóteses H1 a H12 e o critério (`|delta| ≥ 0,33`, IC 95%) **antes da primeira execução completa**.
2. Confirmar a D-0 com o orientador e a definição de "eficaz" do chefe (V3).
3. Se quer que a casca de linha de comando também gere um gráfico (por exemplo, mapa de calor estilo × dimensão) além das tabelas; padrão: só tabelas e CSV.
