# Estrutura da UI: menu, indicador de encontro e chefe ampliado — design

Data: 2026-11-03. Branch de partida: `perfil-chefe`. Substitui nenhum documento anterior.

## 1. Intenção

O jogo hoje abre direto na arena. O autor quer que ele se comporte como um produto jogável: um menu inicial, um indicador claro de onde o jogador está na run, e uma luta de chefe que se distinga das lutas comuns. Nada disso muda o sistema de perfil, que continua sendo o produto da tese; o chefe segue sendo o validador.

Esta etapa é só a **estrutura da interface**. Login real e dados na nuvem (Supabase) são um projeto seguinte, com brainstorm e plano próprios.

## 2. Objetivos

1. Um **menu inicial** com: Login, Jogar, Como jogar, Análise.
2. Um **indicador na tela** durante a partida: `ENCONTRO a · INIMIGO b/n`, que vira `BOSS ROOM` na sala do chefe.
3. Um **chefe maior que o inimigo comum**, em visual **e** em lógica (caixa de acerto e alcance), com cor própria e apresentação de luta de chefe.
4. Ajuste pequeno: barragem do chefe **mais rápida** (interpretação minha do pedido, ver 6.4).

## 3. Não objetivos

- Autenticação, contas, sincronização, consentimento e apagar dados: projeto Supabase. O botão Login existe, mas desativado ("em breve").
- Arte e animação finais: o chefe usa o sprite atual do Assaltante, ampliado e tingido.
- Recalibrar os limiares de hábito (`far`, `passive_defense`) para o chefe maior: decisão do autor, depois do playtest.
- Qualquer mudança no V0/V0.1 pré-registrado. Os agentes sintéticos continuam idênticos bit a bit sem a sala do chefe.

## 4. Menu inicial

Uma cena nova (`MenuScene`) que abre antes de `ArenaScene`. Navegação por mouse e por teclado (setas + Enter).

| Entrada | Comportamento |
| --- | --- |
| Login | Visível, desativado, rótulo "em breve". Reservado para o projeto Supabase. |
| Jogar | Inicia `ArenaScene` (comportamento atual: perfil e histórico restaurados do IndexedDB). |
| Como jogar | Tela de leitura com os controles (as mesmas linhas da ajuda de `gameplayHud.ts`) e uma explicação curta de encontro, sala, chefe, parry/bloqueio e esquiva. Voltar com Esc. |
| Análise | Mostra o painel de análise com o histórico guardado, **somente leitura**, sem iniciar uma partida. Voltar com Esc. |

Decisões minhas (marcadas como tal, o autor pode trocar):
- **Esc na partida volta ao menu.** Fecha a sessão de telemetria do jeito normal (`shutdown`), sem perder eventos.
- A parâmetro de URL `?boss=demo` continua valendo e é repassado quando o jogo é iniciado pelo menu.
- Texto do menu em português, sem arte nova: texto e retângulos, no mesmo estilo placeholder do HUD.

Pontos que o construtor resolve:
- Como a tela Análise lê o histórico sem uma sessão ativa. A restrição é: não gravar nenhum evento (nem `session.start`) ao abrir a Análise.
- Como as duas cenas dividem o `SessionController` (hoje criado dentro de `ArenaScene.create`).

## 5. Indicador de encontro

Texto fixo no HUD, mais proeminente que o atual `run N · sala R · encontro E/2`.

- Sala comum: `ENCONTRO a · INIMIGO b/n`.
  - `a` = número da sala da run (1, 2, ...). Interpretação minha: o "encontro" do autor corresponde à sala do código, e o "inimigo" ao encontro do código.
  - `b` = posição do inimigo atual na sala.
  - `n` = quantos inimigos a sala **ainda terá antes da próxima fronteira** (fim da sala ou chefe). Isso evita mostrar "1/2" numa sala que o chefe encerra mais cedo. Hoje o chefe entra depois do 3º encontro da run e cada sala tem 2, então a 2ª sala mostra `INIMIGO 1/1`. Nenhuma constante muda.
- Sala do chefe: `BOSS ROOM`.
- O número da run continua visível, em tamanho secundário.

Ao entrar na sala do chefe, uma faixa grande `BOSS ROOM` aparece por cerca de 2 s e some, sem pausar a simulação.

## 6. Chefe

### 6.1 Escala (visual e lógica)

Fator de escala **1,7** (minha escolha; o autor pode ajustar). Aplicado só quando o Assaltante está em modo chefe (`configureBoss`), revertido por `clearBoss`/respawn.

- **Sprite:** desenhado 1,7× maior.
- **Caixa de acerto (hurtbox):** largura e altura ×1,7, crescendo a partir do centro (a posição do controlador é o canto superior esquerdo, então o canto precisa ser reposicionado para o centro não saltar).
- **Alcance dos golpes:** deve crescer junto. Hoje o alcance é `ATTACK_REACH + width/2` (e o golpe de área, `slamRadius + width/2`), de modo que o alcance já cresce pelo meio da largura. O construtor decide se isso basta para parecer proporcional ou se a constante base também escala; a regra é que o alcance efetivo do chefe seja visivelmente maior, e isso fica coberto por teste.
- Colisão com o jogador, limites da arena, perseguição, investida e depuração visual (F3) usam a nova caixa.
- Como a lógica muda, a versão do jogo deve subir (**sugestão: 0.0.7**). O perfil já filtra histórico por versão, então o histórico da 0.0.6 deixa de contar para o perfil; isso também zera o portão "já enfrentou o chefe". O autor confirma antes de commitar.

### 6.2 Aparência

- **Tinta base própria** (sugestão: vermelho escuro) enquanto o chefe não estiver em telegrafo. As tintas de telegrafo atuais (laranja golpe, ciano e vermelho investida) têm prioridade, para a legibilidade do combate não piorar.
- **Aura:** um anel/brilho no chão sob o chefe, desenhado à parte, que não interfere nas tintas de telegrafo.

### 6.3 Barra de vida do chefe

Barra larga no topo da tela, rótulo `CHEFE`, valor numérico, visível só na sala do chefe. A barra de vida do inimigo comum deixa de aparecer nessa sala.

### 6.4 Barragem mais rápida

Interpretação minha de "deixar mais rápido": reduzir o intervalo entre golpes da barragem (`barragePauseMs`, hoje 250 ms) para um valor menor (sugestão: 150 ms). Não mexo no número de golpes, nem no teto de 1,5× de duração. Se o autor queria outra coisa (avanço do chefe, tempo de preparação), isso muda.

## 7. Restrições

- Estilo do código: o das cenas existentes; sem dependências novas.
- O passo fixo de 60 Hz e o bus de eventos não mudam. Menu e Análise não emitem eventos de jogo.
- Seeds 20261019 e 20261105 nunca em testes (usar 4242). Nenhuma execução `--full`.
- Commits só com mensagem aprovada pelo autor, sem trailer de coautoria, sem push, sem merge.
- Não versionar `.claude/`, `docs/pesquisa/`, o plano de `perfil-chefe` e `.superpowers/`.

## 8. Fica para o construtor

Layout exato e fontes do menu e das telas, cores exatas, tempos de animação da faixa, e a estrutura de testes (lógica pura testada com Vitest; o que depende de Phaser só por inspeção visual no navegador).

## 9. Decisões em aberto para o autor

1. Recalibrar `passiveMaxDistance` (120) e o limiar de `far` agora que o chefe tem o corpo maior: as distâncias passam a ser medidas até um centro cuja caixa é 1,7× maior.
2. Subir a versão para 0.0.7 (descarta o histórico 0.0.6 do perfil).
3. Esc volta ao menu: confirmar o comportamento.
