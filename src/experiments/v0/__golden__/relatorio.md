# Relatório do experimento V0 (agentes sintéticos)

## 1. Configuração

- Versão do jogo: v-test
- Seed do experimento: 20261019 (todas as seeds de jogo, política e humanizador derivam dela, por agente e por run)
- Humanizador: reação 250 ms (desvio 60 ms), probabilidade de lapso 0,05, ruído de mira 0,05 rad
- Passo da simulação: 16,667 ms
- Teto de tempo simulado por run: 300000 ms
- Runs por agente: 2; runs por sessão: 1
- Gerado em: 2026-10-19T12:00:00.000Z
- Tempo decorrido: 4,3 s
- Hipóteses H1–H12 e H1u, H2u (14 itens) pré-registradas; revisadas pelo autor ANTES da execução completa: sim
- A revisão das hipóteses pelo autor aconteceu DEPOIS do piloto de calibração dos agentes.
- Alterações nas hipóteses depois da primeira execução completa: nenhuma registrada

Parâmetros dos estilos (pesos relativos; distâncias em px):

| Agente | Armas | Trocas/min | Ações | Cooldown (ms) | Distância ± tolerância | Defesa | Espera abertura |
| --- | --- | --- | --- | --- | --- | --- | --- |
| agressivo | sword_shield 0,8; heavy_weapon 0,2 | 0,5 | sword_shield.light 4; sword_shield.heavy 2; sword_shield.charged 1; heavy_weapon.light 3; heavy_weapon.heavy 1; heavy_weapon.charged 1 | 300 | 25 ± 10 | esquiva 0,1; bloqueio 0,05; parry 0; nada 0,85 | não |
| evasivo | bow 0,65; sword_shield 0,35 | 2 | bow.shot 1; sword_shield.light 2; sword_shield.heavy 1 | 700 | 170 ± 30 | esquiva 0,85; bloqueio 0,05; parry 0; nada 0,1 | não |

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

Linhas H1u e H2u (taxa de indefinição): as colunas Estilo, Indef. estilo e N runs substituem Maior/Menor, delta e IC. H5 e H12 também são confirmadas se o grupo menor tiver pelo menos 10 runs e for indefinido em pelo menos 95% delas (isto substitui só o teste do delta: o grupo maior ainda precisa de pelo menos 10 valores definidos); H6 NÃO tem a cláusula "ou indefinido".

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
- As 14 hipóteses são testadas sem correção para comparações múltiplas (V0 exploratório; com Bonferroni o alfa seria 0,05/14).
