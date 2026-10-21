# Relatório do experimento V0 (agentes sintéticos)

## 1. Configuração

- Versão do jogo: 0.0.3+viewB
- Seed do experimento: 20261019 (todas as seeds de jogo, política e humanizador derivam dela, por agente e por run)
- Humanizador: reação 250 ms (desvio 60 ms), probabilidade de lapso 0,05, ruído de mira 0,05 rad
- Passo da simulação: 16,667 ms
- Teto de tempo simulado por run: 300000 ms
- Runs por agente: 60; runs por sessão: 10
- Gerado em: 2026-10-21T09:30:20.217Z
- Tempo decorrido: 2322 ms
- Hipóteses H1–H11 e H1u, H2u (13 itens) pré-registradas; revisadas pelo autor ANTES da execução completa: sim
- Versão final do pré-registro (revisão do autor em 2026-10-20, depois do piloto e antes da execução completa): H1 recebeu a cláusula "ou indefinido"; H12 foi retirada por redundância com H2u.
- A revisão das hipóteses pelo autor aconteceu DEPOIS do piloto de calibração dos agentes.
- Alterações nas hipóteses depois da primeira execução completa: nenhuma registrada

Parâmetros dos estilos (pesos relativos; distâncias em px):

| Agente | Armas | Trocas/min | Ações | Cooldown (ms) | Distância ± tolerância | Defesa | Espera abertura |
| --- | --- | --- | --- | --- | --- | --- | --- |
| agressivo | sword_shield 0,8; heavy_weapon 0,2 | 0,5 | sword_shield.light 4; sword_shield.heavy 2; sword_shield.charged 1; heavy_weapon.light 3; heavy_weapon.heavy 1; heavy_weapon.charged 1 | 300 | 25 ± 10 | esquiva 0,1; bloqueio 0,05; parry 0; nada 0,85 | não |
| evasivo | bow 0,65; sword_shield 0,35 | 2 | bow.shot 1; sword_shield.light 2; sword_shield.heavy 1 | 700 | 170 ± 30 | esquiva 0,85; bloqueio 0,05; parry 0; nada 0,1 | não |
| bloqueador | sword_shield 1 | 0 | sword_shield.light 3; sword_shield.heavy 1 | 650 | 40 ± 15 | esquiva 0,05; bloqueio 0,55; parry 0,35; nada 0,05 | sim |
| paciente | sword_shield 0,6; bow 0,4 | 1 | sword_shield.light 3; sword_shield.heavy 1; bow.shot 1 | 600 | 55 ± 15 | esquiva 0,5; bloqueio 0,3; parry 0,1; nada 0,1 | sim |
| variado | sword_shield 1; heavy_weapon 1,2; bow 0,35 | 15 | sword_shield.light 1; sword_shield.heavy 1; sword_shield.charged 1; heavy_weapon.light 1; heavy_weapon.heavy 1; heavy_weapon.charged 1; bow.shot 1 | 600 | 50 ± 20 | esquiva 0,35; bloqueio 0,3; parry 0,25; nada 0,1 | não |
| repetitivo | sword_shield 1 | 0 | sword_shield.light 1 | 550 | 35 ± 10 | esquiva 0,35; bloqueio 0,35; parry 0; nada 0,3 | não |
| aleatorio | sword_shield 3; heavy_weapon 3; bow 1 | 6000 | sword_shield.light 1; sword_shield.heavy 1; sword_shield.charged 1; heavy_weapon.light 1; heavy_weapon.heavy 1; heavy_weapon.charged 1; bow.shot 1 | 600 | 60 ± 30 | esquiva 0,25; bloqueio 0,25; parry 0,25; nada 0,25 | não |

## 2. Perfil final por agente

Runs vazias (iniciadas pelo diretor depois de uma morte que encerra a sessão, sem evidência) são DESCARTADAS de todas as tabelas e só contadas aqui. Identidade: run.start = completas + truncadas + vazias.

| Agente | Run.start (soma) | Completas | Truncadas | Vazias (descartadas) | Sessões | Tempo simulado (s) |
| --- | --- | --- | --- | --- | --- | --- |
| agressivo | 66 | 60 | 0 | 6 | 6 | 732,7 |
| evasivo | 60 | 37 | 23 | 0 | 23 | 12840,6 |
| bloqueador | 66 | 60 | 0 | 6 | 6 | 1422,7 |
| paciente | 66 | 60 | 0 | 6 | 6 | 1936,5 |
| variado | 66 | 60 | 0 | 6 | 6 | 1081,3 |
| repetitivo | 66 | 60 | 0 | 6 | 6 | 1445,6 |
| aleatorio | 66 | 60 | 0 | 6 | 6 | 881,3 |

Perfil final (acumulador ao vivo, relógio de traço; déficit = 1 − domínio). Linhas com amostra 0 estão "a priori (sem dados)": o domínio e o déficit são o prior da Beta (ou indefinidos) e aparecem como —, sem leitura como desempenho; a confiança é 0. — também marca o indefinido.

| Agente | Dimensão | Amostra | Domínio | Confiança | Déficit | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| agressivo | weapon_repertoire | 87,882 | 0,075 | 0,779 | 0,925 |  |
| agressivo | action_repertoire | 87,882 | 0,521 | 0,779 | 0,479 |  |
| agressivo | punish | 28,773 | 0,824 | 0,742 | 0,176 |  |
| agressivo | defensive_repertoire | 4,091 | 0,233 | 0,141 | 0,767 |  |
| agressivo | distance | 80,190 | 0,323 | 0,889 | 0,677 |  |
| agressivo | patience | 87,882 | 0,700 | 0,898 | 0,300 |  |
| evasivo | weapon_repertoire | 127,516 | 0,544 | 0,836 | 0,456 |  |
| evasivo | action_repertoire | 127,516 | 0,477 | 0,836 | 0,523 |  |
| evasivo | punish | 4,941 | 0,856 | 0,331 | 0,144 |  |
| evasivo | defensive_repertoire | 21,836 | 0,180 | 0,466 | 0,820 |  |
| evasivo | distance | 137,470 | 0,007 | 0,932 | 0,993 |  |
| evasivo | patience | 127,516 | 0,992 | 0,927 | 0,008 |  |
| bloqueador | weapon_repertoire | 65,370 | — | 0,723 | — |  |
| bloqueador | action_repertoire | 65,370 | 0,376 | 0,723 | 0,624 |  |
| bloqueador | punish | 54,023 | 0,982 | 0,844 | 0,018 |  |
| bloqueador | defensive_repertoire | 44,327 | 0,516 | 0,639 | 0,484 |  |
| bloqueador | distance | 101,190 | 0,010 | 0,910 | 0,990 |  |
| bloqueador | patience | 65,370 | 0,985 | 0,867 | 0,015 |  |
| paciente | weapon_repertoire | 98,601 | 0,503 | 0,798 | 0,497 |  |
| paciente | action_repertoire | 98,601 | 0,435 | 0,798 | 0,565 |  |
| paciente | punish | 70,621 | 0,986 | 0,876 | 0,014 |  |
| paciente | defensive_repertoire | 72,307 | 0,648 | 0,743 | 0,352 |  |
| paciente | distance | 140,551 | 0,008 | 0,934 | 0,992 |  |
| paciente | patience | 98,601 | 0,990 | 0,908 | 0,010 |  |
| variado | weapon_repertoire | 57,750 | 0,993 | 0,698 | 0,007 |  |
| variado | action_repertoire | 57,750 | 0,846 | 0,698 | 0,154 |  |
| variado | punish | 23,394 | 0,961 | 0,701 | 0,039 |  |
| variado | defensive_repertoire | 24,090 | 0,753 | 0,491 | 0,247 |  |
| variado | distance | 80,811 | 0,013 | 0,890 | 0,987 |  |
| variado | patience | 57,750 | 0,820 | 0,852 | 0,180 |  |
| repetitivo | weapon_repertoire | 92,836 | — | 0,788 | — |  |
| repetitivo | action_repertoire | 92,836 | — | 0,788 | — |  |
| repetitivo | punish | 50,046 | 0,939 | 0,833 | 0,061 |  |
| repetitivo | defensive_repertoire | 50,296 | 0,688 | 0,668 | 0,312 |  |
| repetitivo | distance | 108,096 | 0,387 | 0,915 | 0,613 |  |
| repetitivo | patience | 92,836 | 0,954 | 0,903 | 0,046 |  |
| aleatorio | weapon_repertoire | 59,403 | 0,947 | 0,704 | 0,053 |  |
| aleatorio | action_repertoire | 59,403 | 0,834 | 0,704 | 0,166 |  |
| aleatorio | punish | 17,255 | 0,948 | 0,633 | 0,052 |  |
| aleatorio | defensive_repertoire | 17,640 | 0,560 | 0,414 | 0,440 |  |
| aleatorio | distance | 99,780 | 0,015 | 0,909 | 0,985 |  |
| aleatorio | patience | 59,403 | 0,814 | 0,856 | 0,186 |  |

## 3. Separação de estilos

Veredito: confirmada (IC 95% bootstrap do delta de Cliff acima de 0 e delta ≥ 0,33, ou a taxa de indefinição pedida); refutada; indefinida (dados insuficientes: menos de 10 valores definidos por grupo, ou menos de 10 runs nas hipóteses de taxa de indefinição). Hipótese refutada ou indefinida é resultado, não defeito. N definidos = valores por run com domínio definido em cada grupo; Indef. = fração das runs do grupo com domínio indefinido.

Linhas H1u e H2u (taxa de indefinição): as colunas Estilo, Indef. estilo e N runs substituem Maior/Menor, delta e IC. H1 e H5 também são confirmadas se o grupo menor tiver pelo menos 10 runs e for indefinido em pelo menos 95% delas (isto substitui só o teste do delta: o grupo maior ainda precisa de pelo menos 10 valores definidos); H6 NÃO tem a cláusula "ou indefinido".

| Id | Dimensão | Maior | Menor | Estilo | Delta | IC 95% | N definidos (maior) | N definidos (menor) | Indef. maior | Indef. menor | Indef. estilo | N runs estilo | Veredito |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H1 | weapon_repertoire | variado | agressivo | — | 0,287 | [-0,067; 0,640] | 50 | 6 | 17% | 90% | — | — | indefinida |
| H1u | weapon_repertoire | — | — | repetitivo | — | — | — | — | — | — | 100% | 60 | confirmada |
| H2 | action_repertoire | variado | bloqueador | — | 0,983 | [0,939; 1,000] | 59 | 60 | 2% | 0% | — | — | confirmada |
| H2u | action_repertoire | — | — | repetitivo | — | — | — | — | — | — | 100% | 60 | confirmada |
| H3 | punish | paciente | evasivo | — | 0,974 | [0,920; 1,000] | 60 | 59 | 0% | 2% | — | — | confirmada |
| H4 | punish | bloqueador | evasivo | — | 0,966 | [0,910; 0,997] | 60 | 59 | 0% | 2% | — | — | confirmada |
| H5 | defensive_repertoire | aleatorio | agressivo | — | -0,088 | [-0,382; 0,206] | 34 | 6 | 43% | 90% | — | — | indefinida |
| H6 | defensive_repertoire | aleatorio | evasivo | — | 0,933 | [0,844; 0,999] | 34 | 53 | 43% | 12% | — | — | confirmada |
| H7 | distance | agressivo | evasivo | — | 1,000 | [1,000; 1,000] | 60 | 60 | 0% | 0% | — | — | confirmada |
| H8 | distance | agressivo | paciente | — | 1,000 | [1,000; 1,000] | 60 | 60 | 0% | 0% | — | — | confirmada |
| H9 | patience | paciente | agressivo | — | 0,999 | [0,994; 1,000] | 60 | 60 | 0% | 0% | — | — | confirmada |
| H10 | patience | evasivo | agressivo | — | 1,000 | [1,000; 1,000] | 60 | 60 | 0% | 0% | — | — | confirmada |
| H11 | patience | paciente | aleatorio | — | 0,988 | [0,968; 0,999] | 60 | 60 | 0% | 0% | — | — | confirmada |

Matriz estilo × dimensão: mediana dos valores definidos por run (entre parênteses, fração de runs indefinidas).

| Estilo | weapon_repertoire | action_repertoire | punish | defensive_repertoire | distance | patience |
| --- | --- | --- | --- | --- | --- | --- |
| agressivo | 0,596 (90%) | 0,472 (2%) | 0,748 (0%) | 0,500 (90%) | 0,332 (0%) | 0,667 (0%) |
| evasivo | 0,459 (5%) | 0,407 (0%) | 0,772 (2%) | 0,199 (12%) | 0,009 (0%) | 0,990 (0%) |
| bloqueador | — (100%) | 0,369 (0%) | 0,921 (0%) | 0,479 (7%) | 0,044 (0%) | 0,933 (0%) |
| paciente | 0,556 (60%) | 0,425 (30%) | 0,932 (0%) | 0,649 (3%) | 0,033 (0%) | 0,953 (0%) |
| variado | 0,626 (17%) | 0,670 (2%) | 0,822 (0%) | 0,493 (30%) | 0,058 (0%) | 0,787 (0%) |
| repetitivo | — (100%) | — (100%) | 0,889 (0%) | 0,647 (0%) | 0,391 (0%) | 0,914 (0%) |
| aleatorio | 0,859 (2%) | 0,763 (0%) | 0,800 (3%) | 0,500 (43%) | 0,065 (0%) | 0,778 (0%) |

## 4. Estabilidade (limite superior)

ICC(1,1) por dimensão, com os agentes como grupos e os valores por sala como medidas. É um limite superior: as políticas são estacionárias.

IC condicional aos agentes: reamostra runs, não agentes; não é IC de população.

O sinalizador "< 0,50" é apenas mostrado, NÃO aplicado (nenhuma conclusão foi condicionada a ele).

| Dimensão | ICC | IC 95% | N agentes | N medidas por sala | < 0,50 (não aplicado) |
| --- | --- | --- | --- | --- | --- |
| weapon_repertoire | 0,532 | [0,457; 0,611] | 5 | 341 | não |
| action_repertoire | 0,490 | [0,439; 0,549] | 6 | 633 | sim |
| punish | 0,584 | [0,526; 0,647] | 7 | 676 | não |
| defensive_repertoire | 0,330 | [0,258; 0,423] | 7 | 439 | sim |
| distance | 0,896 | [0,880; 0,913] | 7 | 1276 | não |
| patience | 0,710 | [0,673; 0,751] | 7 | 1265 | não |

## 5. Verificações do pipeline

| Agente | Verificação | Resultado | Detalhe |
| --- | --- | --- | --- |
| agressivo | live-equals-rebuilt | ok | live profile equals the rebuilt one |
| agressivo | no-skipped-observations | ok | skipped=0 |
| agressivo | no-malformed-metrics | ok | malformed=0 |
| agressivo | run-accounting | ok | run.start=66, completed=60 + truncated=0 + empty=6 = 66 |
| agressivo | seq-contiguous | ok | 6 sessions, seq 0..n-1 in each |
| evasivo | live-equals-rebuilt | ok | live profile equals the rebuilt one |
| evasivo | no-skipped-observations | ok | skipped=0 |
| evasivo | no-malformed-metrics | ok | malformed=0 |
| evasivo | run-accounting | ok | run.start=60, completed=37 + truncated=23 + empty=0 = 60 |
| evasivo | seq-contiguous | ok | 23 sessions, seq 0..n-1 in each |
| bloqueador | live-equals-rebuilt | ok | live profile equals the rebuilt one |
| bloqueador | no-skipped-observations | ok | skipped=0 |
| bloqueador | no-malformed-metrics | ok | malformed=0 |
| bloqueador | run-accounting | ok | run.start=66, completed=60 + truncated=0 + empty=6 = 66 |
| bloqueador | seq-contiguous | ok | 6 sessions, seq 0..n-1 in each |
| paciente | live-equals-rebuilt | ok | live profile equals the rebuilt one |
| paciente | no-skipped-observations | ok | skipped=0 |
| paciente | no-malformed-metrics | ok | malformed=0 |
| paciente | run-accounting | ok | run.start=66, completed=60 + truncated=0 + empty=6 = 66 |
| paciente | seq-contiguous | ok | 6 sessions, seq 0..n-1 in each |
| variado | live-equals-rebuilt | ok | live profile equals the rebuilt one |
| variado | no-skipped-observations | ok | skipped=0 |
| variado | no-malformed-metrics | ok | malformed=0 |
| variado | run-accounting | ok | run.start=66, completed=60 + truncated=0 + empty=6 = 66 |
| variado | seq-contiguous | ok | 6 sessions, seq 0..n-1 in each |
| repetitivo | live-equals-rebuilt | ok | live profile equals the rebuilt one |
| repetitivo | no-skipped-observations | ok | skipped=0 |
| repetitivo | no-malformed-metrics | ok | malformed=0 |
| repetitivo | run-accounting | ok | run.start=66, completed=60 + truncated=0 + empty=6 = 66 |
| repetitivo | seq-contiguous | ok | 6 sessions, seq 0..n-1 in each |
| aleatorio | live-equals-rebuilt | ok | live profile equals the rebuilt one |
| aleatorio | no-skipped-observations | ok | skipped=0 |
| aleatorio | no-malformed-metrics | ok | malformed=0 |
| aleatorio | run-accounting | ok | run.start=66, completed=60 + truncated=0 + empty=6 = 66 |
| aleatorio | seq-contiguous | ok | 6 sessions, seq 0..n-1 in each |

Contagens por tipo de evento (todos os eventos do log de cada agente, em ordem alfabética do tipo):

| Agente | Tipo de evento | Contagem |
| --- | --- | --- |
| agent-agressivo | encounter.end | 178 |
| agent-agressivo | encounter.start | 179 |
| agent-agressivo | enemy.attack_start | 412 |
| agent-agressivo | enemy.death | 113 |
| agent-agressivo | enemy.hurt | 606 |
| agent-agressivo | obs.action | 763 |
| agent-agressivo | obs.boundary | 251 |
| agent-agressivo | obs.defense | 44 |
| agent-agressivo | obs.outcome | 261 |
| agent-agressivo | obs.record | 3198 |
| agent-agressivo | opp.close | 696 |
| agent-agressivo | opp.open | 696 |
| agent-agressivo | player.action | 763 |
| agent-agressivo | player.cancel | 541 |
| agent-agressivo | player.death | 60 |
| agent-agressivo | player.defense | 44 |
| agent-agressivo | player.dodge | 40 |
| agent-agressivo | player.hit_unmitigated | 300 |
| agent-agressivo | player.hurt | 300 |
| agent-agressivo | pos.sample | 2928 |
| agent-agressivo | profile.snapshot | 73 |
| agent-agressivo | room.enter | 74 |
| agent-agressivo | run.end | 65 |
| agent-agressivo | run.start | 66 |
| agent-agressivo | session.start | 6 |
| agent-agressivo | **total** | 12657 |
| agent-evasivo | encounter.end | 2185 |
| agent-evasivo | encounter.start | 2186 |
| agent-evasivo | enemy.attack_start | 2668 |
| agent-evasivo | enemy.death | 2126 |
| agent-evasivo | enemy.hurt | 12192 |
| agent-evasivo | obs.action | 12194 |
| agent-evasivo | obs.boundary | 2930 |
| agent-evasivo | obs.defense | 1749 |
| agent-evasivo | obs.outcome | 270 |
| agent-evasivo | obs.record | 53942 |
| agent-evasivo | opp.close | 4809 |
| agent-evasivo | opp.open | 4812 |
| agent-evasivo | player.action | 12194 |
| agent-evasivo | player.cancel | 12080 |
| agent-evasivo | player.death | 37 |
| agent-evasivo | player.defense | 1749 |
| agent-evasivo | player.dodge | 1957 |
| agent-evasivo | player.hit_unmitigated | 237 |
| agent-evasivo | player.hurt | 237 |
| agent-evasivo | pos.sample | 51354 |
| agent-evasivo | profile.snapshot | 745 |
| agent-evasivo | room.enter | 746 |
| agent-evasivo | run.end | 59 |
| agent-evasivo | run.start | 60 |
| agent-evasivo | session.start | 23 |
| agent-evasivo | **total** | 183541 |
| agent-bloqueador | encounter.end | 223 |
| agent-bloqueador | encounter.start | 224 |
| agent-bloqueador | enemy.attack_start | 1033 |
| agent-bloqueador | enemy.death | 158 |
| agent-bloqueador | enemy.hurt | 902 |
| agent-bloqueador | obs.action | 902 |
| agent-bloqueador | obs.boundary | 319 |
| agent-bloqueador | obs.defense | 708 |
| agent-bloqueador | obs.outcome | 737 |
| agent-bloqueador | obs.record | 5750 |
| agent-bloqueador | opp.close | 1981 |
| agent-bloqueador | opp.open | 1981 |
| agent-bloqueador | player.action | 902 |
| agent-bloqueador | player.cancel | 172 |
| agent-bloqueador | player.death | 60 |
| agent-bloqueador | player.defense | 708 |
| agent-bloqueador | player.dodge | 47 |
| agent-bloqueador | player.hit_unmitigated | 300 |
| agent-bloqueador | player.hurt | 300 |
| agent-bloqueador | pos.sample | 5687 |
| agent-bloqueador | profile.snapshot | 96 |
| agent-bloqueador | room.enter | 97 |
| agent-bloqueador | run.end | 65 |
| agent-bloqueador | run.start | 66 |
| agent-bloqueador | session.start | 6 |
| agent-bloqueador | **total** | 23424 |
| agent-paciente | encounter.end | 278 |
| agent-paciente | encounter.start | 279 |
| agent-paciente | enemy.attack_start | 1360 |
| agent-paciente | enemy.death | 213 |
| agent-paciente | enemy.hurt | 1314 |
| agent-paciente | obs.action | 1314 |
| agent-paciente | obs.boundary | 393 |
| agent-paciente | obs.defense | 1004 |
| agent-paciente | obs.outcome | 895 |
| agent-paciente | obs.record | 7852 |
| agent-paciente | opp.close | 2604 |
| agent-paciente | opp.open | 2604 |
| agent-paciente | player.action | 1314 |
| agent-paciente | player.cancel | 703 |
| agent-paciente | player.death | 60 |
| agent-paciente | player.defense | 1004 |
| agent-paciente | player.dodge | 631 |
| agent-paciente | player.hit_unmitigated | 300 |
| agent-paciente | player.hurt | 300 |
| agent-paciente | pos.sample | 7742 |
| agent-paciente | profile.snapshot | 115 |
| agent-paciente | room.enter | 116 |
| agent-paciente | run.end | 65 |
| agent-paciente | run.start | 66 |
| agent-paciente | session.start | 6 |
| agent-paciente | **total** | 32532 |
| agent-variado | encounter.end | 231 |
| agent-variado | encounter.start | 232 |
| agent-variado | enemy.attack_start | 634 |
| agent-variado | enemy.death | 166 |
| agent-variado | enemy.hurt | 716 |
| agent-variado | obs.action | 724 |
| agent-variado | obs.boundary | 334 |
| agent-variado | obs.defense | 255 |
| agent-variado | obs.outcome | 275 |
| agent-variado | obs.record | 4459 |
| agent-variado | opp.close | 1126 |
| agent-variado | opp.open | 1126 |
| agent-variado | player.action | 724 |
| agent-variado | player.cancel | 318 |
| agent-variado | player.death | 60 |
| agent-variado | player.defense | 255 |
| agent-variado | player.dodge | 179 |
| agent-variado | player.hit_unmitigated | 300 |
| agent-variado | player.hurt | 300 |
| agent-variado | pos.sample | 4322 |
| agent-variado | profile.snapshot | 103 |
| agent-variado | room.enter | 104 |
| agent-variado | run.end | 65 |
| agent-variado | run.start | 66 |
| agent-variado | session.start | 6 |
| agent-variado | **total** | 17080 |
| agent-repetitivo | encounter.end | 231 |
| agent-repetitivo | encounter.start | 232 |
| agent-repetitivo | enemy.attack_start | 998 |
| agent-repetitivo | enemy.death | 166 |
| agent-repetitivo | enemy.hurt | 1188 |
| agent-repetitivo | obs.action | 1197 |
| agent-repetitivo | obs.boundary | 328 |
| agent-repetitivo | obs.defense | 629 |
| agent-repetitivo | obs.outcome | 628 |
| agent-repetitivo | obs.record | 5948 |
| agent-repetitivo | opp.close | 1867 |
| agent-repetitivo | opp.open | 1867 |
| agent-repetitivo | player.action | 1197 |
| agent-repetitivo | player.cancel | 642 |
| agent-repetitivo | player.death | 60 |
| agent-repetitivo | player.defense | 629 |
| agent-repetitivo | player.dodge | 360 |
| agent-repetitivo | player.hit_unmitigated | 300 |
| agent-repetitivo | player.hurt | 300 |
| agent-repetitivo | pos.sample | 5779 |
| agent-repetitivo | profile.snapshot | 97 |
| agent-repetitivo | room.enter | 98 |
| agent-repetitivo | run.end | 65 |
| agent-repetitivo | run.start | 66 |
| agent-repetitivo | session.start | 6 |
| agent-repetitivo | **total** | 24878 |
| agent-aleatorio | encounter.end | 190 |
| agent-aleatorio | encounter.start | 191 |
| agent-aleatorio | enemy.attack_start | 527 |
| agent-aleatorio | enemy.death | 125 |
| agent-aleatorio | enemy.hurt | 555 |
| agent-aleatorio | obs.action | 567 |
| agent-aleatorio | obs.boundary | 266 |
| agent-aleatorio | obs.defense | 164 |
| agent-aleatorio | obs.outcome | 206 |
| agent-aleatorio | obs.record | 3639 |
| agent-aleatorio | opp.close | 931 |
| agent-aleatorio | opp.open | 931 |
| agent-aleatorio | player.action | 567 |
| agent-aleatorio | player.cancel | 215 |
| agent-aleatorio | player.death | 60 |
| agent-aleatorio | player.defense | 164 |
| agent-aleatorio | player.dodge | 100 |
| agent-aleatorio | player.hit_unmitigated | 300 |
| agent-aleatorio | player.hurt | 300 |
| agent-aleatorio | pos.sample | 3523 |
| agent-aleatorio | profile.snapshot | 76 |
| agent-aleatorio | room.enter | 77 |
| agent-aleatorio | run.end | 65 |
| agent-aleatorio | run.start | 66 |
| agent-aleatorio | session.start | 6 |
| agent-aleatorio | **total** | 13811 |

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
- As 13 hipóteses são testadas sem correção para comparações múltiplas (V0 exploratório; com Bonferroni o alfa seria 0,05/13).
