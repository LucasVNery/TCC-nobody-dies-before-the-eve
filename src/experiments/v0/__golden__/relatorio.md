# Relatório do experimento V0 (agentes sintéticos)

## 1. Configuração

- Versão do jogo: v-test
- Seed do experimento: 4242 (todas as seeds de jogo, política e humanizador derivam dela, por agente e por run)
- Humanizador: reação 250 ms (desvio 60 ms), probabilidade de lapso 0,05, ruído de mira 0,05 rad
- Passo da simulação: 16,667 ms
- Teto de tempo simulado por run: 300000 ms
- Runs por agente: 2; runs por sessão: 1
- Gerado em: 2026-10-19T12:00:00.000Z
- Tempo decorrido: 4321 ms
- Hipóteses da família P (H1–H11 e H1u, H2u; 13 itens) pré-registradas na 0.0.3; revisadas pelo autor ANTES da execução completa: sim
- Versão final do pré-registro da família P (revisão do autor em 2026-10-20, depois do piloto da 0.0.3 e antes da execução completa dela): H1 recebeu a cláusula "ou indefinido"; H12 foi retirada por redundância com H2u.
- Hipóteses da família M (M1–M5; 5 itens) e parâmetros finais dos estilos (tabela abaixo) revisados pelo autor ANTES da execução completa da V0.1: sim (opção `--reviewed-before`, spec §4.4.3)
- Divulgação: a revisão da família M e dos parâmetros veio DEPOIS de um piloto de calibração da V0.1 (seeds 4242–4244; a seed 20261105 não foi usada), no qual foram vistas as medianas descritivas por estilo e a definição (indefinido ou não) das métricas M; nenhum delta, intervalo ou veredito foi calculado. Ver `experiments/v0/calibration.md`.
- Alterações nas hipóteses depois da primeira execução completa: nenhuma registrada

Parâmetros dos estilos (pesos relativos; distâncias em px):

| Agente | Armas | Trocas/min | Ações | Cooldown (ms) | Distância ± tolerância | Defesa | Espera abertura | sprintApproach | staminaReserve | itemSeeking | Uso de item |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agressivo | sword_shield 0,8; heavy_weapon 0,2 | 0,5 | sword_shield.light 4; sword_shield.heavy 2; sword_shield.charged 1; heavy_weapon.light 3; heavy_weapon.heavy 1; heavy_weapon.charged 1 | 300 | 25 ± 10 | esquiva 0,1; bloqueio 0,05; parry 0; nada 0,85 | não | 1 | 0 | 0,3 | cura abaixo de 0,5 da vida; bomba a 110 px; poder ao iniciar ataque: sim |
| evasivo | bow 0,65; sword_shield 0,35 | 2 | bow.shot 1; sword_shield.light 2; sword_shield.heavy 1 | 700 | 170 ± 30 | esquiva 0,85; bloqueio 0,05; parry 0; nada 0,1 | não | 0,2 | 45 | 0,9 | cura abaixo de 0,5 da vida; bomba a 110 px; poder ao iniciar ataque: sim |

`sprintApproach` é a chance sorteada a cada trecho de aproximação (não a cada aproximação inteira); como os trechos se interrompem com frequência, a chance efetiva por aproximação inteira é maior que o parâmetro.

Duração da telegraph por tipo de ataque (lida das definições de combate, em ms):

| Tipo no log | Telegraph (ms) | Observação |
| --- | --- | --- |
| swing | 450 | golpe |
| combo | 450 (golpe 1); 320 (golpe 2) | o tipo `combo` do log mistura os golpes 1 e 2 |
| lunge | 500 (curto); 650 (investida longa) + avanço | o tipo `lunge` do log mistura o lunge curto e a investida longa |
| slam | 700 | pancada |

Como `combo` e `lunge` misturam duas durações de telegraph, a razão reação/telegraph por tipo (spec §9.4) não é exatamente derivável para esses dois tipos; para `swing` e `slam` ela é a reação média da seção 9 dividida pela telegraph da tabela.

## 2. Perfil final por agente

Runs vazias (iniciadas pelo diretor depois de uma morte que encerra a sessão, sem evidência) são DESCARTADAS de todas as tabelas e só contadas aqui. Identidade: run.start = completas + truncadas + vazias.

| Agente | Run.start (soma) | Completas | Truncadas | Vazias (descartadas) | Sessões | Tempo simulado (s) |
| --- | --- | --- | --- | --- | --- | --- |
| agressivo | 2 | 2 | 0 | 0 | 2 | 12,5 |
| evasivo | 2 | 2 | 0 | 0 | 2 | 12,5 |

Perfil final (acumulador ao vivo, relógio de traço; déficit = 1 − domínio). Linhas com amostra 0 estão "a priori (sem dados)": o domínio e o déficit são o prior da Beta (ou indefinidos) e aparecem como —, sem leitura como desempenho; a confiança é 0. — também marca o indefinido.

| Agente | Dimensão | Amostra | Domínio | Confiança | Déficit | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| agressivo | weapon_repertoire | 0,000 | — | 0,000 | — | a priori (sem dados) |
| agressivo | action_repertoire | 0,000 | — | 0,000 | — | a priori (sem dados) |
| agressivo | punish | 4,000 | 0,667 | 0,286 | 0,333 |  |
| agressivo | defensive_repertoire | 0,000 | — | 0,000 | — | a priori (sem dados) |
| agressivo | distance | 0,000 | — | 0,000 | — | a priori (sem dados) |
| agressivo | patience | 0,000 | — | 0,000 | — | a priori (sem dados) |
| evasivo | weapon_repertoire | 0,000 | — | 0,000 | — | a priori (sem dados) |
| evasivo | action_repertoire | 0,000 | — | 0,000 | — | a priori (sem dados) |
| evasivo | punish | 4,000 | 0,667 | 0,286 | 0,333 |  |
| evasivo | defensive_repertoire | 0,000 | — | 0,000 | — | a priori (sem dados) |
| evasivo | distance | 0,000 | — | 0,000 | — | a priori (sem dados) |
| evasivo | patience | 0,000 | — | 0,000 | — | a priori (sem dados) |

## 3. Separação de estilos

Veredito: confirmada (IC 95% bootstrap do delta de Cliff acima de 0 e delta ≥ 0,33, ou a taxa de indefinição pedida); refutada; indefinida (dados insuficientes: menos de 10 valores definidos por grupo, ou menos de 10 runs nas hipóteses de taxa de indefinição). Hipótese refutada ou indefinida é resultado, não defeito. N definidos = valores por run com domínio definido em cada grupo; Indef. = fração das runs do grupo com domínio indefinido.

Linhas H1u e H2u (taxa de indefinição): as colunas Estilo, Indef. estilo e N runs substituem Maior/Menor, delta e IC. H1 e H5 também são confirmadas se o grupo menor tiver pelo menos 10 runs e for indefinido em pelo menos 95% delas (isto substitui só o teste do delta: o grupo maior ainda precisa de pelo menos 10 valores definidos); H6 NÃO tem a cláusula "ou indefinido".

| Id | Dimensão | Maior | Menor | Estilo | Delta | IC 95% | N definidos (maior) | N definidos (menor) | Indef. maior | Indef. menor | Indef. estilo | N runs estilo | Veredito |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H3 | punish | paciente | evasivo | — | 0,500 | [0,250; 0,750] | 12 | 11 | — | 10% | — | — | confirmada |
| H1u | weapon_repertoire | — | — | repetitivo | — | — | — | — | — | — | 100% | 4 | indefinida |

Matriz estilo × dimensão: mediana dos valores definidos por run (entre parênteses, fração de runs indefinidas).

| Estilo | weapon_repertoire | action_repertoire | punish | defensive_repertoire | distance | patience |
| --- | --- | --- | --- | --- | --- | --- |
| agressivo | — | — | 0,250 (50%) | — | — | — |
| evasivo | — | — | 0,625 (0%) | — | — | — |

## 4. Estabilidade (limite superior)

ICC(1,1) por dimensão, com os agentes como grupos e os valores por sala como medidas. É um limite superior: as políticas são estacionárias.

IC condicional aos agentes: reamostra runs, não agentes; não é IC de população.

O sinalizador "< 0,50" é apenas mostrado, NÃO aplicado (nenhuma conclusão foi condicionada a ele).

| Dimensão | ICC | IC 95% | N agentes | N medidas por sala | < 0,50 (não aplicado) |
| --- | --- | --- | --- | --- | --- |
| punish | 0,400 | [0,100; 0,700] | 2 | 3 | sim |
| patience | — | — | 0 | 0 | — |

## 5. Verificações do pipeline

| Agente | Verificação | Resultado | Detalhe |
| --- | --- | --- | --- |
| agressivo | seq-contiguous | ok | 2 sessions |
| evasivo | run-accounting | ok | a \| b |

Contagens por tipo de evento (todos os eventos do log de cada agente, em ordem alfabética do tipo):

| Agente | Tipo de evento | Contagem |
| --- | --- | --- |
| agent-0 | obs.action | 3 |
| agent-0 | run.end | 1 |
| agent-0 | run.start | 2 |
| agent-0 | **total** | 6 |
| agent-1 | **total** | 0 |

## 6. Limitações

- Política estacionária: cada agente joga sempre do mesmo jeito; a estabilidade medida é um limite superior.
- Os agentes têm atraso de reação, mas não aprendem nem se adaptam ao jogo.
- As hipóteses e a calibração são decisões do autor e do Claude; a calibração piloto usou só comportamento cru, com seeds diferentes da do experimento.
- A dimensão 7 está fora do experimento.
- Validade discriminante entre agentes sintéticos não é validade em humanos.
- Agentes com ataque carregado em curso defendem até cerca de 180 ms depois do planejado (afeta sobretudo agressivo e aleatório).
- Alguns critérios de calibração acompanham as dimensões que precedem (teto de 35% para o variado, regra de menos de 10% do paciente, distância do evasivo).
- A distância média e a cadência são afetadas pela caminhada até cada novo inimigo (spawn a pelo menos 300 px).
- A paciência pode separar mal paciente, bloqueador e evasivo.
- A razão da janela de esquiva (`taken`) também premia parries.
- Dados por sala desiguais entre agentes (o evasivo tem cerca de 10 vezes os dos outros); para os demais, por sala ≈ por run.
- Runs vazias são descartadas (contadas só na seção 2).
- Viés de seleção em defensive_repertoire (H5, H6): só entram runs com pelo menos 2 rótulos de defesa; o agressivo defende pouco, então o grupo medido pode não representar todas as suas runs.
- As 18 hipóteses (13 da família P e 5 da família M) são testadas sem correção para comparações múltiplas (exploratório; com Bonferroni o alfa seria 0,05/18).
- A família M é palpite do Claude revisado pelo autor.
- `sprintApproach` é a chance por trecho de aproximação e os trechos se interrompem com frequência: a chance efetiva por aproximação inteira excede o parâmetro.
- A elite não adapta (peso fixo).
- Humanizador igual para todos os estilos: o mesmo atraso de reação, os mesmos lapsos e o mesmo ruído de mira.
- O *perfect dodge* depende do ruído do humanizador, não de habilidade.
- As hipóteses da família P (H1…H11, H1u, H2u; 13 itens) já foram vistas na 0.0.3; a V0.1 não as trata como novas (o registro não muda).
- A dimensão de itens (aproveitamento de itens, candidata à sétima dimensão) fica fora do perfil; só depois destes dados.

## 7. Métricas de estamina e de itens por estilo

Valores por run calculados com o mesmo acumulador do painel de análise (`WindowAccumulator`), sobre os eventos de cada run (runs vazias descartadas). Média e desvio-padrão amostral dos valores definidos; — marca o indefinido (sem amostra, ou total de gasto 0 nas participações).

- `staminaSpentPerMinute`: gasto de estamina por minuto
- `staminaHighFraction`: fração do tempo com estamina ≥ 80% (120 de 150)
- `dodgeSpendShare`: participação da esquiva no gasto de estamina (dodge / total)
- `blockSpendShare`: participação do bloqueio no gasto de estamina (block / total)
- `itemPickRate`: taxa de coleta de itens (coletados / (coletados + expirados por tempo))

| Estilo | Métrica | N runs | N definidos | Média | Desvio |
| --- | --- | --- | --- | --- | --- |
| agressivo | staminaSpentPerMinute | 3 | 3 | 120,000 | 30,000 |
| agressivo | staminaHighFraction | 3 | 3 | 0,292 | 0,191 |
| agressivo | dodgeSpendShare | 3 | 3 | 0,100 | 0,100 |
| agressivo | blockSpendShare | 3 | 3 | 0,033 | 0,058 |
| agressivo | itemPickRate | 3 | 2 | 0,750 | 0,354 |
| evasivo | staminaSpentPerMinute | 3 | 2 | 52,750 | 10,253 |
| evasivo | staminaHighFraction | 3 | 2 | 0,688 | 0,088 |
| evasivo | dodgeSpendShare | 3 | 2 | 0,850 | 0,071 |
| evasivo | blockSpendShare | 3 | 2 | 0,025 | 0,035 |
| evasivo | itemPickRate | 3 | 2 | 0,750 | 0,354 |

## 8. Família M (métricas novas)

Unidade: valor da métrica por run (seção 7). Critério igual ao da família P: confirmada se o IC 95% bootstrap do delta de Cliff (maior vs menor) fica acima de 0 e delta ≥ 0,33; indefinida com menos de 10 valores definidos em algum grupo (valor indefinido = métrica sem amostra na run); refutada nos demais casos. A família M é palpite do Claude revisado pelo autor; hipótese refutada ou indefinida é resultado, não defeito.

Limitação de M5 (decisão do autor, 2026-11-01): M5 foi mantida como pré-registrada e deve sair indefinida. O itemPickRate depende do tempo de sobrevivência e da geometria de aparecimento dos itens; um jogador que joga como o agressivo morre antes do primeiro item e não gera valor algum. A métrica, portanto, não é interpretável como medida de busca de itens; isto é um achado sobre a métrica, não sobre o agente testado. Uma métrica válida para essa característica fica para uma versão futura.

| Id | Métrica | Maior | Menor | Delta | IC 95% | N definidos (maior) | N definidos (menor) | Indef. maior | Indef. menor | Veredito |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | staminaSpentPerMinute | agressivo | bloqueador | 0,750 | [0,500; 1,000] | 12 | 11 | 0% | 25% | confirmada |
| M5 | itemPickRate | evasivo | agressivo | — | — | 0 | 2 | 100% | 33% | indefinida |

## 9. Reação por tipo de ataque (descritiva)

Tempo do início do ataque do inimigo até a primeira esquiva dentro da janela de esquiva (`reaction.byKind` do painel), por tipo de ataque como registrado no log, somado sobre as runs e ponderado pelo número de reações. Descritiva, sem hipótese: as telegraphs têm durações diferentes (tabela da seção 1), então só se compara dentro de um mesmo tipo; `combo` e `lunge` do log misturam duas durações cada (ver seção 1).

| Estilo | Tipo de ataque | N reações | Média (ms) |
| --- | --- | --- | --- |
| agressivo | lunge | 1 | 400,0 |
| agressivo | swing | 3 | 270,0 |
| evasivo | charge | 1 | 610,0 |
| evasivo | slam | 4 | 480,0 |

## Apêndice A. Comparação com o piloto 0.0.3 (descritiva)

Aviso: piloto 0.0.3 não encontrado; a comparação foi omitida.
