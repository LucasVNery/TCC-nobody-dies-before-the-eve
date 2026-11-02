# Leitura dos resultados não confirmados (V0.1, seed 20261105)

Texto derivado dos resultados arquivados nesta pasta. **Não altera nenhum veredito, hipótese ou parâmetro pré-registrado**: os vereditos formais continuam os do `relatorio.md`. Aqui cada hipótese não confirmada recebe uma leitura (o mecanismo que a explica) e o que ela diz sobre o sistema de perfil. Escrito em 2026-11-01, depois da execução; toda análise além do relatório é **pós-hoc** e está marcada como tal.

## 1. Princípio

Uma hipótese refutada ou indefinida é resultado (spec §4.4). Quando o mecanismo da falha é identificável, ele é um resultado mais forte do que o veredito sozinho: mostra onde o perfil deixa de ser interpretável e como usá-lo mesmo assim. Por isso cada caso abaixo registra: veredito formal, mecanismo, grau de evidência do mecanismo, e como o dado continua utilizável.

## 2. Resumo

| Id | Veredito formal | Mecanismo | Evidência do mecanismo | Uso do dado |
| --- | --- | --- | --- | --- |
| H4 | refutada (delta −0,171; IC [−0,375; 0,037]) | taxa condicionada à janela válida: o evasivo tem 84% das janelas inválidas e aproveita quase todas as válidas | pós-hoc, janelas cruas (seção 3) | usar a confiança e o volume de janelas junto com o domínio |
| H5 | indefinida (menor com 0 valores) | agressivo quase não gera defesas rotuladas | no próprio relatório (matriz da seção 3: 100% indefinido) | indefinição como sinal de estilo (pouca defesa) |
| H6 | indefinida (maior com 2 valores definidos) | aleatorio gera poucas defesas rotuladas por run: 97% das runs ficam abaixo do mínimo de evidência | no próprio relatório | falta de dado, não de efeito: o delta 1,000 só vale com n maior |
| M5 | indefinida (menor 100% indefinido) | `itemPickRate` depende de sobrevivência e geometria; o agressivo morre antes do primeiro item | `calibration.md` e decisão do autor de 2026-11-01 | métrica inválida para a característica "busca de itens" |

## 3. H4 em detalhe (análise pós-hoc)

A dimensão `punish` do perfil é a fração das janelas válidas de punição que o agente aproveitou. Uma janela é inválida quando está fora de alcance ou interrompida e não entra na conta. A H4 esperava que o bloqueador, que contra-ataca depois de defender, aproveitasse uma fração maior que o evasivo. O resultado foi o oposto fraco: delta −0,171, com o IC incluindo o zero.

O script `experiments/v0/exploratorio/h4-janelas-punish.ts` reexecuta os agentes com a configuração oficial (determinística) e conta as janelas cruas por run:

| Estilo | Aproveitadas | Perdidas | Expiradas | Inválidas | % inválidas | Taxa agrupada | Válidas/run (mediana) | Aproveitadas/min (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bloqueador | 1062 | 0 | 216 | 73 | 5% | 0,831 | 21 | 22,2 |
| paciente | 662 | 0 | 50 | 220 | 24% | 0,930 | 11 | 19,5 |
| evasivo | 399 | 0 | 1 | 2053 | 84% | 0,998 | 6 | 1,66 |
| agressivo | 98 | 0 | 109 | 4 | 2% | 0,473 | 3 | 9,5 |

Deltas de Cliff, bloqueador contra evasivo: taxa −0,983; janelas válidas por run +0,852; aproveitadas por minuto +1,000. Paciente contra evasivo: taxa −0,490; válidas por run +0,525; aproveitadas por minuto +1,000.

Leitura: a ordem entre os dois estilos **inverte** conforme se mede taxa ou volume. O evasivo quase não pune (1,66 janelas por minuto contra 22,2), mas as poucas janelas válidas que ele tem são as trocas de espada em que já se engajou, e nelas aproveita quase todas. O bloqueador tem muito mais oportunidades e perde cerca de 17% delas por expiração. A H4 confundiu taxa com volume. O valor oficial (−0,171) fica entre os dois extremos porque o domínio do perfil usa decaimento e priors, e as janelas cruas aqui não. Esta explicação não foi feita no relatório oficial; é pós-hoc.

No perfil final por agente (seção 2 do relatório) a diferença aparece na confiança: evasivo 0,338 (amostra 5,1) contra bloqueador 0,919 (amostra 112,9), com domínios próximos (0,859 e 0,815). O mesmo vale para a H3 (paciente > evasivo, confirmada): o paciente tem 24% de janelas inválidas e o evasivo 84%, de modo que parte da separação da H3 também vem da seleção de janelas.

## 4. Catálogo de modos de falha do perfil

Cada tipo é um caso concreto observado nesta execução, com o que ele ensina ao sistema de análise.

| Tipo | Casos | O que ocorre | O que o sistema deve fazer |
| --- | --- | --- | --- |
| Viés de seleção | H4 (e parte da H3) | a taxa é calculada só sobre janelas válidas, e o estilo controla quais janelas se tornam válidas | informar taxa e exposição (volume) separadas; ponderar o domínio pela confiança |
| Dado insuficiente | H5, H6 | poucas observações por run para a dimensão se definir | marcar o domínio como indefinido e não adaptar nessa dimensão |
| Métrica dependente de sobrevivência | M5 | o valor depende de o jogador viver até o evento acontecer | tratar a indefinição como informação (o jogador morre cedo) e não como zero |
| Indefinição como sinal de estilo | H1, H1u, H2u (confirmadas pela cláusula de indefinição), agressivo em `weapon_repertoire` | quem usa uma só arma ou ação não tem repertório; a dimensão fica indefinida por construção | distinguir "indefinido por falta de dado" de "indefinido porque o comportamento não existe" |

## 5. Implicações de projeto (propostas, não decisões)

Estas ideias dependem de decisão do autor e de um brainstorm antes de qualquer código.

1. **Dois canais por dimensão:** taxa (qualidade quando há oportunidade) e exposição (frequência das oportunidades), em vez de um número só.
2. **Confiança como parte do uso do perfil:** o consumidor do perfil (inimigo adaptativo e preditor) usa o domínio ponderado pela confiança; domínio de baixa confiança não pesa.
3. **Coleta ativa de dado:** quando a confiança de uma dimensão é baixa ou a fração de janelas inválidas é alta, o sistema de oportunidades pode criar a janela que falta, em vez de adaptar sobre ruído.
4. **Casos de falha como testes do preditor (5b):** os agentes cuja falha é conhecida (evasivo em `punish`, agressivo em itens e repertório) validam se o preditor reconhece perfis pouco confiáveis.

## 6. Limites desta leitura

- A análise de janelas cruas usa a mesma configuração e semente da execução oficial, mas é independente do pipeline do relatório; não foi comparada linha a linha com as janelas que alimentam o perfil.
- Uma execução (60 runs por agente) sustenta o mecanismo da H4; não há réplica com outra semente.
- A H4 não foi reformulada: a versão de volume proposta na seção 5 é para uma versão futura e precisaria de nova pré-registração.
