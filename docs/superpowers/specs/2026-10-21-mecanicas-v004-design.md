# Mecânicas v0.0.4: estamina, esquiva com timing, arco, lunge e itens — Design

**Data:** 2026-10-21
**Status:** rascunho para revisão do autor. Decisões do autor: estamina estilo Souls-like (ataque, corrida, bloqueio com custo menor, esquiva), *perfect dodge* devolve a estamina, velocidades (jogador caminhando 175, correndo 220; inimigos no mínimo 150), postura unificada na estamina, itens periódicos (cura, ataque bônus, bomba) que são pegos e usados, arco com projétil, *lunge* do Assaltante, regra das 8 ações só na análise, recuo como limitação. Valores numéricos são palpites do Claude (**[minha escolha]**) e ficam como constantes ajustáveis em playtest.
**Contexto:** `Contexto_pesquisa/documento-tecnico-mestre.md` §2 (catálogo de mecânicas), §4.8 (lacunas). Pré-requisito do refinamento de arte e animação: **as mecânicas precisam estar completas e congeladas antes**.

## 1. Intenção

Fechar a base de mecânicas do jogo para depois só refinar (animações, assets, som) e coletar dados oficiais. Critério do autor: **o jogo precisa ser fluido e ágil**; a estamina é o "teto" que dá estratégia sem engessar. Esta versão também corrige um defeito de projeto: hoje a esquiva **não exige timing** (uma esquiva apertada cedo demais ainda protege o golpe), então não existe "esquiva boa" para medir. E acrescenta o que falta ao perfil para ter mais comportamento observável: gestão de estamina, uso de itens, um segundo estímulo do inimigo.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- Barra de **estamina** única (substitui a barra de postura) com gasto em ataque, corrida, bloqueio (menor) e esquiva.
- **Corrida** (`Shift`) e **caminhada** como velocidades distintas.
- **Esquiva com timing**: só protege se os i-frames cobrirem o instante do golpe; ***perfect dodge*** devolve a estamina gasta.
- **Arco com projétil** e **segundo padrão do Assaltante** (*lunge*) contra a estratégia de fugir e atirar.
- **Itens** periódicos no mapa (cura, ataque bônus, bomba), pegos ao andar por cima e usados por tecla; usar item é a ação do tipo `utility`.
- **Métricas** de estamina e de itens no log, no painel e no relatório.
- Regra das 8 ações mínimas aplicada **na análise**, sem tocar a lógica.
- Versão `GAME_VERSION = 0.0.4`, V0 recalibrada e rodada de novo depois.

**Não-objetivos**
- Armas novas, outros arquétipos de inimigo, chefe, mapas e rotas, animações, som, nova dimensão de perfil (itens registram **oportunidades**; a dimensão fica para depois, com dados).
- Estamina em itens ou em troca de arma.
- Alterar o previsor, o perfil descritivo ou o formato do envelope do log.

**Anti-objetivos (falha mesmo que "funcione")**
- O combate ficar lento ou travado: com os custos escolhidos o jogador deve conseguir encadear **5 a 6 ataques leves** antes de zerar a estamina. Se o playtest disser que está pesado, os custos são constantes a baixar.
- Mudar a lógica sem subir a versão, ou quebrar a igualdade entre perfil ao vivo e perfil reconstruído do log.
- Um agente (ou o jogador) conseguir estratégia dominante sem custo (fugir e atirar sem risco; acumular item sem limite).
- Valores escolhidos por conveniência dos agentes da V0.

## 3. Restrições

- Lógica pura (sem Phaser, sem `visual/`); apresentação só em `scenes/`, `visual/`, `debug/`.
- Todo sorteio novo (posição e tipo de item, decisão de *lunge*) usa **PRNG semeado pela seed da run** (fluxo próprio, derivado dela) e é **registrado no log**; o jogo continua reproduzível.
- O envelope do log (`v:2`) não muda. Campos novos são aditivos, **com uma exceção declarada**: o contexto `p_poise` é substituído por `p_stam` (a postura deixa de existir). Leitores de logs antigos toleram a ausência do campo.
- A suíte atual (679 testes) muda **só onde o comportamento muda de propósito**; cada teste alterado é listado no relatório da tarefa. Nenhuma asserção do perfil, das oportunidades ou da telemetria é enfraquecida.
- Passo fixo de 1000/60 ms; todos os tempos em ms e as distâncias em unidades de mundo (64 por tile).
- Commits em Conventional Commits, sem trailer de co-autoria; mensagens aprovadas pelo autor.

## 4. Decisões

### 4.1 Velocidades (decisão do autor)

| | Valor |
|---|---|
| Jogador caminhando | **175** u/s |
| Jogador correndo (`Shift` segurado) | **220** u/s |
| Assaltante, perseguição | **150** u/s (mínimo do autor; antes 125) |
| Bloqueando | 50% da velocidade de caminhada (87,5) **[minha escolha]** |
| Dash (esquiva) | deslocamento 120 em 180 ms, como hoje |

Correr só enquanto se anda, em `idle`; para ao soltar `Shift`, ao zerar a estamina, ao atacar, bloquear ou esquivar. Enquanto corre, a estamina não regenera.

### 4.2 Estamina (Souls-like) **[valores: minha escolha]**

Barra de **100**. Um número: custo, cobrado quando a ação começa (o carregado, ao soltar).

| Gasto | Custo |
|---|---|
| Ataque leve / pesado / carregado / disparo | 12 / 22 / 28 / 8 |
| Corrida | 10 por segundo |
| Esquiva (dash) | 30 |
| Bloqueio: golpe absorvido | 15 (segurar a guarda e o *parry* **não** gastam) |
| Item | 0 |

- **Regeneração:** 35/s depois de **600 ms** sem gastar (e sem correr). Se a estamina **zerar**, o jogador fica **exausto** e a espera sobe para **1200 ms**.
- **Regra de início:** ataque, bloqueio levantado e corrida exigem estamina **> 0** (o custo pode levá-la a 0); a esquiva exige o **custo inteiro**. Quando a regra impede a ação, ela é negada e registrada.
- **Guard break:** se um golpe é bloqueado sem estamina suficiente para os 15, a guarda quebra: o *stagger* de 250 ms de hoje, estamina vai a 0. O *parry* continua sem custo.
- **A barra de postura (*poise*) deixa de existir**: as constantes `POISE_*`, o campo `p_poise`, a barra do HUD e o campo `playerPoise` das observações dos agentes são substituídos pela estamina.

### 4.3 Esquiva com timing e *perfect dodge*

- Os i-frames (150 ms desde o início do dash) protegem **somente** se o golpe conecta enquanto estão ativos. Uma esquiva cedo ou tarde demais não protege.
- O rótulo defensivo `dodge` e o desfecho `taken` da janela de esquiva são decididos **no instante do golpe** (esquiva que protege), não no instante do aperto. Esquiva que não protege não gera rótulo; o golpe vira acerto não mitigado (20 de dano e *stagger*). A inferência de `retreat` (janela expira sem contato e sem defesa) continua.
- ***Perfect dodge***: o golpe conecta com os i-frames ativos **e** o dash foi apertado nos **80 ms** anteriores (`PERFECT_DODGE_MS = 80`). A estamina do dash (30) é **devolvida** no instante da conexão; o evento `player.defense` ganha `perfect: true` (o rótulo continua `dodge`, então a dimensão defensiva segue com n = 4).
- A janela de punição não muda (não há prêmio extra além da estamina, como o autor pediu).

### 4.4 Arco com projétil **[valores: minha escolha]**

O disparo (`bow.shot`) cria um projétil: velocidade **500** u/s, vida útil que dá alcance **260**, hitbox circular de raio 8, **acerta o primeiro alvo** e some; dano 10, aplicado ao conectar (no máximo uma vez por projétil). Colisão varrida por passo (sem atravessar). O evento `player.action` continua saindo ao disparar; acerto e expiração são novos eventos (`projectile.hit`, `projectile.expire`). A contabilidade de **punição** passa a considerar o acerto do projétil no momento em que conecta (confirmar no código como o desfecho `taken` da punição é decidido hoje).

### 4.5 Segundo padrão do Assaltante: *lunge* **[valores: minha escolha]**

Nova regra de prioridade antes de `attack`/`chase`: quando a distância ao jogador está entre **150** e **260** e a recarga (**6 s**) acabou, o Assaltante inicia um *lunge*: telegrafia de **500 ms** (visível, abre a janela de esquiva), avança em linha reta na direção que o jogador estava no fim da telegrafia a **450** u/s por no máximo **260** unidades, causa 20 de dano e *stagger* se o corpo dele sobrepõe o do jogador (mesma defesa que o golpe comum: esquiva com i-frames, bloqueio com 15 de estamina, *parry*), e depois fica **500 ms** vulnerável (janela de punição, 750 ms se houve *parry*). Um novo estado `lunging` no autômato. Objetivo: acabar com o kiting e dar ao perfil um segundo estímulo.

### 4.5b Rótulos de oportunidade

As janelas de esquiva e punição do *lunge* usam os mesmos tipos de oportunidade (`dodge`, `punish`), com o campo adicional `attack_kind: 'swing' | 'lunge'` no evento de abertura, para a análise separar os dois estímulos.

### 4.6 Itens **[valores: minha escolha]**

- **Aparição:** a cada **20 s** de tempo de combate, enquanto houver menos de **2** itens no mapa; tipo sorteado entre `heal`, `power` e `bomb` com pesos iguais; posição sorteada na arena com margem de 80 das bordas, a pelo menos 120 do jogador e do inimigo. Some em **15 s** se não for pego. O sorteio vem do PRNG da run e é registrado (`item.spawn`).
- **Pegar:** andar por cima (sobreposição da hurtbox) com o **slot vazio**. Inventário de **1 slot**. Com o slot cheio o item não é pego (fica no mapa até expirar).
- **Usar:** tecla `F`, ação do tipo **`utility`** registrada no registro de ações como `item.use` (sem arma; **não** entra na dimensão de armas), tempo travado de 100 ms, custo 0. O uso consome o item.
  - `heal`: +30 de vida (teto 100). Pode ser usado com vida cheia (desperdício, também comportamento a observar).
  - `power`: dano das ações do jogador ×1,5 por **8 s**.
  - `bomb`: 30 de dano ao inimigo se ele estiver a até **120** do jogador, mais *stagger* de 250 ms nele (interrompe o golpe ou o *lunge*); não machuca o jogador.
- **Oportunidade `item`:** aberta na aparição e fechada como `taken` (pego), `expired` (sumiu) ou `invalid` (run termina). **Não** alimenta nenhuma dimensão agora.
- **Eventos novos:** `item.spawn {item_id, kind, x, y}`, `item.pickup {item_id, kind, wait_ms}`, `item.expire {item_id, kind}`, `item.use {kind, hp, dist_to_enemy, held_ms, effective}`. Ao usar, `obs.action` registra o tipo `utility` (sem arma).

### 4.7 Métricas **[definições: minha escolha]**

Novas métricas derivadas, nas mesmas quatro janelas do painel (encontro, run, sessão, histórico), no painel de análise e no relatório:
- **Estamina:** nível médio ponderado pelo tempo; fração do tempo com ≥ 80% (o quanto o jogador a mantém carregada); gasto por minuto; **gasto por tipo** (ataque, corrida, esquiva, bloqueio); tempo exausto; ações negadas por falta de estamina; *perfect dodges* (contagem e fração das esquivas bem-sucedidas); guard breaks.
- **Itens:** oferecidos e pegos (taxa), tempo até pegar, tempo guardado, usos por tipo, curas com vida cheia, bombas que acertaram.
- Fonte: campo `stam` nas amostras de posição (`pos.sample`, a cada 250 ms) e os eventos acima.

### 4.8 Regra das 8 ações, só na análise

Em `src/experiments/v0/windowValues.ts`, as três dimensões de entropia (`weapon_repertoire`, `action_repertoire`, `defensive_repertoire`) passam a devolver `domain: null` quando o tamanho de amostra da janela é **menor que `MIN_ACTIONS_FOR_ENTROPY = 8`** (parâmetro documentado). A lógica do jogo e o perfil ao vivo **não** mudam. Efeito: runs curtas ficam indefinidas nessas dimensões; o relatório mostra a fração.

### 4.9 Recuo

Continua **inferido** (janela de esquiva expirada sem contato e sem defesa); declarado como limitação no texto.

### 4.10 Agentes da V0

Fora desta spec: depois que as mecânicas fecharem, uma spec **V0.1** recalibra os sete agentes (que passam a gerir estamina, caminhar/correr e, se o autor quiser, coletar e usar itens) e roda a V0 de novo. A execução de hoje (versão `0.0.3`) fica arquivada como piloto.

## 5. Testes e aceitação

Todos em Node (Vitest), com os números acima:
- **Estamina:** custos por ação (leve 12, pesado 22, carregado 28 ao soltar, disparo 8, dash 30); regeneração 35/s só depois de 600 ms (1200 ms se zerou); sem regeneração enquanto corre; ação negada quando a regra de início não é satisfeita (evento registrado); guard break quando o bloqueio não é coberto; *parry* sem custo.
- **Velocidades:** caminhada 175, corrida 220 (e só em `idle`), bloqueando 87,5; Assaltante a 150.
- **Esquiva:** esquiva apertada 200 ms antes do golpe **não** protege; apertada 100 ms antes protege; apertada 60 ms antes é *perfect* (estamina devolvida, `perfect: true`); rótulo `dodge` e desfecho `taken` decididos no golpe; golpe não mitigado causa 20 de dano.
- **Arco:** o projétil percorre 500 u/s, some em 260 u, acerta o primeiro alvo uma só vez, não atravessa a hurtbox entre dois passos (colisão varrida); o desfecho de punição reconhece o acerto.
- **Lunge:** só dispara entre 150 e 260 e com a recarga pronta; telegrafia de 500 ms; percurso máximo 260; dano e *stagger* na sobreposição; esquiva com i-frames, bloqueio e *parry* funcionam; janela de punição de 500/750 ms; `attack_kind` no evento de abertura.
- **Itens:** o sorteio é determinístico pela seed; no máximo 2 no mapa; some em 15 s; pegar com slot cheio não pega; efeitos de cura, poder (×1,5 por 8 s) e bomba (raio 120, 30 de dano, *stagger*); `utility` conta em `obs.action` sem arma; oportunidade `item` fecha como `taken`/`expired`/`invalid`.
- **Log e perfil:** `stam` em `pos.sample`; eventos novos com os campos acima; `p_stam` no contexto; **perfil ao vivo = perfil reconstruído** (teste de replay existente) e **métricas ao vivo = métricas do log** (teste de equivalência existente) continuam verdes com bots que usam o novo conjunto.
- **Métricas:** cada métrica de §4.7 em dados sintéticos com valor exato.
- **Regra das 8 ações:** janela com 7 ações ⇒ `null`; com 8 ⇒ valor.
- **Não regressão:** a suíte existente passa, exceto os testes alterados de propósito, listados.
- **Playtest do autor (critério de pronto, qualitativo):** o jogo continua **fluido e ágil**; é possível encadear 5 a 6 ataques leves; a estamina cria decisões, não espera; o *perfect dodge* é possível e perceptível; o *lunge* é legível; os itens aparecem, são pegos e usados. Se algo parecer pesado, os custos são constantes.

## 6. Ordem de construção (um branch, uma versão)

Branch `mecanicas-v004`; `GAME_VERSION` sobe para `0.0.4` na primeira tarefa. Merge no `master` só quando tudo estiver completo.
1. **M1** estamina, velocidades, corrida, esquiva com timing, *perfect dodge*, remoção da postura (inclui HUD e contexto do log).
2. **M2** arco com projétil e *lunge* do Assaltante.
3. **M3** itens e a ação `utility`.
4. **M4** métricas no log, no agregador e no painel; regra das 8 ações na análise.
5. **M5** atualização dos agentes da V0 e re-execução (spec V0.1 à parte).

## 7. Deixado ao implementador

Organização dos módulos novos (`combat/stamina.ts`, `combat/projectile.ts`, `game/items.ts` ou equivalentes), nomes dos eventos além dos listados, como a colisão do projétil e do *lunge* é detectada, como o HUD mostra a estamina (barra simples; refinamento visual depois), e a forma de gerar o fluxo de PRNG dos itens a partir da seed da run.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Estamina deixa o combate lento (contra o objetivo de agilidade) | Custos baixos, constantes; playtest com critério explícito |
| Esquiva com timing frustra (janela de 150 ms é curta) | Parâmetros ajustáveis (`iframesMs`, janela de 80 ms do *perfect*); buffer de 120 ms já existe |
| Muita mecânica de uma vez muda o balanceamento de formas imprevistas | Uma tarefa por sistema, testes com números, playtest antes de congelar |
| Agentes da V0 deixam de funcionar | M5 dedicado; testes de fumaça dos bots em cada tarefa |
| Itens viram estratégia dominante (bomba constante) | Máx. 2 no mapa, 1 slot, 20 s de intervalo; constantes |
| Renomear `p_poise` quebra leitores | Leitores toleram campo ausente; teste com log antigo |

## 9. Decisões do autor (resolvidas em 2026-10-21: seguir as recomendações)

1. Todos os valores numéricos de §4 (custos, tempos, raios) como ponto de partida, a ajustar no playtest.
2. Se a V0.1 deve incluir comportamento de coleta e uso de itens nos agentes (recomendo que sim, para validar as métricas de itens).
3. Se a oportunidade `item` deve virar, depois, a **sétima dimensão** do perfil (aproveitamento de itens, no lugar da de uso de espaço).

## 10. Divergências do plano e rulings

Registro do que a implementação decidiu de forma diferente do texto acima ou onde a spec era aberta (21/10/2026, tarefas 1 a 9). O documento técnico mestre (`Contexto_pesquisa/documento-tecnico-mestre.md`) traz os valores finais.

1. **Itens não são um `OppType`.** A §3 falava em oportunidade `item`; na implementação os itens têm eventos próprios (`item.spawn`, `item.pickup`, `item.expire`, `item.use`), gravados sem `ctx`, e **não** entram no sistema de oportunidades. A conservação vale **por run** (`spawn = pickup + expire`); **runs abandonadas** (aba fechada) ficam isentas, porque seus itens nunca ganham `pickup` nem `expire`. O item que está no slot ao fim da run já tem o seu `pickup`, e os do chão expiram com `reason: 'run_end'`.
2. **O tipo de ataque (`attack_kind`) vive em `enemy.attack_start.kind`** (`swing` ou `lunge`), não em `opp.open`.
3. **Recarga do *lunge*:** conta a partir do **início** do *lunge* anterior (não do fim) e **começa no nascimento e no renascimento** do inimigo, de modo que o primeiro *lunge* só sai 6000 ms depois do spawn.
4. **Regra de crédito da esquiva:** o crédito sai no golpe. No **primeiro tick** de aterrissagem a invulnerabilidade basta; nos ticks seguintes do mesmo golpe exige também sobreposição do leque com o jogador (impede que um dash apertado depois do golpe renda rótulo e reembolso). No *lunge*, a aterrissagem conta também a **proximidade com a posição do jogador na trava da mira**, para que um dash lateral bem temporizado seja `dodge` (e `perfect` se ≤ 80 ms) e não `retreat`. Um dash lateral que sai do raio de contato (60) antes do corpo chegar continua sendo `retreat`.
5. **Orçamento fixo do PRNG dos itens:** cada compasso de surgimento sorteia **1 tipo e 10 posições candidatas** uma única vez; as candidatas ficam pendentes até uma passar nas distâncias mínimas. O consumo do PRNG não depende da trajetória do jogador. Semente: `seed ^ 0x1e7e55` da run. Com 2 itens no mapa o compasso é pulado.
6. **Regra das 8 ações na análise usa contagens brutas:** conta eventos `obs.action` (dims 1 e 2) e `obs.defense` (dim 4) da janela, depois do último `obs.reset`, e **não** o `sampleSize` decaído (a decadência subestimaria runs de várias salas). Para o repertório de armas (dim 1) conta **só** as ações com `weaponId`, então o `utility` não ajuda a atingir 8. O repertório de ações (dim 2) conta todo `obs.action`, inclusive `utility`. O `sampleSize` informado segue decaído. Vale só na análise offline; o perfil ao vivo do jogo não muda.
7. **`pickRate` exclui expirações `run_end`:** o fim da run censura o item, então elas são contadas à parte (`expiredRunEnd`) e a taxa é `pegos ÷ (pegos + expirados por timeout)`. Acrescentadas as métricas `healsAtFullHp` e `bombHits`.
8. **Agentes da V0:** ficam **cegos ao *lunge*** (o estado `lunging` não é tratado como ameaça) e **não usam corrida nem itens** até a spec da V0.1. Eles respeitam a estamina (não apertam ataque em 0, não bloqueiam em 0, não esquivam com menos de 30).
9. **Resultados da V0 de 21/10/2026 (versão `0.0.3`):** são um **piloto arquivado**, não comparável com a `0.0.4`. A re-execução depende da spec da V0.1.
10. **Detalhes de implementação úteis ao leitor:** ataque ou guarda só são negados com estamina **0** (com valor parcial o gasto é limitado ao que resta); a esquiva exige 30; entradas negadas nunca vão ao buffer; o ataque carregado só cobra ao soltar; o projétil do arco é varrido no mesmo tick em que nasce; o gasto de estamina depois da última amostra de uma run não é logado.

11. **Bomba durante a janela de punição:** fecha a janela como `invalid`/`source_interrupted` (não `taken`) e encurta a recuperação para 250 ms a partir desse instante (decisão de projeto). A morte do inimigo pela bomba é tratada um tick depois pelo `RunDirector` (documentado).
12. **`spent.dodge` ainda conta os 30 da esquiva perfeita**, então `spentByKind.dodge` e `spentPerMinute` superestimam o gasto com esquiva; o reembolso aparece em `player.defense.refund`.
13. **Previsão de ameaça do *lunge* ciente da geometria:** em `lunging` (telegrafia ou avanço) `msUntilThreatens` só devolve tempo se o alvo estiver a até `maxTravel + contactDistance` (320) do inimigo (centro a centro); do contrário `null`. A janela de esquiva do *lunge* é fechada (expiração normal) no primeiro passo depois que o avanço termina, e o `Encounter` só infere `retreat` para a janela do ataque corrente.
14. **Problema conhecido (M8), anterior a este branch:** após um *parry* a janela de punição dura 750 ms, mas o inimigo volta a `idle` aos 500 ms e zera `activeOppId`: golpes entre 500 e 750 ms não resolvem a janela como `taken`, e um novo ataque pode abrir enquanto ela segue aberta. A revisitar.
15. **Nota para a V0.1:** a política da V0 quebra com cura (`readOwnBody` trata qualquer subida de HP como uma nova run).
