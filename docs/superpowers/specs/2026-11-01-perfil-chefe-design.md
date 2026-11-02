# Perfil → chefe: validade dos hábitos e escalada com teto (design)

Data: 2026-11-01. Estado: rascunho para aprovação do autor. Marcação: **[autor]** = decisão dita pelo autor; **[proposta]** = valor ou escolha minha, a revisar; o restante é consequência direta dessas duas.

## 1. Intenção

O produto da tese é o sistema de análise: o perfil do jogador (dimensões + preditor). O chefe valida esse sistema, mostrando que o perfil serve para alguma coisa. A ideia central: quanto mais o jogador joga, mais o chefe o pune, **porque o perfil entendeu seus hábitos** (de uma run para a outra), e não porque o chefe é mais forte.

Os resultados da V0.1 (`experiments/v0/results/2026-11-01/LEITURA.md`) mostram por que isso exige um teste de validade: um valor alto de domínio com poucas amostras engana (o evasivo parece tão bom em punir quanto o bloqueador). Então o chefe não pode agir sobre qualquer número do perfil, só sobre hábitos que passem por um critério de validade.

## 2. Objetivos

1. O chefe luta no padrão (behavior tree) por default. O perfil só altera esse comportamento quando um hábito é válido. **[autor]**
2. O primeiro encontro do jogador com o chefe serve só para coletar dados: o chefe é padrão. Nenhuma decisão baseada em perfil acontece antes de o jogador ter enfrentado o chefe ao menos uma vez, em qualquer run. **[autor]**
3. A escalada de cada resposta tem degraus e tetos, para o chefe não ser injusto. **[autor]**
4. Quando o jogador para de repetir o hábito, a pressão cai aos poucos. **[autor]**
5. A memória atravessa runs (o perfil já é reconstruído a partir do log a cada sessão). **[autor]**
6. Cada decisão do chefe deve ser rastreável até o hábito e a evidência que a motivou (para a tese poder mostrar que o perfil causou o comportamento).
7. Este projeto inclui um **chefe base mínimo** (sala depois de 3 encontros, behavior tree, poucos ataques e avanço), construído como subproduto e como método de avaliação e comprovação do sistema de perfil, não como peça de conteúdo final. **[autor: "o chefe seria interessante, como um subproduto e método de avaliação e comprovação do sistema"]** Chamada minha: o chefe base fica o mais simples possível, só o bastante para as três respostas de 6.3 terem onde agir; polimento, variedade de ataques e arte ficam para depois.

## 3. Não-objetivos

- Persistência no Supabase: fica para depois; o armazenamento atual (log NDJSON) basta. **[autor]**
- Arte, animações e efeitos: depois que o sistema estiver fechado. **[autor]**
- Qualquer adaptação do elite comum (o elite não se adapta; só o chefe futuro).
- Mudar as seis dimensões atuais do perfil ou os vereditos da V0.1.
- Seleção automática de alvo e pesos de regra por otimização (passos 6 e 7 do plano antigo): este desenho os substitui por regras explícitas com teto.

## 4. Anti-objetivos (seria falha mesmo que "funcione")

- O chefe mudar por causa de um número com pouca evidência (ex.: três esquivas por acaso).
- Uma resposta tão forte que o jogador sinta injustiça (barragem em toda oportunidade, pressão que nunca alivia).
- A dificuldade subir sem que o jogador consiga ligar a causa ao próprio hábito.
- Chefe que muda de comportamento na primeira vez que o jogador o enfrenta.

## 5. Contexto existente

- Estrutura: três encontros por sala; a sala do chefe vem depois **[autor: "ao final de 3 encontros tenha uma sala de boss"]**. `RunDirector` mantém `runIdx`, `roomIdx`, `encIdx` e não reseta o perfil.
- Perfil: seis dimensões (`weapon_repertoire`, `action_repertoire`, `punish`, `defensive_repertoire`, `distance`, `patience`). `ProfileView` expõe `domain`, `confidence`, `deficit`, `omission` e `sampleSize` por dimensão e por relógio (traço, que decai por sala; estado, que decai por encontro).
- O snapshot `boss.entry` já existe no esquema de telemetria, com `target` sempre `null` e `lambda` sempre 0 hoje.
- As regras do assaltante (`assaltanteRules.ts`) usam só o estado de combate e pesos fixos. O perfil não dirige nenhum inimigo hoje.
- O dash do jogador tem hoje cooldown de 160 ms (`DODGE`); este desenho o muda (6.3). O parry dá 750 ms de recuperação extra ao inimigo (`PARRY_BONUS_RECOVERY_MS`).

## 6. Desenho

### 6.1 Porta de entrada (gate)

Uma função de decisão do chefe só olha o perfil se o jogador já enfrentou o chefe ao menos uma vez. Antes disso, nenhuma regra adaptativa está ativa. O gate depende de "já enfrentou o chefe", não do número da run. **[autor]** A informação "enfrentou o chefe" tem de sobreviver ao reinício do jogo, vindo do log (a mesma fonte do perfil). **[chamada minha]** "Enfrentou" = o log tem um `boss.entry` do jogador na `GAME_VERSION` atual, mesmo que ele tenha morrido ou abandonado a luta depois; o que conta é ter visto o chefe. Logs de versões antigas do jogo e os agentes sintéticos de outras versões não contam (o perfil já filtra por versão).

### 6.2 Hábitos e sua validade

Um **hábito** é um comportamento nomeado do jogador que mapeia para uma resposta do chefe. Dois tipos:

1. **Hábito de dimensão:** vem de uma dimensão do perfil (por exemplo, esquiva excessiva, distância longa, defesa passiva). Fica válido quando a dimensão tem confiança acima de um limiar **e** o sinal aparece em várias runs, não numa só. **[autor: "se repetir o hábito em várias runs, e não só numa"]**
2. **Vício de tempo:** um padrão de tempo que nenhuma dimensão captura; o exemplo do autor é usar o dash logo que o cooldown acaba e repetir isso sem necessidade. **[autor]** Um detector próprio mede a regularidade do padrão e o marca como vício. A decisão do chefe continua só a partir da regra 6.1 (depois do primeiro encontro com o chefe). **[autor]**

Valores iniciais, a revisar **[proposta]**:
- "Várias runs" = o sinal acima do limiar em pelo menos 3 runs distintas. Contam todas as runs do log na `GAME_VERSION` atual, inclusive as que terminaram antes de chegar ao chefe (o perfil é feito do log, não só das lutas contra o chefe). **[chamada minha]**
- Limiar de confiança: 0,6.
- O vício de tempo é a exceção de "reconhecido logo na primeira run" **[autor]**: vale com pelo menos 10 ocorrências numa única run, agindo só depois do gate de 6.1.
- Todos esses números ficam numa configuração única, com um preset de demonstração/playtest mais baixo (por exemplo 1 run), para o sistema ser visível em sessões curtas. **[chamada minha]**

A validade é avaliada por hábito, com histerese: um hábito já válido só deixa de ser válido quando a evidência cai bem abaixo do limiar de entrada, para o chefe não oscilar. **[proposta]**

### 6.3 Respostas do chefe (três, todas novas)

Cada resposta tem um nível de 0 a 1 por hábito, que cresce com a evidência e tem um teto **[autor]**.

| Hábito | Resposta | Degraus |
| --- | --- | --- |
| Fica muito afastado | O chefe avança rápido e fecha o espaço | velocidade de avanço sobe com o nível, até o teto |
| Abusa da defesa passiva (fica parado se defendendo) | Barragem de ataques, só quando o chefe encontra essa janela | 1) a frequência com que a barragem acontece sobe, **nunca em toda oportunidade**; 2) se o jogador continua abusando mesmo com a frequência no teto, a duração dos ataques aumenta, até um segundo teto **[autor]** |
| Abusa da esquiva (dash) | Cooldown do dash do jogador maior e avanço mais rápido do chefe, o que empurra o jogador para o bloqueio e o parry | o cooldown sobe de 2,5 s (base) até 4 s e o avanço cresce com o nível; 4 s é o valor máximo **[autor]**, e os degraus intermediários são **[proposta]** |

**Cooldown base do dash: 2,5 s, em toda situação** (salas comuns e chefe), no lugar dos 160 ms atuais. **[autor]** Isso é uma mudança de mecânica, não uma resposta do chefe: vale para todos os jogadores. A resposta à esquiva em excesso só sobe o cooldown de 2,5 s até 4 s, e só na sala do chefe. **[chamada minha: a leitura de que o 4 s do autor é o teto acima da nova base]**

O parry continua sendo o contrapeso: acerta sem custo de stamina e deixa o chefe vulnerável (hoje 750 ms de recuperação extra).

Valores dos tetos **[proposta]**, para o construtor refinar com playtest: barragem em no máximo 50% das janelas; duração dos ataques da barragem até 1,5× do normal; avanço até 1,4× da velocidade normal.

### 6.4 Alívio gradual

Quando o hábito deixa de aparecer, o nível da resposta cai aos poucos **[autor]**. A queda deve vir do decaimento que o perfil já tem (o traço decai por sala), somado à histerese de 6.2, sem um mecanismo separado de relaxamento, a menos que o playtest mostre que isso não basta. **[proposta]**

### 6.4b Momento da decisão e combinação **[chamadas minhas]**

- Os níveis são calculados uma vez, na entrada da sala do chefe, a partir do snapshot `boss.entry` (que passa a carregar os níveis em vez de `target`/`lambda` nulos). Durante a luta eles ficam congelados; o que o jogador faz na luta entra no perfil para a próxima. Isso mantém o comportamento rastreável e testável como função pura.
- Até **2 respostas** ao mesmo tempo, as de maior nível. As demais ficam em zero naquela luta. O número é um parâmetro de playtest.
- Ao ficar válido, um hábito começa no primeiro degrau não nulo (nível 0,2) e sobe daí até o teto.

### 6.5 Rastreabilidade

Cada vez que uma regra adaptativa muda o comportamento do chefe, o log registra qual hábito, qual nível, e a evidência (domínio, confiança, número de runs) que justificou. Isso permite à tese mostrar a ligação causal entre perfil e comportamento. **[chamada minha]** Nesta fase não há sinal para o jogador dentro do jogo; ele fica para a fase de HUD e arte, para não reabrir o redesenho do HUD pendente. A rastreabilidade é só no log.

### 6.6 Reaproveitamento da V0.1

Os agentes sintéticos da V0.1 viram o teste do sistema: cada estilo deve produzir o hábito esperado (o evasivo → esquiva, o agressivo → defesa quase nula, o bloqueador → defesa passiva) e o chefe deve reagir na segunda luta, não na primeira. Os modos de falha do catálogo (`LEITURA.md`, seção 4) são casos de teste negativos: poucas amostras não podem ativar uma resposta.

## 7. Restrições

- TypeScript 5.9 estrito, Phaser 3.90, Vite 5, Vitest 2; passo fixo de 60 Hz; barramento de eventos existente.
- A lógica do chefe deve ser testável sem Phaser, como o restante do jogo; o perfil e as regras seguem puros.
- `GAME_VERSION` sobe quando o comportamento muda; o filtro por versão do perfil continua valendo. A mudança do cooldown do dash para 2,5 s é mudança de mecânica e sobe a versão (sugestão: 0.0.6). **[chamada minha]**
- A V0 e a V0.1 foram executadas na 0.0.5 e seus resultados arquivados não mudam. Os agentes sintéticos, porém, vão se comportar diferente com o dash de 2,5 s (principalmente o evasivo); o teste de 6.6 usa a versão nova, e qualquer nova rodada de experimento precisa de nova pré-registração. Nunca reexecutar a V0.1 `--full` nem usar as sementes 20261019 e 20261105 em testes.
- As hipóteses e resultados pré-registrados da V0 e V0.1 não mudam.

## 8. Fica para o construtor

- O chefe base mínimo: entidade, sala depois de 3 encontros, behavior tree default, conjunto pequeno de ataques com telegraph, vida e condição de vitória. Deve ficar o mais simples possível (ver objetivo 7); o construtor propõe os valores e o autor valida no playtest.
- Como os testes do dash de 2,5 s afetam a stamina, os agentes sintéticos e o balanceamento do combate atual (o parry e o bloqueio passam a ser o caminho principal de defesa).
- Como os níveis (0 a 1) crescem com a evidência (forma da curva), dentro dos tetos acima.
- Os degraus intermediários do dash e do avanço.
- A definição exata de "defesa passiva" e de "muito afastado" a partir das dimensões existentes (`defensive_repertoire`, `distance`, `patience`) e dos eventos já registrados.
- A definição exata do vício de tempo (por exemplo, intervalo entre o fim do cooldown e o próximo dash, sem telegraph ativo).
- Como o chefe "encontra" a janela de defesa passiva na behavior tree.
- A estrutura do detector e dos eventos de rastreabilidade no log.
