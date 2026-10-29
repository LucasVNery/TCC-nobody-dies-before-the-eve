# Combate v2: fluxo, monstro de elite e feedback visual (0.0.5) — Design

**Data:** 2026-10-29
**Status:** rascunho para revisão do autor. Decisões do autor nesta rodada (playtest da 0.0.4 e resposta ao guia de pesquisa): **um inimigo por vez, forte, como monstro de elite**; **estamina máxima 150**; adaptação **somente no chefe**, com os inimigos comuns/elite apenas coletando dados e o perfil persistindo entre dias. Valores numéricos marcados **[minha escolha]** são palpites do Claude a calibrar em playtest.
**Contexto:** playtest da 0.0.4 (movimento bom; combate "injusto" e "travado" pelo fluxo; pouco feedback; hitbox de depuração feia); guia `docs/pesquisa/Fluxo de combate em jogos de ação.md` (fontes fracas: os números são hipóteses, não valores publicados); `2026-10-21-mecanicas-v004-design.md`.

## 1. Intenção

Tornar o combate mais fluido, legível e justo **sem mudar o objetivo do jogo**: ele é um instrumento que coleta o perfil do jogador. Três frentes: (1) **fluxo**: o que o jogador sente como "travado" (compromisso longo, buffer curto, esquiva que não cancela a recuperação) e como "injusto" (telegraph curto, janelas apertadas); (2) **um monstro de elite** no lugar do Assaltante comum: um único inimigo forte, com mais padrões de ataque e mais janelas de oportunidade por minuto; (3) **feedback visual de produção** no lugar da hitbox de depuração (a arte final continua para a fase de refinamento visual).

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- Estamina máxima **150** (costos e regeneração reescalados, §4.1).
- Janelas e buffer mais generosos, definidos em **milissegundos** (§4.2).
- **Monstro de elite** único por encontro, claramente mais forte que um inimigo comum (§4.3).
- Feedback visual: arco do golpe, indicador de telegraph no chão, flash e tremor, hit-stop, números de dano; hitboxes de depuração só por tecla (§4.4).
- Registro de uma **versão de configuração** em `session.start` e nas janelas medidas em milissegundos, para a comparabilidade dos dados (§4.5).
- Preservar o aprendizado do perfil entre sessões e runs (já existe) e deixar claro que a adaptação é só do chefe (§4.6).

**Não-objetivos**
- Vários inimigos simultâneos e fichas de ataque (a pesquisa os recomenda, mas o autor decidiu manter um inimigo por vez; ficam como extensão futura, §8).
- O chefe, o previsor (5b) e qualquer adaptação do inimigo ao perfil; arte final, animações e áudio de produção.
- Nova dimensão de perfil; mudar o formato do envelope do log.

**Anti-objetivos (falha mesmo que "funcione")**
- O combate ficar mais lento ou o inimigo virar esponja de HP: o encontro com a elite deve durar de 40 a 70 s para um jogador médio **[minha escolha]**.
- A elite ser injusta de outro jeito (ataques sem aviso, golpes seguidos sem chance de reação).
- O feedback virar ruído que esconde o telegraph.
- Mudar janelas/tempos sem subir a versão de configuração.
- Quebrar a igualdade entre perfil ao vivo e perfil reconstruído, ou a conservação de oportunidades.

## 3. Restrições

- Lógica pura fora de `scenes/`, `visual/`, `debug/`; passo fixo de 1000/60 ms; **tempos em ms** em todas as constantes (conversão para ticks só dentro do motor).
- Commits em Conventional Commits, sem trailer de co-autoria; mensagens aprovadas pelo autor; nada de push; `.claude/` fora dos commits.
- Todo sorteio novo (escolha de padrão da elite) usa PRNG semeado pela seed da run e é registrado no log.
- A suíte (858 testes) só muda onde o comportamento muda de propósito, listados; nenhuma asserção do perfil, das oportunidades ou da equivalência ao vivo/log é enfraquecida.
- `GAME_VERSION` sobe para `0.0.5`; dados da 0.0.3 e 0.0.4 não são comparáveis com a 0.0.5.

## 4. Decisões

### 4.1 Estamina 150 **[minha escolha, exceto o máximo]**

Máximo **150** (decisão do autor). Custos mantidos (leve 12, pesado 22, carregado 28, disparo 8, esquiva 30, golpe bloqueado 15, corrida 10/s); regeneração de 35 para **50/s**, espera de 600 ms (1200 ms se zerou) mantida. Efeito: cerca de 12 ataques leves seguidos ou 5 esquivas seguidas, com recuperação em ~3 s (antes: 8 ataques e 3 esquivas, ~2,9 s). Playtest pode pedir regen 45 a 60.

### 4.2 Fluxo e janelas **[valores: minha escolha, derivados do guia; o autor explicou que não entendeu "i-frames" e "ticks": ver nota]**

| Parâmetro | Hoje | Proposto |
|---|---|---|
| Invulnerabilidade (i-frames) da esquiva | 150 ms | **200 ms** (a esquiva dura 180 ms; passa a durar 220 ms com o mesmo deslocamento de 120 u) |
| Janela do *perfect dodge* | 80 ms | **110 ms** |
| Janela do *parry* | 150 ms | 150 ms (mantida) |
| Buffer de input | 120 ms | **170 ms**, limpo ao levar golpe ou *stagger* |
| Esquiva cancela a recuperação de ataque | só no fim | **a partir do fim da fase ativa** (já cancela hoje o que está em recuperação; passa a valer também nos últimos 60 ms da fase ativa) |
| Esquiva durante o *cooldown* de 200 ms | bufferizada | bufferizada (mantido) e *cooldown* **160 ms** |
| Movimento durante a recuperação | nenhum | **40% da velocidade** nos últimos 50% da recuperação (cancelável) |

Nota para o autor: *i-frames* são os instantes em que o jogador está invulnerável durante a esquiva; o jogo simula em passos de 1/60 s (~16,7 ms, "ticks"); por isso 150 ms são ~9 passos e 200 ms são 12. "Definir em ms" só significa que as constantes são escritas em milissegundos (como já são) e convertidas para passos dentro do motor, para o resultado não depender da taxa de quadros.

### 4.3 Monstro de elite (substitui o Assaltante comum) **[valores: minha escolha]**

Um inimigo por encontro, mais forte e com mais variedade:

| Atributo | Assaltante (hoje) | Elite |
|---|---|---|
| HP | 60 | **160** |
| Perseguição | 150 u/s | 150 u/s |
| *Stagger* | qualquer golpe interrompe | **só *parry*, carregado e bomba** (golpes leves e pesados não o interrompem; o dano vale) |

Padrões de ataque (cada um abre uma janela de esquiva `dodge` e, ao fim, uma de punição `punish`; `enemy.attack_start.kind` ganha `combo` e `slam`):
1. **Golpe** (*swing*), como hoje, com telegraph de **450 ms**, 20 de dano.
2. **Combo duplo** (`combo`): dois golpes encadeados, o segundo **320 ms** depois do primeiro (o segundo é anunciado por um novo brilho no fim do primeiro), 20 de dano cada.
3. ***Lunge*** (já existe), telegraph 500 ms, 20 de dano.
4. **Pancada em área** (`slam`): indicador circular no chão (raio 110 u), telegraph **700 ms**, 30 de dano; esquivar com i-frames ou sair da área protege.

Regras de ritmo para justiça **[minha escolha]**: depois de qualquer padrão há uma **pausa obrigatória de 700 ms** em que ele só se move (nunca dois padrões sem intervalo); o combo é o único que pode ter dois golpes seguidos; nenhum padrão começa a menos de 600 ms do fim de um *stagger*; a escolha do padrão é sorteada pelos pesos (golpe 4, combo 2, lunge 2 quando a distância está entre 150 e 260, pancada 1.5) com o PRNG da run. Primeiro ataque só 2 s depois de nascer (hoje: 6 s para o *lunge*; a elite usa o mesmo tempo de espera inicial de 2 s para todos os padrões).

Estrutura de jogo (aprovada pelo autor em 2026-10-29): o encontro continua sendo "uma morte do inimigo = encontro encerrado"; **2 encontros por sala** (antes 3), porque cada encontro dura bem mais e gera mais janelas de oportunidade; a run tem **3 salas e uma sala do chefe**. A sala do chefe é um não-objetivo desta spec (E4/5b): até ela existir, a run continua com salas de elite depois da terceira, como hoje.

### 4.4 Feedback visual (placeholder de produção) **[parâmetros: minha escolha, derivados do guia; todos são constantes]**

- **Arco do golpe** do jogador e do inimigo desenhado a partir dos **mesmos parâmetros** da hitbox lógica (raio e meia-abertura), com duração igual à fase ativa; no lugar do polígono de depuração.
- **Telegraph** de cada padrão da elite: o indicador no chão (cone, linha do *lunge*, círculo da pancada) cresce/encontra o preenchimento exatamente até o golpe; mudança de silhueta/brilho do inimigo no primeiro quadro.
- **Impacto:** *hit-stop* em passos de simulação (leve 2, pesado 4, carregado 5, golpe sofrido 4, *parry* e *perfect dodge* 5), com no máximo um *hit-stop* a cada 100 ms; flash branco de 100 ms no alvo; tremor de câmera de 4 px (comum) a 9 px (pesado/pancada), decaindo em ~250 ms; números de dano flutuantes.
- **Estados do jogador:** feedback de *perfect dodge* (anel breve + som), esquiva sem estamina negada (barra pisca), exausto (tinta e barra vermelha), item usado (anel colorido), poder ativo (aura).
- **Depuração:** as hitboxes e setores passam a aparecer só com a tecla `F3` (desligadas por padrão).
- O *hit-stop* é um contador de passos **dentro da simulação** (a simulação do inimigo e do jogador congela, o tempo do log também); flash e tremor correm em tempo real.

### 4.5 Versão de configuração e comparabilidade

`session.start` ganha `config_version` (string curta, `0.0.5-c1`) e `windows_ms` {`iframes`, `perfect`, `parry`, `buffer`, `telegraph_swing`, `telegraph_combo`, `telegraph_lunge`, `telegraph_slam`}. A estamina no momento da abertura de cada janela já está em `ctx.p_stam`. Mudou qualquer valor de §4.1 a §4.3 depois de ter dados ⇒ nova `config_version`.

### 4.6 Perfil, aprendizado e chefe (esclarecimento, sem código novo)

- O sistema **usa todos os inimigos** (a elite hoje; inimigos comuns e o chefe depois) **para coletar dados**; o perfil é o mesmo para todos.
- O perfil **persiste entre sessões e dias**: é reconstruído do log armazenado (IndexedDB) a cada abertura, com decaimento do traço por sala (γ = 0,87) e do estado por encontro (γ = 0,55); quanto mais o jogador joga, mais o perfil se firma. Isso já existe e não muda.
- A **adaptação** (chefe que escolhe golpes segundo o perfil) vale **somente para o chefe** (E4/5b). A elite desta spec **não adapta**: seus pesos de padrão são fixos.

## 5. Testes e aceitação

Todos em Node (Vitest), com os números acima:
- **Estamina:** máximo 150; regeneração 50/s só depois de 600 ms (1200 ms se zerou); custos inalterados; reinício de run restaura 150.
- **Janelas:** esquiva protege com i-frames de 200 ms (dash 190 ms antes do golpe protege; 230 ms não); *perfect* em ≤ 110 ms; buffer de 170 ms (um ataque apertado 160 ms antes executa; 180 ms não); buffer limpo ao levar golpe/*stagger*; esquiva cancela nos últimos 60 ms da fase ativa; movimento a 40% nos últimos 50% da recuperação; *cooldown* de 160 ms.
- **Elite:** HP 160; golpes leves/pesados não causam *stagger*, *parry*/carregado/bomba sim; cada padrão (golpe 450 ms, combo com segundo golpe 320 ms depois, *lunge*, pancada 700 ms raio 110) abre sua janela `dodge` e fecha como `taken`/`expired`/`invalid` pelas regras existentes; pausa obrigatória de 700 ms entre padrões; primeiro ataque só após 2 s; escolha por pesos determinística pela seed; conservação de oportunidades em morte do jogador, da elite, bomba e fim de run; `enemy.attack_start.kind` com `combo` e `slam`.
- **Log:** `config_version` e `windows_ms` em `session.start`; envelope `v:2` inalterado; logs antigos sem esses campos continuam legíveis.
- **Perfil e métricas:** perfil ao vivo = reconstruído; métricas ao vivo = log; as dimensões não quebram com os novos `kind`.
- **Visual (não automático):** playtest do autor: o combate parece fluido e justo; o arco e o telegraph batem com o que acerta; o *hit-stop* não prende; as hitboxes só aparecem com `F3`. Um teste de unidade garante que o contador de *hit-stop* congela a simulação pelo número exato de passos e que dois impactos em < 100 ms não somam.
- **Não regressão:** a suíte existente passa, exceto os testes alterados de propósito, listados.

## 6. Ordem de construção (um branch, uma versão)

Branch `combate-v2`; `GAME_VERSION = 0.0.5` na primeira tarefa.
1. **C1** estamina 150 e janelas/buffer/cancelamentos/movimento na recuperação, `config_version`.
2. **C2** monstro de elite (padrões, pausa, *stagger*, pesos, 2 encontros por sala) e ajustes dos agentes V0 só para continuarem jogáveis (como a Tarefa 9 da 0.0.4).
3. **C3** feedback visual (arcos, telegraphs, *hit-stop*, flash, tremor, números, `F3`).
4. **C4** métricas/painel para os padrões novos e documentação.

## 7. Deixado ao implementador

Módulos novos (`combat/hitstop.ts`, `combat/elite*.ts` ou equivalentes), a forma do indicador visual de cada padrão, como o painel mostra `kind`, e a ordem interna dentro de cada bloco.

## 8. Riscos e extensões futuras

| Risco | Mitigação |
|---|---|
| A elite vira esponja (HP 160) e o combate fica lento | meta de 40 a 70 s por encontro; HP é constante; playtest |
| A elite parece injusta por combo e pancada | telegraph ≥ 450 ms, pausa de 700 ms, combo só com segundo golpe anunciado; todas as janelas > tempo de reação humano |
| Mudar as janelas muda os limiares do perfil | `config_version` e dados por versão |
| *Hit-stop* congelar demais | teto de um a cada 100 ms; valores constantes |
| Os agentes da V0 deixam de funcionar | C2 inclui a compatibilidade; a V0.1 refaz a calibração |

**Extensão futura (não desta spec):** salas com vários inimigos comuns e fichas de ataque (1 ou 2 atacando), como o guia recomenda, se o autor quiser mais tarde; o chefe preditivo (E4/5b).

## 9. Decisões do autor ainda abertas

1. ~~Confirmar "mantém apenas 1"~~ **CONFIRMADO em 2026-10-29**: um único inimigo por encontro, que é a elite.
2. ~~Número de encontros por sala e duração-alvo~~ **FEITO em 2026-10-29**: 2 encontros por sala, 3 salas e uma sala do chefe, luta de 40 a 70 s.
3. ~~Valores de §4.2 e padrões/danos da elite~~ **APROVADOS em 2026-10-29** (i-frames 200 ms explicados e aceitos).
4. Regeneração da estamina de 150 (proposta 50/s): aceita junto com o resto; ajustar em playtest.

## 10. Divergências do plano e rulings

Registradas ao fim da implementação (branch `combate-v2`, 2026-10-29). Onde esta seção contradiz §4, vale esta seção.

(a) **Movimento na recuperação (§4.2).** A linha "movimento na recuperação" partia de uma premissa errada: o movimento e o dash já cancelavam a recuperação desde o combate B. Virou **movimento a 40% da caminhada na parte travada** (preparação + golpe) do ataque leve, do pesado e do arco, mais o **cancelamento pelo dash nos últimos 60 ms da fase ativa**. O carregado segue imóvel.

(b) **Pancada só em alcance corpo a corpo (§4.3).** Ela é elegível apenas a até 60 u (`slamMaxDistance` 60, não 140): com 140 a elite dava a pancada na aproximação, errava e nunca chegava ao corpo a corpo. Custo, se errado: a pancada fica menos usável a distâncias médias.

(c) **Combo com duas janelas de esquiva.** Uma por golpe (`src: assaltante.combo`), cada uma creditada por conta própria, e o evento `enemy.attack_start` é emitido nos dois golpes com `hit: 1` e `hit: 2`. No painel o 2º golpe conta como um golpe.

(d) **Jogador invulnerável nunca é atingido.** Defeito prévio do *lunge* achado na revisão: a aterrissagem era avaliada antes do passo e a sobreposição depois, o que fazia o resultado da esquiva variar de forma não monotônica com o tick do aperto. A sobreposição em invulnerabilidade agora credita `dodge`.

(e) **Hit-stop.** Congela a simulação inteira, **inclusive o relógio do log**. O congelamento do golpe que mata **sobrevive ao renascimento** do inimigo (`respawnEnemy` não o zera; `resetPlayer` e o início de sessão zeram); pedidos simultâneos valem o **maior**. Custo, se errado: um congelamento de até 2 passos recai sobre o inimigo recém-nascido.

(f) **`kind` desconhecido.** Um `kind` string desconhecido em `enemy.attack_start` é **contado** (na própria chave; `outros:N` no painel quando N > 0) em vez de rejeitado, por compatibilidade futura. Valores não string e `hit` fora de 1 ou 2 continuam malformados.

(g) **Telegraph e corredor do *lunge*.** O telegraph tem um modelo de visão testado (`AssaltanteController.telegraph`), e o corredor do *lunge* é desenhado com a **distância de contato real** (60), não com um valor visual.

(h) **Agentes da V0.** Seguem **cegos ao *lunge*** e não distinguem pancada de combo (a `Observation` não traz `attackKind`). A heurística do 2º golpe (inimigo ainda em `attacking` além de um ciclo de golpe) é **provisória**, para a V0.1: tem margem de um tick e lê uma pancada como 2º golpe (quem esquiva leva a pancada). Os agentes só continuam jogáveis; a V0 não foi reexecutada.

(i) **Limitações conhecidas.** (1) O ramo de perseguição de `threatPrediction` ignora o atraso do primeiro ataque, a pausa e a pancada, então o perfil ao vivo da paciência fica levemente errado durante a perseguição. (2) Após um *parry* a recuperação dura 500 ms e a janela de punição 750 ms (herdado). (3) Os efeitos visuais não foram verificados jogando (só testes de unidade e carga da página). (4) Os efeitos de tela usam relógio real, então o *hit-stop* não os congela.

(j) **A elite não adapta.** Só o futuro chefe usa o perfil; a seleção por peso é fixa.
