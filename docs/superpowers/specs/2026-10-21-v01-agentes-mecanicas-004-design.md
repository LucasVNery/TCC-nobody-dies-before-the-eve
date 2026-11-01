# V0.1: agentes sintéticos nas mecânicas 0.0.5 e nova execução — Design

**Data:** 2026-10-21, revisada em 2026-10-31 para as mecânicas `0.0.5` (combate v2).
**Status:** revisada com o autor em 2026-10-31 (decisões em §9); falta o aceite final antes do plano. Os valores numéricos e as hipóteses novas são palpites do Claude (**[minha escolha]**) e só viram "pré-registrados" depois da sua revisão e **antes** da primeira execução completa na 0.0.5.
**Contexto:** a V0 (`2026-10-19-v0-agentes-sinteticos-design.md`) rodou em 2026-10-21 na versão `0.0.3` (11 das 13 hipóteses confirmadas; H1 e H5 indefinidas). As mecânicas da `0.0.4` (`2026-10-21-mecanicas-v004-design.md`, em especial o §10) mudaram o jogo: estamina, corrida, esquiva com timing, arco com projétil, *lunge*, itens, regra das 8 ações na análise. O combate v2 (`0.0.5`, `2026-10-29-combate-v2-design.md`, em especial o §10) o mudou de novo: estamina máxima 150, esquiva de 220 ms com i-frames de 200 ms, uma elite de 160 de vida com golpe, combo (duas janelas), *lunge*, pancada em área e investida longa, *hit-stop* e *feedback* visual. A 0.0.4 nunca foi executada em escala. Os agentes ficaram só **compatíveis**: não correm, não usam itens, são cegos ao *lunge* e não distinguem combo de pancada. A V0.1 os torna agentes **da 0.0.5** e repete o experimento.

## 1. Intenção

Responder de novo, nas mecânicas finais, a pergunta da V0: **o perfil distingue estilos de jogo conhecidos?** E acrescentar o que a 0.0.4 tornou observável: **as métricas de estamina e de itens distinguem os estilos?** (validade das métricas novas, que alimentam o painel e, depois, o previsor). A execução de 2026-10-21 (0.0.3) fica arquivada como **piloto não comparável**; a V0.1 é a primeira execução oficial nos dados da versão que será congelada. A elite **não adapta** (pesos fixos; só o futuro chefe usa o perfil), então a V0.1 mede se o perfil distingue estilos, não adaptação.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- Agentes que jogam as mecânicas da 0.0.5 como um jogador jogaria: gerenciam estamina, correm ao se aproximar, esquivam/bloqueiam/aparam cada padrão da elite (golpe, combo, *lunge*, pancada em área, investida longa), coletam e usam itens, sempre com o mesmo humanizador (atraso de reação, lapsos, ruído) e sem informação privilegiada.
- Os mesmos sete estilos, com parâmetros novos para o que a 0.0.4 e a 0.0.5 acrescentaram (§4.1).
- As 13 hipóteses da V0 mantidas **sem alteração** (§4.3) e uma pequena **família M** de hipóteses sobre as métricas novas, pré-registrada antes da execução.
- Relatório da V0.1 com a mesma estrutura, mais as métricas de estamina e de itens por estilo e um apêndice comparativo com o piloto 0.0.3.
- Execução reproduzível (seed nova), `GAME_VERSION` inalterada em `0.0.5`.

**Não-objetivos**
- Mudar o jogo (mecânicas, balanceamento, log). Se a calibração mostrar que algo da 0.0.5 está desbalanceado, isso é **resultado** e vai ao autor; não se corrige aqui.
- Participantes humanos, previsor, chefe, V1 a V3.
- Sétima dimensão de perfil (aproveitamento de itens): só depois de ver estes dados.
- Agentes aprendidos ou que leiam estado interno do inimigo.

**Anti-objetivos (falha mesmo que "funcione")**
- Ajustar hipóteses ou agentes depois de ver os resultados da execução completa para "fazer passar". Calibração acontece **antes**, com o critério da V0 ("o estilo faz o que o nome diz e produz dados suficientes"), numa varredura piloto registrada.
- Tratar H1…H11, H1u, H2u como se fossem novas: elas já foram vistas na 0.0.3 (H1 e H5 indefinidas). O relatório declara isso; o registro não muda.
- Agentes que sacrificam a identidade do estilo para sobreviver mais.
- Resultados que mudam entre execuções com a mesma configuração.

## 3. Restrições

- Código novo ou alterado só em `src/experiments/v0/` (puro, sem Phaser), `tools/`, `experiments/v0/` e docs. Nenhum arquivo de `combat`, `game`, `telemetry`, `profile`, `opportunity`, `ai` ou `debug` muda. A suíte atual (994 testes) passa; testes só mudam onde o agente muda de propósito, listados.
- Superfície do agente = a do jogador: `setMoveInput`, `setAimDirection`, `switchWeapon`, `tryAction`, `releaseAction`, `tryDodge`, `startBlock`/`stopBlock`, e os novos `setSprint`, `useItem`. Percepção = o que a tela mostra: estado e posição do inimigo (inclusive `lunging`), o **tipo e o progresso da telegraph em curso** (`AssaltanteController.telegraph`: o mesmo que os indicadores no chão mostram ao jogador; o combo informa qual dos dois golpes), a própria vida e estamina, o item no slot e os itens no chão (posição e tipo). Sempre com o atraso de percepção já existente.
- PRNGs do agente separados do PRNG do jogo e do *bootstrap*. Seeds de teste: 4242; **nunca** a seed da execução oficial. A seed da execução oficial é nova: `20261105` **[minha escolha]**; a 20261019 (piloto) também fica fora dos testes.
- Os módulos puros continuam sem tocar `fs`; a casca em `tools/run-v0.ts` mantém as travas (`--full`, `--reviewed-before yes|no`, `--force`, `--smoke`).

## 4. Decisões

### 4.1 Comportamento novo dos agentes **[valores: minha escolha]**

Parâmetros novos em `AgentStyle` (um arquivo versionado, como hoje):

| Parâmetro | Significado |
|---|---|
| `sprintApproach` | probabilidade de correr ao se aproximar de uma distância maior que 200 u, com estamina > 75 (metade do máximo de 150) |
| `staminaReserve` | estamina mínima que o agente quer manter antes de iniciar um ataque que não seja o de abertura (0 a 60; o máximo é 150) |
| `itemSeeking` | probabilidade de ir buscar um item visível a menos de 250 u quando o inimigo não está atacando |
| `itemUse` | regra de uso por tipo: cura quando vida < limiar; bomba quando o inimigo está a ≤ 110 u; poder ao iniciar uma sequência de ataques (todos com o mesmo atraso de reação) |

Valores iniciais por estilo: `agressivo` corre sempre (1,0), reserva 0, busca item 0,3; `evasivo` corre 0,2, reserva 45, busca 0,9; `bloqueador` corre 0,5, reserva 30, busca 0,5; `paciente` corre 0,3, reserva 45, busca 0,7; `variado` corre 0,6, reserva 15, busca 0,6; `repetitivo` corre 0,5, reserva 0, busca 0,2; `aleatorio` corre 0,5, reserva 0, busca 0,5 e usa o item no slot ao acaso. A calibração piloto (§4.4) pode ajustar, com a justificativa registrada em `experiments/v0/calibration.md`.

**Defesa contra os padrões da elite.** O agente trata qualquer telegraph como ameaça: o plano de defesa (esquiva/bloqueio/*parry*/nada, pelos pesos do estilo) é sorteado ao ver o início da telegraph, na qual o tipo é visível. O aperto da esquiva é programado para cair no intervalo em que os i-frames (200 ms) cobrem o golpe: instante-alvo = golpe − 75 ms, mais o ruído do humanizador (mesmo para todos os estilos); o do *parry* usa a janela de 150 ms como já faz. Por padrão:
- *Golpe* (telegraph de 450 ms) e *lunge* curto (500 ms): a regra acima.
- *Combo*: uma defesa por golpe. O segundo golpe tem telegraph de 320 ms e é visto ao começar (o agente lê o `hit` da telegraph, não a heurística provisória da V0).
- *Pancada em área* (700 ms, raio 110): o plano é sorteado como nos demais, mas o círculo não tem direção, então a defesa não depende da mira; a regra do instante-alvo é a mesma.
- *Investida longa* (650 ms de telegraph, depois cerca de um segundo de avanço): o aperto da esquiva é por **distância** (≈ 90 u do corpo da elite, mais o ruído), não pelo início do avanço.
O agente nunca aperta uma ação que a estamina não cobre (Tarefa 9, mantida).

**Itens.** Item no slot: usa conforme `itemUse`. Item no chão: se `itemSeeking` sorteia ir, caminha até ele quando o inimigo não está em `attacking`/`lunging` e a vida está > 30% (para não morrer de coletar); desiste se o inimigo ataca. A lógica lê o `hp` pela própria barra (a regra atual de "subida de vida = run nova" em `readOwnBody` é trocada por um sinal explícito de reinício de run).

### 4.2 Estilos e identidade

Os sete estilos e seus nomes continuam. O critério de calibração é o da V0 (§4.1 da V0) mais: (a) nenhum `player.stamina_denied` em 600 s por estilo; (b) cada estilo completa ≥ 2 runs por sessão de teste; (c) nenhum estilo trunca mais de 25% das runs no teto de **10 min** (uma run são 3 salas de 2 encontros, ou seja, 6 elites; o teto de 5 min da V0 não cabe nelas) **[decisão do autor, 2026-10-31]**. O caso conhecido é o `evasivo` (24 completas e 36 truncadas na 0.0.4, sob os dados antigos; 37/23 na 0.0.3). Com a defesa dos padrões e a busca de itens ele deve deixar de empatar com o inimigo; se continuar truncando, é resultado e o relatório explica, sem alterar as regras do jogo.

### 4.3 Hipóteses

**Família P (perfil), inalterada.** H1 a H11, H1u, H2u exatamente como em `src/experiments/v0/hypotheses.ts` (teste que as fixa continua). Efeito da regra das 8 ações: dimensões de entropia ficam indefinidas em janelas com menos de 8 eventos brutos; o relatório mostra a fração de indefinidos por dimensão e estilo. H1 e H5 já têm a cláusula "ou o grupo baixo indefinido".

**Família M (métricas novas) [palpites; o autor revisa antes da execução].** Unidade: valor da métrica **por run**, calculado pelas mesmas funções do painel (`WindowAccumulator`) sobre os eventos da run. Critério igual ao da família P (IC 95% do delta de Cliff exclui 0 na direção esperada e `|delta| ≥ 0,33`).

| Id | Métrica | Hipótese |
|---|---|---|
| M1 | gasto de estamina por minuto | `agressivo` > `bloqueador` |
| M2 | fração do tempo com estamina ≥ 80% (120 de 150) | `bloqueador` > `agressivo` |
| M3 | participação da esquiva no gasto (`spentByKind.dodge` / total) | `evasivo` > `agressivo` |
| M4 | participação do bloqueio no gasto (`spentByKind.block` / total) | `bloqueador` > `evasivo` |
| M5 | taxa de coleta de itens (`pickRate`) | `evasivo` > `agressivo` |

As cinco são direções esperadas pelas regras de cada estilo; se alguma falhar é **resultado** (pode indicar métrica mal definida ou agente mal calibrado). Nenhuma delas entra no critério de aceitação do código.

### 4.4 Procedimento (ordem fixa)

1. Implementar os agentes (§4.1) e as estatísticas por run da família M.
2. **Calibração piloto** com seeds de teste, registrada em `experiments/v0/calibration.md` (nova seção "0.0.5"): varredura curta por estilo, ajustes só para cumprir §4.2.
3. O autor revisa a família M e os parâmetros finais **antes** da primeira execução completa; o `--reviewed-before yes|no` registra a resposta no relatório.
4. Execução completa 7 agentes × 60 runs, sessões de 10, teto de **10 min** por run, seed `20261105`.
5. Resultados arquivados em `experiments/v0/results/<data>/` e commitados (como a 0.0.3).

### 4.5 Relatório

Mesma estrutura da V0 (configuração, perfil final, separação de estilos, estabilidade, verificações do pipeline, limitações), mais:
- **Métricas de estamina e de itens por estilo** (média e dispersão por run) e a tabela da família M.
- **Apêndice comparativo com o piloto 0.0.3**: veredito de cada H1…H11/H1u/H2u nas duas versões lado a lado, rotulado como descritivo (versões não comparáveis).
- **Limitações:** a elite não adapta (peso fixo); política estacionária; humanizador igual para todos; *perfect dodge* depende do ruído do humanizador, não de habilidade; hipóteses da família P já vistas na 0.0.3; família M é palpite do Claude revisado pelo autor; dimensão de itens fora.

## 5. Testes e aceitação

- **Agentes:** determinismo (seed 4242, mesmo log); nenhum `player.stamina_denied` em 600 s por estilo; `sprintApproach` 1,0 faz o agente correr ao se aproximar (velocidade média acima de 175 u/s na aproximação) e 0 nunca corre; o agente esquiva um golpe, um *lunge*, cada golpe do combo, uma pancada em área e uma investida longa de forma que a esquiva proteja em ≥ 60% das tentativas num cenário curto controlado, e o aperto cai no intervalo de i-frames; busca e usa itens segundo `itemSeeking`/`itemUse` (cura abaixo do limiar, bomba a ≤ 110 u, desiste se o inimigo ataca); o agente não lê campos internos do inimigo (teste de imports da política, já existente); o reinício de run é detectado sem depender da vida.
- **Família M:** valores por run de uma sequência sintética de eventos coincidem com o `WindowAccumulator` alimentado à mão; uma run sem amostra devolve `null`, nunca `NaN`.
- **Hipóteses:** o teste que fixa H1…H11/H1u/H2u continua; um teste fixa M1 a M5 depois da revisão do autor.
- **Relatório:** golden de configuração mínima (2 agentes × 3 runs) idêntico em duas execuções, inclusive as seções novas; apêndice comparativo bem formado quando o arquivo do piloto existe e omitido com aviso quando não existe.
- **Pipeline:** execução completa termina com perfil vivo = reconstruído e `malformed = 0` para todos os agentes; senão o comando falha dizendo qual.
- **Não regressão:** a suíte existente passa; mudanças de teste listadas.
- Os **resultados** (hipóteses confirmadas ou não) não são critério de aceitação do código.

## 6. Ordem de construção

Um branch (`v01-agentes`), uma tarefa por bloco, na ordem: (1) percepção e controles novos no agente (corrida, uso de item, itens visíveis, sinal de reinício, tipo e progresso da telegraph); (2) defesa de cada padrão da elite (golpe, combo, *lunge*, pancada, investida longa) e instante-alvo da esquiva; (3) busca e uso de itens + parâmetros por estilo; (4) estatísticas por run da família M e o relatório (seções novas, apêndice); (5) hipóteses M1 a M5 fixadas (depois da revisão do autor) e `--reviewed-before`; (6) calibração piloto e `calibration.md`; (7) execução completa e arquivamento dos resultados (só com a ordem do autor).

## 7. Deixado ao implementador

Estrutura dos módulos novos em `src/experiments/v0/`, como o agente detecta o reinício de run, a heurística exata de caminhada até o item, o formato dos CSVs novos, e a forma de apresentar o apêndice comparativo.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Agentes bons demais ou ruins demais com estamina e os padrões da elite | calibração piloto registrada; relatório mostra contagens e confiança |
| `evasivo` continua truncando | critério §4.2(c); é resultado, não se mexe no jogo |
| Regra das 8 ações deixa dimensões quase sempre indefinidas | fração de indefinidos no relatório; H1 e H5 já tratam o caso |
| Família M escolhida depois dos dados | registro versionado antes da execução; `--reviewed-before` no relatório |
| Agentes viram "o jogo conhecendo suas regras" | só percepção de jogador, com atraso; teste de imports |
| Comparar 0.0.3 e 0.0.5 como se fossem a mesma coisa | apêndice rotulado descritivo; versões declaradas |

## 9. Decisões do autor

**Tomadas em 2026-10-31 (revisão desta spec):**
1. **Teto de 10 min por run** (era 5), mantido o limite de 25% de truncamento por estilo.
2. **O agente percebe o tipo e o progresso da telegraph** (o que os indicadores no chão mostram), sem ler estado interno.
3. **`aleatorio` é o controle:** usa o item do slot ao acaso.
4. **Família M = M1 a M5**, sem M6. A razão reação/telegraph por tipo de ataque aparece no relatório de forma descritiva.
5. Parâmetros iniciais dos estilos (§4.1, com a estamina reescalada para 150) e seed oficial `20261105` aceitos como propostos; a calibração piloto pode ajustar os parâmetros com justificativa.

**Ainda abertas:**
1. Aceite final desta spec revisada, antes do plano.
2. **Antes** da primeira execução completa: revisar os parâmetros finais depois da calibração piloto e a família M (`--reviewed-before`).
3. Depois da execução: decidir se a oportunidade `item` vira a sétima dimensão do perfil (precisa destes dados).
