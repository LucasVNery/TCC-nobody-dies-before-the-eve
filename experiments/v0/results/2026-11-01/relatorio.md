# Relatório do experimento V0 (agentes sintéticos)

## 1. Configuração

- Versão do jogo: 0.0.5
- Seed do experimento: 20261105 (todas as seeds de jogo, política e humanizador derivam dela, por agente e por run)
- Humanizador: reação 250 ms (desvio 60 ms), probabilidade de lapso 0,05, ruído de mira 0,05 rad
- Passo da simulação: 16,667 ms
- Teto de tempo simulado por run: 600000 ms
- Runs por agente: 60; runs por sessão: 10
- Gerado em: 2026-11-02T00:36:34.852Z
- Tempo decorrido: 7545 ms
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
| bloqueador | sword_shield 1 | 0 | sword_shield.light 3; sword_shield.heavy 1 | 650 | 40 ± 15 | esquiva 0,05; bloqueio 0,55; parry 0,35; nada 0,05 | sim | 0,5 | 30 | 0,5 | cura abaixo de 0,5 da vida; bomba a 110 px; poder ao iniciar ataque: sim |
| paciente | sword_shield 0,6; bow 0,4 | 1 | sword_shield.light 3; sword_shield.heavy 1; bow.shot 1 | 600 | 55 ± 15 | esquiva 0,5; bloqueio 0,3; parry 0,1; nada 0,1 | sim | 0,3 | 45 | 0,7 | cura abaixo de 0,5 da vida; bomba a 110 px; poder ao iniciar ataque: sim |
| variado | sword_shield 1; heavy_weapon 1,2; bow 0,35 | 15 | sword_shield.light 1; sword_shield.heavy 1; sword_shield.charged 1; heavy_weapon.light 1; heavy_weapon.heavy 1; heavy_weapon.charged 1; bow.shot 1 | 600 | 50 ± 20 | esquiva 0,35; bloqueio 0,3; parry 0,25; nada 0,1 | não | 0,6 | 15 | 0,6 | cura abaixo de 0,5 da vida; bomba a 110 px; poder ao iniciar ataque: sim |
| repetitivo | sword_shield 1 | 0 | sword_shield.light 1 | 550 | 35 ± 10 | esquiva 0,35; bloqueio 0,35; parry 0; nada 0,3 | não | 0,5 | 0 | 0,2 | cura abaixo de 0,5 da vida; bomba a 110 px; poder ao iniciar ataque: sim |
| aleatorio | sword_shield 3; heavy_weapon 3; bow 1 | 6000 | sword_shield.light 1; sword_shield.heavy 1; sword_shield.charged 1; heavy_weapon.light 1; heavy_weapon.heavy 1; heavy_weapon.charged 1; bow.shot 1 | 600 | 60 ± 30 | esquiva 0,25; bloqueio 0,25; parry 0,25; nada 0,25 | não | 0,5 | 0 | 0,5 | aleatório |

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
| agressivo | 66 | 60 | 0 | 6 | 6 | 670,8 |
| evasivo | 64 | 56 | 4 | 4 | 8 | 14750,2 |
| bloqueador | 66 | 60 | 0 | 6 | 6 | 2887,6 |
| paciente | 66 | 60 | 0 | 6 | 6 | 2040,8 |
| variado | 66 | 60 | 0 | 6 | 6 | 1229,2 |
| repetitivo | 66 | 60 | 0 | 6 | 6 | 869,5 |
| aleatorio | 66 | 60 | 0 | 6 | 6 | 1149,9 |

Perfil final (acumulador ao vivo, relógio de traço; déficit = 1 − domínio). Linhas com amostra 0 estão "a priori (sem dados)": o domínio e o déficit são o prior da Beta (ou indefinidos) e aparecem como —, sem leitura como desempenho; a confiança é 0. — também marca o indefinido.

| Agente | Dimensão | Amostra | Domínio | Confiança | Déficit | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| agressivo | weapon_repertoire | 80,249 | 0,452 | 0,762 | 0,548 |  |
| agressivo | action_repertoire | 80,249 | 0,593 | 0,762 | 0,407 |  |
| agressivo | punish | 26,740 | 0,430 | 0,728 | 0,570 |  |
| agressivo | defensive_repertoire | 5,570 | 0,700 | 0,182 | 0,300 |  |
| agressivo | distance | 85,649 | 0,777 | 0,895 | 0,223 |  |
| agressivo | patience | 80,249 | 0,849 | 0,889 | 0,151 |  |
| evasivo | weapon_repertoire | 213,378 | 0,517 | 0,895 | 0,483 |  |
| evasivo | action_repertoire | 213,389 | 0,443 | 0,895 | 0,557 |  |
| evasivo | punish | 5,113 | 0,859 | 0,338 | 0,141 |  |
| evasivo | defensive_repertoire | 63,907 | 0,505 | 0,719 | 0,495 |  |
| evasivo | distance | 267,461 | 0,077 | 0,964 | 0,923 |  |
| evasivo | patience | 213,378 | 0,983 | 0,955 | 0,017 |  |
| bloqueador | weapon_repertoire | 108,925 | — | 0,813 | — |  |
| bloqueador | action_repertoire | 109,802 | 0,400 | 0,815 | 0,600 |  |
| bloqueador | punish | 112,926 | 0,815 | 0,919 | 0,185 |  |
| bloqueador | defensive_repertoire | 112,349 | 0,608 | 0,818 | 0,392 |  |
| bloqueador | distance | 260,961 | 0,808 | 0,963 | 0,192 |  |
| bloqueador | patience | 108,925 | 0,991 | 0,916 | 0,009 |  |
| paciente | weapon_repertoire | 64,552 | 0,623 | 0,721 | 0,377 |  |
| paciente | action_repertoire | 64,676 | 0,625 | 0,721 | 0,375 |  |
| paciente | punish | 58,820 | 0,839 | 0,855 | 0,161 |  |
| paciente | defensive_repertoire | 72,122 | 0,841 | 0,743 | 0,159 |  |
| paciente | distance | 184,130 | 0,697 | 0,948 | 0,303 |  |
| paciente | patience | 64,552 | 0,985 | 0,866 | 0,015 |  |
| variado | weapon_repertoire | 95,192 | 0,858 | 0,792 | 0,142 |  |
| variado | action_repertoire | 95,192 | 0,824 | 0,792 | 0,176 |  |
| variado | punish | 39,580 | 0,457 | 0,798 | 0,543 |  |
| variado | defensive_repertoire | 29,949 | 0,779 | 0,545 | 0,221 |  |
| variado | distance | 146,700 | 0,718 | 0,936 | 0,282 |  |
| variado | patience | 95,192 | 0,871 | 0,905 | 0,129 |  |
| repetitivo | weapon_repertoire | 101,178 | — | 0,802 | — |  |
| repetitivo | action_repertoire | 101,178 | — | 0,802 | — |  |
| repetitivo | punish | 37,266 | 0,766 | 0,788 | 0,234 |  |
| repetitivo | defensive_repertoire | 28,443 | 0,813 | 0,532 | 0,187 |  |
| repetitivo | distance | 108,819 | 0,777 | 0,916 | 0,223 |  |
| repetitivo | patience | 101,178 | 0,957 | 0,910 | 0,043 |  |
| aleatorio | weapon_repertoire | 87,832 | 0,891 | 0,778 | 0,109 |  |
| aleatorio | action_repertoire | 87,832 | 0,825 | 0,778 | 0,175 |  |
| aleatorio | punish | 33,856 | 0,538 | 0,772 | 0,462 |  |
| aleatorio | defensive_repertoire | 19,144 | 0,807 | 0,434 | 0,193 |  |
| aleatorio | distance | 131,819 | 0,720 | 0,929 | 0,280 |  |
| aleatorio | patience | 87,832 | 0,906 | 0,898 | 0,094 |  |

## 3. Separação de estilos

Veredito: confirmada (IC 95% bootstrap do delta de Cliff acima de 0 e delta ≥ 0,33, ou a taxa de indefinição pedida); refutada; indefinida (dados insuficientes: menos de 10 valores definidos por grupo, ou menos de 10 runs nas hipóteses de taxa de indefinição). Hipótese refutada ou indefinida é resultado, não defeito. N definidos = valores por run com domínio definido em cada grupo; Indef. = fração das runs do grupo com domínio indefinido.

Linhas H1u e H2u (taxa de indefinição): as colunas Estilo, Indef. estilo e N runs substituem Maior/Menor, delta e IC. H1 e H5 também são confirmadas se o grupo menor tiver pelo menos 10 runs e for indefinido em pelo menos 95% delas (isto substitui só o teste do delta: o grupo maior ainda precisa de pelo menos 10 valores definidos); H6 NÃO tem a cláusula "ou indefinido".

| Id | Dimensão | Maior | Menor | Estilo | Delta | IC 95% | N definidos (maior) | N definidos (menor) | Indef. maior | Indef. menor | Indef. estilo | N runs estilo | Veredito |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H1 | weapon_repertoire | variado | agressivo | — | 0,773 | [0,564; 0,945] | 55 | 2 | 8% | 97% | — | — | confirmada |
| H1u | weapon_repertoire | — | — | repetitivo | — | — | — | — | — | — | 100% | 60 | confirmada |
| H2 | action_repertoire | variado | bloqueador | — | 0,965 | [0,920; 0,996] | 59 | 55 | 2% | 8% | — | — | confirmada |
| H2u | action_repertoire | — | — | repetitivo | — | — | — | — | — | — | 100% | 60 | confirmada |
| H3 | punish | paciente | evasivo | — | 0,415 | [0,221; 0,607] | 60 | 59 | 0% | 2% | — | — | confirmada |
| H4 | punish | bloqueador | evasivo | — | -0,171 | [-0,375; 0,037] | 60 | 59 | 0% | 2% | — | — | refutada |
| H5 | defensive_repertoire | aleatorio | agressivo | — | — | — | 2 | 0 | 97% | 100% | — | — | indefinida |
| H6 | defensive_repertoire | aleatorio | evasivo | — | 1,000 | [1,000; 1,000] | 2 | 60 | 97% | 0% | — | — | indefinida |
| H7 | distance | agressivo | evasivo | — | 1,000 | [1,000; 1,000] | 60 | 60 | 0% | 0% | — | — | confirmada |
| H8 | distance | agressivo | paciente | — | 0,586 | [0,412; 0,741] | 60 | 60 | 0% | 0% | — | — | confirmada |
| H9 | patience | paciente | agressivo | — | 0,861 | [0,764; 0,937] | 60 | 60 | 0% | 0% | — | — | confirmada |
| H10 | patience | evasivo | agressivo | — | 0,992 | [0,977; 1,000] | 60 | 60 | 0% | 0% | — | — | confirmada |
| H11 | patience | paciente | aleatorio | — | 0,652 | [0,501; 0,782] | 60 | 60 | 0% | 0% | — | — | confirmada |

Matriz estilo × dimensão: mediana dos valores definidos por run (entre parênteses, fração de runs indefinidas).

| Estilo | weapon_repertoire | action_repertoire | punish | defensive_repertoire | distance | patience |
| --- | --- | --- | --- | --- | --- | --- |
| agressivo | 0,325 (97%) | 0,498 (0%) | 0,500 (0%) | — (100%) | 0,725 (0%) | 0,786 (0%) |
| evasivo | 0,462 (10%) | 0,399 (0%) | 0,826 (2%) | 0,498 (0%) | 0,081 (0%) | 0,985 (0%) |
| bloqueador | — (100%) | 0,360 (8%) | 0,800 (0%) | 0,545 (7%) | 0,815 (0%) | 0,953 (0%) |
| paciente | 0,614 (63%) | 0,427 (50%) | 0,875 (0%) | 0,798 (17%) | 0,650 (0%) | 0,929 (0%) |
| variado | 0,627 (8%) | 0,736 (2%) | 0,500 (0%) | 0,731 (90%) | 0,688 (0%) | 0,857 (0%) |
| repetitivo | — (100%) | — (100%) | 0,667 (0%) | — (100%) | 0,757 (0%) | 0,917 (0%) |
| aleatorio | 0,873 (0%) | 0,786 (0%) | 0,500 (0%) | 0,851 (97%) | 0,660 (0%) | 0,867 (0%) |

## 4. Estabilidade (limite superior)

ICC(1,1) por dimensão, com os agentes como grupos e os valores por sala como medidas. É um limite superior: as políticas são estacionárias.

IC condicional aos agentes: reamostra runs, não agentes; não é IC de população.

O sinalizador "< 0,50" é apenas mostrado, NÃO aplicado (nenhuma conclusão foi condicionada a ele).

| Dimensão | ICC | IC 95% | N agentes | N medidas por sala | < 0,50 (não aplicado) |
| --- | --- | --- | --- | --- | --- |
| weapon_repertoire | 0,580 | [0,517; 0,644] | 5 | 310 | não |
| action_repertoire | 0,558 | [0,513; 0,609] | 6 | 488 | não |
| punish | 0,594 | [0,544; 0,651] | 7 | 647 | não |
| defensive_repertoire | 0,680 | [0,608; 0,750] | 4 | 251 | não |
| distance | 0,962 | [0,952; 0,971] | 7 | 837 | não |
| patience | 0,569 | [0,493; 0,649] | 7 | 837 | não |

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
| evasivo | run-accounting | ok | run.start=64, completed=56 + truncated=4 + empty=4 = 64 |
| evasivo | seq-contiguous | ok | 8 sessions, seq 0..n-1 in each |
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
| agent-agressivo | encounter.end | 79 |
| agent-agressivo | encounter.start | 80 |
| agent-agressivo | enemy.attack_start | 363 |
| agent-agressivo | enemy.death | 14 |
| agent-agressivo | enemy.hurt | 599 |
| agent-agressivo | obs.action | 663 |
| agent-agressivo | obs.boundary | 144 |
| agent-agressivo | obs.defense | 31 |
| agent-agressivo | obs.outcome | 207 |
| agent-agressivo | obs.record | 2834 |
| agent-agressivo | opp.close | 574 |
| agent-agressivo | opp.open | 574 |
| agent-agressivo | player.action | 663 |
| agent-agressivo | player.cancel | 481 |
| agent-agressivo | player.death | 60 |
| agent-agressivo | player.defense | 31 |
| agent-agressivo | player.dodge | 7 |
| agent-agressivo | player.guard_break | 5 |
| agent-agressivo | player.hit_unmitigated | 293 |
| agent-agressivo | player.hurt | 293 |
| agent-agressivo | pos.sample | 2679 |
| agent-agressivo | profile.snapshot | 65 |
| agent-agressivo | room.enter | 66 |
| agent-agressivo | run.end | 65 |
| agent-agressivo | run.start | 66 |
| agent-agressivo | session.start | 6 |
| agent-agressivo | **total** | 10942 |
| agent-evasivo | encounter.end | 879 |
| agent-evasivo | encounter.start | 880 |
| agent-evasivo | enemy.attack_start | 3217 |
| agent-evasivo | enemy.death | 816 |
| agent-evasivo | enemy.hurt | 12958 |
| agent-evasivo | item.expire | 643 |
| agent-evasivo | item.pickup | 61 |
| agent-evasivo | item.spawn | 708 |
| agent-evasivo | item.use | 39 |
| agent-evasivo | obs.action | 13109 |
| agent-evasivo | obs.boundary | 1333 |
| agent-evasivo | obs.defense | 2659 |
| agent-evasivo | obs.outcome | 400 |
| agent-evasivo | obs.record | 60777 |
| agent-evasivo | opp.close | 5669 |
| agent-evasivo | opp.open | 5671 |
| agent-evasivo | player.action | 13070 |
| agent-evasivo | player.cancel | 12781 |
| agent-evasivo | player.death | 56 |
| agent-evasivo | player.defense | 2659 |
| agent-evasivo | player.dodge | 2035 |
| agent-evasivo | player.guard_break | 4 |
| agent-evasivo | player.hit_unmitigated | 293 |
| agent-evasivo | player.hurt | 293 |
| agent-evasivo | pos.sample | 58996 |
| agent-evasivo | profile.snapshot | 454 |
| agent-evasivo | projectile.expire | 26 |
| agent-evasivo | projectile.hit | 10803 |
| agent-evasivo | room.enter | 455 |
| agent-evasivo | run.end | 63 |
| agent-evasivo | run.start | 64 |
| agent-evasivo | session.start | 8 |
| agent-evasivo | **total** | 211879 |
| agent-bloqueador | encounter.end | 132 |
| agent-bloqueador | encounter.start | 133 |
| agent-bloqueador | enemy.attack_start | 1637 |
| agent-bloqueador | enemy.death | 67 |
| agent-bloqueador | enemy.hurt | 1251 |
| agent-bloqueador | item.expire | 111 |
| agent-bloqueador | item.pickup | 9 |
| agent-bloqueador | item.spawn | 120 |
| agent-bloqueador | item.use | 5 |
| agent-bloqueador | obs.action | 1252 |
| agent-bloqueador | obs.boundary | 216 |
| agent-bloqueador | obs.defense | 1339 |
| agent-bloqueador | obs.outcome | 1278 |
| agent-bloqueador | obs.record | 11314 |
| agent-bloqueador | opp.close | 2988 |
| agent-bloqueador | opp.open | 2988 |
| agent-bloqueador | player.action | 1247 |
| agent-bloqueador | player.cancel | 690 |
| agent-bloqueador | player.death | 60 |
| agent-bloqueador | player.defense | 1339 |
| agent-bloqueador | player.dodge | 59 |
| agent-bloqueador | player.guard_break | 4 |
| agent-bloqueador | player.hit_unmitigated | 296 |
| agent-bloqueador | player.hurt | 296 |
| agent-bloqueador | pos.sample | 11547 |
| agent-bloqueador | profile.snapshot | 84 |
| agent-bloqueador | room.enter | 85 |
| agent-bloqueador | run.end | 65 |
| agent-bloqueador | run.start | 66 |
| agent-bloqueador | session.start | 6 |
| agent-bloqueador | **total** | 40684 |
| agent-paciente | encounter.end | 92 |
| agent-paciente | encounter.start | 93 |
| agent-paciente | enemy.attack_start | 1202 |
| agent-paciente | enemy.death | 27 |
| agent-paciente | enemy.hurt | 836 |
| agent-paciente | item.expire | 70 |
| agent-paciente | item.pickup | 3 |
| agent-paciente | item.spawn | 73 |
| agent-paciente | item.use | 2 |
| agent-paciente | obs.action | 839 |
| agent-paciente | obs.boundary | 157 |
| agent-paciente | obs.defense | 902 |
| agent-paciente | obs.outcome | 712 |
| agent-paciente | obs.record | 7906 |
| agent-paciente | opp.close | 2134 |
| agent-paciente | opp.open | 2134 |
| agent-paciente | player.action | 837 |
| agent-paciente | player.cancel | 526 |
| agent-paciente | player.death | 60 |
| agent-paciente | player.defense | 902 |
| agent-paciente | player.dodge | 471 |
| agent-paciente | player.hit_unmitigated | 299 |
| agent-paciente | player.hurt | 299 |
| agent-paciente | pos.sample | 8160 |
| agent-paciente | profile.snapshot | 65 |
| agent-paciente | projectile.expire | 2 |
| agent-paciente | projectile.hit | 531 |
| agent-paciente | room.enter | 66 |
| agent-paciente | run.end | 65 |
| agent-paciente | run.start | 66 |
| agent-paciente | session.start | 6 |
| agent-paciente | **total** | 29537 |
| agent-variado | encounter.end | 116 |
| agent-variado | encounter.start | 117 |
| agent-variado | enemy.attack_start | 624 |
| agent-variado | enemy.death | 51 |
| agent-variado | enemy.hurt | 778 |
| agent-variado | item.expire | 30 |
| agent-variado | item.spawn | 30 |
| agent-variado | obs.action | 814 |
| agent-variado | obs.boundary | 187 |
| agent-variado | obs.defense | 259 |
| agent-variado | obs.outcome | 349 |
| agent-variado | obs.record | 4930 |
| agent-variado | opp.close | 1033 |
| agent-variado | opp.open | 1033 |
| agent-variado | player.action | 814 |
| agent-variado | player.cancel | 588 |
| agent-variado | player.death | 60 |
| agent-variado | player.defense | 259 |
| agent-variado | player.dodge | 51 |
| agent-variado | player.guard_break | 27 |
| agent-variado | player.hit_unmitigated | 293 |
| agent-variado | player.hurt | 293 |
| agent-variado | pos.sample | 4914 |
| agent-variado | profile.snapshot | 71 |
| agent-variado | projectile.expire | 1 |
| agent-variado | projectile.hit | 141 |
| agent-variado | room.enter | 72 |
| agent-variado | run.end | 65 |
| agent-variado | run.start | 66 |
| agent-variado | session.start | 6 |
| agent-variado | **total** | 18072 |
| agent-repetitivo | encounter.end | 70 |
| agent-repetitivo | encounter.start | 71 |
| agent-repetitivo | enemy.attack_start | 510 |
| agent-repetitivo | enemy.death | 5 |
| agent-repetitivo | enemy.hurt | 789 |
| agent-repetitivo | item.expire | 2 |
| agent-repetitivo | item.spawn | 2 |
| agent-repetitivo | obs.action | 804 |
| agent-repetitivo | obs.boundary | 135 |
| agent-repetitivo | obs.defense | 217 |
| agent-repetitivo | obs.outcome | 296 |
| agent-repetitivo | obs.record | 3630 |
| agent-repetitivo | opp.close | 861 |
| agent-repetitivo | opp.open | 861 |
| agent-repetitivo | player.action | 804 |
| agent-repetitivo | player.cancel | 395 |
| agent-repetitivo | player.death | 60 |
| agent-repetitivo | player.defense | 217 |
| agent-repetitivo | player.dodge | 69 |
| agent-repetitivo | player.guard_break | 8 |
| agent-repetitivo | player.hit_unmitigated | 292 |
| agent-repetitivo | player.hurt | 292 |
| agent-repetitivo | pos.sample | 3475 |
| agent-repetitivo | profile.snapshot | 65 |
| agent-repetitivo | room.enter | 66 |
| agent-repetitivo | run.end | 65 |
| agent-repetitivo | run.start | 66 |
| agent-repetitivo | session.start | 6 |
| agent-repetitivo | **total** | 14133 |
| agent-aleatorio | encounter.end | 118 |
| agent-aleatorio | encounter.start | 119 |
| agent-aleatorio | enemy.attack_start | 595 |
| agent-aleatorio | enemy.death | 53 |
| agent-aleatorio | enemy.hurt | 756 |
| agent-aleatorio | item.expire | 25 |
| agent-aleatorio | item.spawn | 25 |
| agent-aleatorio | obs.action | 785 |
| agent-aleatorio | obs.boundary | 185 |
| agent-aleatorio | obs.defense | 205 |
| agent-aleatorio | obs.outcome | 305 |
| agent-aleatorio | obs.record | 4641 |
| agent-aleatorio | opp.close | 948 |
| agent-aleatorio | opp.open | 948 |
| agent-aleatorio | player.action | 785 |
| agent-aleatorio | player.cancel | 578 |
| agent-aleatorio | player.death | 60 |
| agent-aleatorio | player.defense | 205 |
| agent-aleatorio | player.dodge | 33 |
| agent-aleatorio | player.guard_break | 24 |
| agent-aleatorio | player.hit_unmitigated | 290 |
| agent-aleatorio | player.hurt | 290 |
| agent-aleatorio | pos.sample | 4597 |
| agent-aleatorio | profile.snapshot | 67 |
| agent-aleatorio | projectile.expire | 1 |
| agent-aleatorio | projectile.hit | 116 |
| agent-aleatorio | room.enter | 68 |
| agent-aleatorio | run.end | 65 |
| agent-aleatorio | run.start | 66 |
| agent-aleatorio | session.start | 6 |
| agent-aleatorio | **total** | 16959 |

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
| agressivo | staminaSpentPerMinute | 60 | 60 | 907,973 | 146,121 |
| agressivo | staminaHighFraction | 60 | 60 | 0,196 | 0,050 |
| agressivo | dodgeSpendShare | 60 | 60 | 0,021 | 0,060 |
| agressivo | blockSpendShare | 60 | 60 | 0,003 | 0,012 |
| agressivo | itemPickRate | 60 | 0 | — | — |
| evasivo | staminaSpentPerMinute | 60 | 60 | 807,531 | 140,281 |
| evasivo | staminaHighFraction | 60 | 60 | 0,145 | 0,067 |
| evasivo | dodgeSpendShare | 60 | 60 | 0,388 | 0,110 |
| evasivo | blockSpendShare | 60 | 60 | 0,002 | 0,004 |
| evasivo | itemPickRate | 60 | 60 | 0,151 | 0,216 |
| bloqueador | staminaSpentPerMinute | 60 | 60 | 662,886 | 75,113 |
| bloqueador | staminaHighFraction | 60 | 60 | 0,526 | 0,197 |
| bloqueador | dodgeSpendShare | 60 | 60 | 0,051 | 0,057 |
| bloqueador | blockSpendShare | 60 | 60 | 0,350 | 0,076 |
| bloqueador | itemPickRate | 60 | 42 | 0,129 | 0,285 |
| paciente | staminaSpentPerMinute | 60 | 60 | 771,291 | 119,177 |
| paciente | staminaHighFraction | 60 | 60 | 0,791 | 0,155 |
| paciente | dodgeSpendShare | 60 | 60 | 0,511 | 0,121 |
| paciente | blockSpendShare | 60 | 60 | 0,144 | 0,083 |
| paciente | itemPickRate | 60 | 27 | 0,093 | 0,279 |
| variado | staminaSpentPerMinute | 60 | 60 | 729,484 | 97,816 |
| variado | staminaHighFraction | 60 | 60 | 0,140 | 0,060 |
| variado | dodgeSpendShare | 60 | 60 | 0,099 | 0,098 |
| variado | blockSpendShare | 60 | 60 | 0,079 | 0,075 |
| variado | itemPickRate | 60 | 1 | 0,000 | — |
| repetitivo | staminaSpentPerMinute | 60 | 60 | 802,296 | 120,596 |
| repetitivo | staminaHighFraction | 60 | 60 | 0,219 | 0,073 |
| repetitivo | dodgeSpendShare | 60 | 60 | 0,163 | 0,127 |
| repetitivo | blockSpendShare | 60 | 60 | 0,070 | 0,063 |
| repetitivo | itemPickRate | 60 | 0 | — | — |
| aleatorio | staminaSpentPerMinute | 60 | 60 | 745,280 | 109,421 |
| aleatorio | staminaHighFraction | 60 | 60 | 0,173 | 0,076 |
| aleatorio | dodgeSpendShare | 60 | 60 | 0,061 | 0,076 |
| aleatorio | blockSpendShare | 60 | 60 | 0,060 | 0,063 |
| aleatorio | itemPickRate | 60 | 1 | 0,000 | — |

## 8. Família M (métricas novas)

Unidade: valor da métrica por run (seção 7). Critério igual ao da família P: confirmada se o IC 95% bootstrap do delta de Cliff (maior vs menor) fica acima de 0 e delta ≥ 0,33; indefinida com menos de 10 valores definidos em algum grupo (valor indefinido = métrica sem amostra na run); refutada nos demais casos. A família M é palpite do Claude revisado pelo autor; hipótese refutada ou indefinida é resultado, não defeito.

Limitação de M5 (decisão do autor, 2026-11-01): M5 foi mantida como pré-registrada e deve sair indefinida. O itemPickRate depende do tempo de sobrevivência e da geometria de aparecimento dos itens; um jogador que joga como o agressivo morre antes do primeiro item e não gera valor algum. A métrica, portanto, não é interpretável como medida de busca de itens; isto é um achado sobre a métrica, não sobre o agente testado. Uma métrica válida para essa característica fica para uma versão futura.

| Id | Métrica | Maior | Menor | Delta | IC 95% | N definidos (maior) | N definidos (menor) | Indef. maior | Indef. menor | Veredito |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | staminaSpentPerMinute | agressivo | bloqueador | 0,881 | [0,778; 0,957] | 60 | 60 | 0% | 0% | confirmada |
| M2 | staminaHighFraction | bloqueador | agressivo | 0,902 | [0,805; 0,979] | 60 | 60 | 0% | 0% | confirmada |
| M3 | dodgeSpendShare | evasivo | agressivo | 1,000 | [1,000; 1,000] | 60 | 60 | 0% | 0% | confirmada |
| M4 | blockSpendShare | bloqueador | evasivo | 1,000 | [1,000; 1,000] | 60 | 60 | 0% | 0% | confirmada |
| M5 | itemPickRate | evasivo | agressivo | — | — | 60 | 0 | 0% | 100% | indefinida |

## 9. Reação por tipo de ataque (descritiva)

Tempo do início do ataque do inimigo até a primeira esquiva dentro da janela de esquiva (`reaction.byKind` do painel), por tipo de ataque como registrado no log, somado sobre as runs e ponderado pelo número de reações. Descritiva, sem hipótese: as telegraphs têm durações diferentes (tabela da seção 1), então só se compara dentro de um mesmo tipo; `combo` e `lunge` do log misturam duas durações cada (ver seção 1).

| Estilo | Tipo de ataque | N reações | Média (ms) |
| --- | --- | --- | --- |
| agressivo | combo | 4 | 325,0 |
| agressivo | swing | 2 | 291,7 |
| evasivo | combo | 727 | 339,5 |
| evasivo | lunge | 3 | 800,0 |
| evasivo | slam | 280 | 625,4 |
| evasivo | swing | 772 | 385,0 |
| bloqueador | combo | 17 | 338,2 |
| bloqueador | slam | 13 | 635,9 |
| bloqueador | swing | 29 | 372,4 |
| paciente | combo | 195 | 325,1 |
| paciente | slam | 68 | 613,2 |
| paciente | swing | 201 | 362,9 |
| variado | combo | 19 | 281,6 |
| variado | slam | 10 | 616,7 |
| variado | swing | 14 | 367,9 |
| repetitivo | combo | 27 | 290,1 |
| repetitivo | slam | 9 | 646,3 |
| repetitivo | swing | 17 | 354,9 |
| aleatorio | combo | 14 | 341,7 |
| aleatorio | slam | 3 | 611,1 |
| aleatorio | swing | 7 | 373,8 |

## Apêndice A. Comparação com o piloto 0.0.3 (descritiva)

Veredito de cada hipótese da família P no piloto 0.0.3 e nesta execução, lado a lado. Apenas descritivo (versões não comparáveis: as mecânicas e os agentes mudaram); as hipóteses da família P já tinham sido vistas na 0.0.3.

| Id | Dimensão | Veredito 0.0.3 (piloto) | Veredito atual |
| --- | --- | --- | --- |
| H1 | weapon_repertoire | indefinida | confirmada |
| H1u | weapon_repertoire | confirmada | confirmada |
| H2 | action_repertoire | confirmada | confirmada |
| H2u | action_repertoire | confirmada | confirmada |
| H3 | punish | confirmada | confirmada |
| H4 | punish | confirmada | refutada |
| H5 | defensive_repertoire | indefinida | indefinida |
| H6 | defensive_repertoire | confirmada | indefinida |
| H7 | distance | confirmada | confirmada |
| H8 | distance | confirmada | confirmada |
| H9 | patience | confirmada | confirmada |
| H10 | patience | confirmada | confirmada |
| H11 | patience | confirmada | confirmada |
