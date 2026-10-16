# Sistema de Profilamento de Jogador — Documento Técnico Mestre

**Projeto:** *Nobody Dies After the Eve* (TCC, Centro Universitário Luterano de Palmas)
**Versão:** 2.0, rascunho para revisão · **Data:** 16/10/2026
**Verificado contra:** commit `5a998c3` (branch `combat-b`; `master` em `1f0aa4f`) · 369 testes em 32 arquivos, todos passando · `tsc --noEmit` e `vite build` limpos
**Substitui, quando aprovado:** `Contexto_pesquisa/instrumento-perfil-adaptativo.md` (28 a 30/09/2026)

> **Foco do trabalho (decisão D-0, 16/10/2026, autor).** O objetivo principal do TCC é o **sistema de profilamento do jogador**: o sistema que observa o comportamento em combate e gera a análise do jogador. O boss com capacidade preditiva é uma forma de **validar** esse sistema e um **subproduto**, não a contribuição central. A melhora do jogador é uma consequência possível, não a variável medida.

---

## Como usar este documento

1. **Para escrever o TCC.** Cada seção traz fatos verificados no código e a fonte (arquivo ou documento). Quando for pedido um trecho de técnicas, tecnologias, mecânicas ou do sistema, a consulta é feita aqui. O Apêndice B mapeia cada seção para o capítulo da tese e lista o que o texto atual da tese precisa corrigir.
2. **Para analisar e alterar o sistema.** Todo item tem um **status** e, quando cabe, o que falta validar. Mudou algo no jogo? Atualize o item e a linha da seção 9.
3. **Para não se perder.** O que é fato verificado, o que é decisão do autor e o que é **proposta minha, a confirmar** estão sempre marcados.

### Legenda de status

| Marca | Significado |
|---|---|
| ✅ | Implementado e coberto por testes automáticos |
| 🟡 | Implementado, mas **a validar** (playtest do autor ou dados reais) |
| 🔵 | **A definir:** falta decisão ou especificação |
| ⬜ | Planejado, ainda sem código |
| ⛔ | Descartado ou fora do escopo do TCC |

**Proposta, a confirmar** marca uma sugestão minha derivada do que o autor disse. Não é decisão.

### Sumário

1. Visão geral e pergunta de pesquisa
2. Catálogo de mecânicas
3. Ambiente de gameplay e catálogo audiovisual
4. O sistema de análise do jogador
5. Modelo de dados e persistência
6. Técnicas e algoritmos
7. Tecnologias e pipeline de assets
8. Verificação, validação e plano experimental
9. Decisões, histórico e pendências
- Apêndice A: Referências e situação da verificação
- Apêndice B: Mapa para a tese e divergências do texto atual
- Apêndice C: Glossário

---

# 1. Visão geral e pergunta de pesquisa

## 1.1 Objetivo e contribuição

O trabalho constrói um **sistema que perfila o jogador a partir do comportamento observado em combate**, em duas camadas complementares:

- **Camada descritiva, "como ele joga":** sete dimensões comportamentais, cada uma com uma estimativa de domínio e uma **confiança**, calculadas sobre *oportunidades* oferecidas pelo jogo (o que o jogador pôde fazer), e não apenas sobre o que fez.
- **Camada preditiva, "o que ele vai fazer":** um modelo sequencial que prevê a próxima ação do jogador e melhora conforme o histórico acumula. ⬜ *planejada, sub-projeto 5b.*

O perfil **persiste entre tentativas e entre sessões** e é sempre reconstruível a partir de um **log de eventos** guardado localmente. A qualidade do sistema é validada de forma independente do jogo-alvo: por estabilidade das dimensões, por acurácia de previsão ao longo do tempo de jogo e pela eficácia de um boss que usa o modelo, comparado ao mesmo boss sem ele (seção 8).

**O que o trabalho não afirma:** que o sistema melhora o jogador. Se isso acontecer, é consequência a discutir, não resultado a medir.

## 1.2 Quem faz o quê

| Agente | Papel | Observação |
|---|---|---|
| Jogador | Gera o comportamento que o sistema mede | Humano, ou agente sintético na validação |
| Inimigos comuns | IA **fixa**; instrumento de coleta estável | Nunca leem o perfil (decisão travada, reconfirmada em 12/09) |
| Boss | **Único** agente que consome o perfil e o modelo | Serve de validação do sistema. ⬜ ainda não existe em código |

## 1.3 Perguntas e hipóteses *(proposta, a confirmar com o orientador)*

A decisão D-0 fixa o foco, mas ainda não fixa as perguntas. Proponho três, uma por camada do sistema:

| # | Pergunta | Hipótese | Como se mede | Status |
|---|---|---|---|---|
| P1 | As dimensões do perfil medem traços **estáveis** do jogador? | `ICC(1,1) ≥ 0,50` por dimensão (critério D1) | `profile.snapshot` de saída de sala, relógio traço | 🔵 desenho depende da D4 revisada (ver 8.4) |
| P2 | A **acurácia de previsão** da próxima ação sobe com o histórico acumulado e supera uma linha de base simples? | Acurácia do preditor cresce com o nº de ações observadas e supera a baseline | Avaliação offline sobre o log (treinar até *t*, prever *t+1*) | ⬜ |
| P3 | Um boss que usa o modelo é **mais eficaz** que o mesmo boss sem ele? | Boss com modelo supera o boss sem modelo | Ablação: mesmo código, modelo desligado. "Eficaz" ainda não está definido | 🔵 |

Itens que precisam de decisão do autor: o que significa "eficaz" em P3, quantos jogadores ou agentes bastam e se participantes humanos entram (seção 8.6).

## 1.4 Terminologia

O documento de pilares da fase anterior (Drive, ago/2026) recomenda **evitar a palavra "aprendizado"** na monografia: a banca de um trabalho de IA em jogos espera um algoritmo de aprendizado de máquina, e o sistema não tem nenhum. A recomendação é usar **modelagem de jogador** e **adaptação online**. O reenquadramento atual diz que "quanto mais o jogador joga, mais o sistema aprende". Os dois cabem numa posição única, **a registrar no texto**:

> O sistema **acumula evidência** por meio de contagens e de um modelo N-grama: estatística online, determinística e inspecionável, sem aprendizado profundo. A escolha é deliberada e se justifica por explicabilidade, por determinismo (qualquer sessão é reconstruível por replay) e por exigir poucas amostras.

## 1.5 Posicionamento

Pelo vocabulário de Smith et al. (2011), o modelo é **individual** (um perfil por jogador), **induzido** (derivado do comportamento, sem perguntar nada ao jogador), restrito a **ações observáveis** e usado de forma **descritiva e preditiva**.

| Linha da literatura | Relação com este trabalho |
|---|---|
| Ajuste dinâmico de dificuldade (Hunicke) | **Contraste.** O DDA altera parâmetros para manter uma taxa de vitória; aqui o jogo não ajusta dificuldade. Este trabalho mede e prevê |
| Dynamic scripting (Spronck et al., 2006) | Mecanismo de referência para o boss. Lá os pesos são ajustados para **vencer** o jogador; aqui seriam derivados do perfil, e o boss é só validação |
| Rastreamento de conhecimento (Corbett e Anderson, 1994) | **Método importado:** o domínio é estimado sobre *oportunidades*, o que resolve o denominador desconhecido |
| Predição de ação (Laird, 2001; Chiu et al., 2014; Millington, 2019) | Base da camada preditiva: N-grama sobre ações discretizadas |
| Modelagem de jogador por agrupamento (Drachen et al.; Bauckhage et al.) | **Contraste:** vetor contínuo de dimensões definidas por projeto, em vez de grupos de difícil interpretação |
| Personas procedurais (Holmgård et al., 2019) | Fundamenta usar **agentes sintéticos** como instrumento de validação |

A seleção definitiva de referências deve ser refeita à luz da D-0 (Apêndice A).

## 1.6 Escopo

**Dentro:** observação em combate; sistema de oportunidades; perfil de sete dimensões (seis ligadas); log persistente e reconstrução do perfil; camada preditiva (⬜); boss como validação (⬜); validação por estabilidade, previsão e ablação.

**Fora (⛔):**
- Geração de arena por LLM e texturas por difusão, que existiam no GDD original em Unity e foram descartadas.
- Ancoragem, party de Ecos, co-op, narrativa e trilha completa do GDD do jogo completo.
- A dimensão 7 (uso de espaço), por não haver eixo Z.
- Qualquer aprendizado de máquina profundo.

## 1.7 Linha do tempo das versões do projeto

O projeto passou por três enquadramentos, e **o material do Drive e o texto atual da tese pertencem aos dois primeiros**. Isso explica por que várias referências e partes do texto estão desatualizadas.

| Período | Enquadramento | Arquitetura | Pergunta | Onde está |
|---|---|---|---|---|
| 08/07 a 03/08 | **1. Boss room adaptativa** | Unity 6 / C#; arena gerada por LLM local (llama.cpp, GBNF); texturas SDXL + ControlNet; validador de arena; boss em árvore de comportamento 70/30 | Encontro de boss condicionado ao perfil é percebido como mais único e justo? (H1 PXI/GEQ, H2 expressive range, H3 divergência do boss) | `GDD-TCC-Boss-Room-Adaptativa` e `GDD-FullGame` (Drive) |
| 13/08 a 29/09 | **2. Instrumento de aprendizagem** | Phaser 3 + TypeScript, sem LLM; sistema de oportunidades; perfil de sete dimensões | Um inimigo que adapta ao déficit produz **aprendizado transferível**? (Estudo 1 ICC; Estudo 2 adaptativo contra controle, medido numa sala de transferência) | `TCC2-Atualizado.docx` (texto de 12 a 28/09) e `Referencias-25-escopo-aprendizado.xlsx` |
| 30/09 em diante | **3. Sistema de profilamento** | Mesmo código, mais: runs e telemetria persistente (5a), escala (A), combate fluido (B) | O sistema perfila bem o jogador? O boss preditivo valida? (**D-0, 16/10**) | este documento |

A troca de Unity por Phaser não tem registro de decisão próprio no repositório; a justificativa está no texto da tese (§3.2: plataforma web, coleta remota, testes em TypeScript).

---

# 2. Catálogo de mecânicas

Cada mecânica traz a regra, os parâmetros, onde está no código e o que falta validar. Os valores de balanceamento são **iniciais** e ficam como constantes, ajustáveis em playtest sem mudar a arquitetura. Onde o combate B (01/10/2026) mudou um valor, ele aparece como *antes → depois*.

> **Validação pendente em bloco.** Tudo marcado 🟡 depende do **playtest do autor no navegador**, que ainda não foi registrado para o combate B nem para as teclas de exportação e importação do histórico.

## 2.1 Entrada e controles

| Entrada | Efeito | Fonte | Status |
|---|---|---|---|
| WASD | Mover, rotacionado 45° para coincidir com o losango da tela | `scenes/ArenaScene.ts` | ✅ |
| Mouse | Mira em 360° (a posição do mouse é convertida pela inversa da projeção) | `ArenaScene.ts`, `visual/isometricProjection.ts` | ✅ |
| Clique esquerdo | Ataque leve da arma equipada; no arco, o disparo | `ArenaScene.ts` | ✅ |
| Clique direito | Ataque pesado (sem efeito no arco) | `ArenaScene.ts` | ✅ |
| Q (segurar e soltar) | Ataque carregado (sem efeito no arco) | `ArenaScene.ts` | ✅ |
| 1 / 2 / 3 | Troca para espada e escudo / arco / arma pesada | `ArenaScene.ts` | ✅ |
| Espaço | Esquiva (dash) | `ArenaScene.ts` | 🟡 |
| E (segurar) | Guarda: apertar sobre o golpe = parry; segurar antes = bloqueio | `ArenaScene.ts` | ✅ |
| Roda do mouse | Zoom da câmera, de 1× a 3× em passos de 0,25 (padrão 2×) | `visual/cameraZoom.ts` | 🟡 |
| F2 / F8 / F9 | Resetar perfil / exportar histórico / importar histórico | `ArenaScene.ts` | 🟡 |

**Comportamentos conhecidos do combate B** (seguem a spec; observar no playtest): segurar E depois de um dash não volta ao bloqueio (é preciso apertar de novo); Q apertado durante a parte travada de um ataque é descartado, mesmo que continue pressionado; E e as teclas 1/2/3 apertadas na recuperação **não** a cancelam e **não** entram no buffer.

## 2.2 Movimento, mira e câmera

| Mecânica | Regra e parâmetros | Fonte | Status | Pendência |
|---|---|---|---|---|
| Movimento | Oito direções, **instantâneo** (sem aceleração nem inércia), **220** unidades/s *(antes 160)*; só em `idle` e, a 50%, bloqueando | `combat/playerController.ts`, `movementDefs.ts` | 🟡 | Sensação |
| Mira | Direção do mouse, normalizada; o ataque trava a direção no início da ação | `playerController.ts` | ✅ | |
| Arena | 1600 × 1200 unidades (25 × 19 tiles de 64); o jogador é limitado às bordas | `movementDefs.ts`, `movement.ts` | ✅ | |
| Sem eixo Z | Todo o combate é planar; a profundidade isométrica só define a ordem de desenho | decisão de arquitetura | ✅ | Bloqueia a dim 7 |
| Câmera | Segue o jogador, com limites calculados pela projeção da arena; **zoom 2×** por padrão; os textos de desenvolvimento usam uma segunda câmera sem zoom | `ArenaScene.ts`, `cameraZoom.ts` | 🟡 | Zoom ideal |
| Tamanho visual | Personagem com 40 px de altura *(antes 32)*; hurtbox 20 × 20 | `placeholderTextures.ts` | 🟡 | Proporção |

## 2.3 Ações ofensivas, dano e vida

Três armas carregadas ao mesmo tempo; a troca custa **150 ms** de travamento de ataque *(antes 250)*, e esse travamento pode ser cancelado por uma esquiva. Os números de dimensão (n = 3 armas) pressupõem que as três estão sempre disponíveis.

| Ação | Tipo | Preparação | Golpe | Recuperação | Alcance | **Preso** (`lockedMs`) | Total |
|---|---|---|---|---|---|---|---|
| `sword_shield.light` | leve | 100 | 100 | 150 | 45 | 200 | 350 |
| `sword_shield.heavy` | pesado | 220 | 120 | 300 | 55 | 340 | 640 |
| `sword_shield.charged` | carregado | hold 150 a 900 | 140 | 350 | 50 → 70 | 140 | 490 |
| `heavy_weapon.light` | leve | 160 | 120 | 220 | 55 | 280 | 500 |
| `heavy_weapon.heavy` | pesado | 320 | 150 | 420 | 70 | 470 | 890 |
| `heavy_weapon.charged` | carregado | hold 200 a 1100 | 180 | 500 | 65 → 90 | 180 | 680 |
| `bow.shot` | disparo (`throw`) | 80 | 60 | 200 | 220 | 140 | 340 |

Tempos em ms; alcance em unidades de mundo. Nas ações carregadas, a preparação é o *hold*: o evento `player.action` só sai ao soltar (ou ao atingir o máximo), e só então o jogador fica preso no golpe. O alcance cresce linearmente com o tempo segurado.

| Mecânica | Regra | Fonte | Status |
|---|---|---|---|
| Leque de ataque | Setor circular de **90°** (meio-ângulo π/4) centrado na mira; alcance efetivo = alcance da ação + meia largura do atacante. Substituiu a caixa de quatro quadrantes, que errava alvos na diagonal | `combat/sector.ts` | ✅ |
| Arco | Usa o mesmo leque, com alcance 220: **não há projétil** (acerto instantâneo em cone) | `actionRegistry.ts` | 🔵 simplificação a justificar |
| Dano do jogador | Por tipo: leve **10**, pesado **20**, carregado **30**, disparo **10**, utilitário 0. **No máximo uma vez por ação**, mesmo que o leque sobreponha o alvo em vários passos | `movementDefs.ts`, `combat/encounter.ts` | ✅ |
| Vida | Jogador **100**; Assaltante **60** | `movementDefs.ts` | ✅ |
| Ação `utility` | O tipo existe no conjunto da dim 2 (n = 5), mas **nenhuma ação o usa**: a dim 2 nunca atinge entropia máxima | `actionRegistry.ts` | 🔵 |

## 2.4 Fases do ataque, cancelamento e buffer (combate B)

Mudança central do combate B, desenhada para reproduzir a sensação de combate ágil de *Hades*:

- **Preso** (`lockedMs` = preparação + golpe): o jogador não anda, não dá dash e não ataca. O que apertar vai para o buffer.
- **Recuperação:** **qualquer** entrada a cancela. Andar volta a `idle` e já move no mesmo tick; o dash sai direto; um novo ataque começa na hora, o que encadeia combos. Sem entrada, a recuperação termina sozinha após `totalCommitmentMs`.
- **Carga (Q):** enquanto se segura o Q, o dash cancela o carregamento sem emitir ação (o jogador ainda não se comprometeu).

| Mecânica | Regra | Fonte | Status |
|---|---|---|---|
| Recuperação cancelável | Cancelamento por mover, dash ou atacar emite `player.cancel {by, actionId}` **antes** do evento da ação seguinte | `playerController.ts` | 🟡 |
| Buffer de entrada | **120 ms**, **um** slot (guarda a última entrada). Vale para ataque e dash apertados quando ainda não podem executar; **não** vale para o carregado, o bloqueio, a guarda nem a troca de arma | `combat/inputBuffer.ts` | 🟡 |
| Exposição da dim 6 | Passa a ser `lockedMs`, a parte não cancelável (antes era o comprometimento total) | `actionRegistry.ts`, `encounter.ts` | 🟡 |
| Lacuna de dados | Um `player.cancel{attack}` pode **não** ser seguido de `player.action` (carga iniciada na recuperação e abortada cedo). O preditor não pode assumir o contrário | `playerController.ts` | ✅ documentada |

## 2.5 Defesa

| Mecânica | Regra e parâmetros | Fonte | Status |
|---|---|---|---|
| **Esquiva (dash)** | Duração **180 ms**, i-frames **150 ms**, recarga **200 ms**, deslocamento **120** *(antes 250 / 200 / 300 ms e 80)*. Direção: a do movimento pedido; sem movimento, a da mira. Sai de `idle`, da recuperação, do bloqueio, do carregamento e durante a troca de arma; **não** sai preso nem em stagger (vai ao buffer). A esquiva é **binária** (invulnerável ou não) | `playerController.ts`, `actionDefs.ts` | 🟡 |
| **Bloqueio** | Guarda levantada; consome a **barra de postura** (100), −40 por golpe (três bloqueios seguidos a rompem); regenera 50/s após 1000 ms em `idle`. O jogador anda a **50%** da velocidade bloqueando. Não tira vida | `playerController.ts` | ✅ (50% é 🟡) |
| **Parry** | Guarda levantada há menos de **150 ms** quando o golpe conecta: o inimigo pula o resto do golpe e a janela de punição vai de 500 para **750 ms** | `playerController.ts`, `assaltanteController.ts` | ✅ |
| **Recuo** | Não há ação: é **inferido** quando a janela de esquiva expira sem contato e sem defesa | `encounter.ts` | ✅ (limitação: inferido, não observado) |
| **Stagger** | Golpe não mitigado, ou postura zerada: **250 ms** parado *(antes 350)* | `actionDefs.ts` | 🟡 |
| **Golpe não mitigado** | Tira **20** de vida e causa stagger | `encounter.ts` | ✅ |
| **No máximo um rótulo defensivo por ataque** | Evita que a colisão, que persiste por vários passos, conte o mesmo golpe várias vezes | `encounter.ts` | ✅ |

## 2.6 Inimigo: o Assaltante

Único arquétipo implementado; **IA fixa**, baseada em regras de prioridade (a primeira pré-condição verdadeira vence).

| Elemento | Regra e parâmetros | Fonte | Status |
|---|---|---|---|
| Regras | `assaltante.attack` se a distância ≤ **60**; senão `assaltante.chase` | `ai/rules/assaltanteRules.ts` | ✅ |
| Máquina de estados | `idle`, `chasing`, `attacking`, `recovering` | `combat/assaltanteController.ts` | ✅ |
| Perseguição | **125** unidades/s *(antes 90)*, em linha reta; o sprite olha para a direção de perseguição | `movementDefs.ts` | 🟡 |
| Ataque | Telegrafia **400 ms** (abre a janela de esquiva), golpe **150 ms** em leque de 90° com alcance 45 + meia largura, recuperação **500 ms** (abre a janela de punição) | `assaltanteController.ts` | ✅ |
| Vida e dano | 60 de vida; golpe causa 20 | `movementDefs.ts` | ✅ |
| Previsão de ameaça | Implementa `ThreatAssessor`: simula a própria máquina de estados para dizer em quanto tempo atingiria um alvo (alimenta a dim 6) | `combat/threatPrediction.ts` | ✅ |
| Variedade | **Um** padrão de ataque, previsível. O perfil é medido diante de um só estímulo | — | 🔵 sub-projeto D (inimigo) |

## 2.7 Estrutura de jogo: encontro, sala e run

Introduzida no 5a. É o que permite ao perfil acumular em tempo real e ao sistema chamar as fronteiras de decaimento.

| Unidade | Regra | Perfil | Fonte | Status |
|---|---|---|---|---|
| **Encontro** | Termina quando o Assaltante chega a 0 de vida; outro nasce longe do jogador | `applyEncounterBoundary()` | `game/runDirector.ts` | ✅ |
| **Sala** | **3** encontros (`ROOM_ENCOUNTER_COUNT`); fecha com `profile.snapshot` de saída | `applyRoomBoundary()` | `runDirector.ts` | ✅ |
| **Run** | Termina quando o jogador chega a 0 de vida; a sala interrompida **conta**, marcada `partial`; vida e posição voltam ao início e a nova run recebe seed própria | **Não** reseta o perfil | `runDirector.ts` | ✅ |
| **Run abandonada** | Se a página for fechada no meio de uma run, a run é fechada na próxima abertura, com `cause: 'abandoned'` | idem | `telemetry/abandonedRun.ts` | ✅ |
| **Nascimento do inimigo** | Uma entre 8 posições candidatas (cantos e meios das bordas, com margem de 100) a pelo menos **300** do jogador, escolhida com PRNG semeado | — | `runDirector.ts` | ✅ |

Hoje não há mapa, portas, rotas nem progressão entre salas: a "sala" é uma contagem de encontros na mesma arena.

## 2.8 Mecânicas a definir, planejadas ou descartadas

| Item | Situação | Observação |
|---|---|---|
| **Perfect dodge** | 🔵 | Não existe nos GDDs nem no código. A esquiva hoje é binária; o parry é a única mecânica de timing fino. Pedido pelo autor para o catálogo de sinais; falta definir janela e efeito |
| **Boss** | ⬜ | Único consumidor do perfil e do modelo. Ver 4.6 |
| **Ação utilitária** | 🔵 | O tipo `utility` está no conjunto da dim 2 sem nenhuma ação |
| **Outros arquétipos de inimigo** | 🔵 | Sub-projeto D, deixado para depois |
| **Salas, mapa e rotas** | 🔵 | Estrutura de roguelike além da contagem de encontros |
| **Regras de honestidade do boss** | ⬜ | Herdadas do GDD (ver 4.6): adaptar só a seleção, nunca vida, dano ou velocidade |
| **Mecanismo 70/30 do boss** | 🔵 | Herdado do GDD; a reavaliar sob a D-0 |
| **Dimensão 7 (uso de espaço)** | ⛔ | Exige eixo Z |
| **Ancoragem, party de Ecos, co-op, narrativa** | ⛔ | Pertencem ao jogo completo, não ao TCC |

---

# 3. Ambiente de gameplay e catálogo audiovisual

## 3.1 Decisão e recorte

**Decisão (16/10/2026, autor):** reconstruir o ambiente de gameplay (arena, HUD e assets) já com o sistema formalizado, em vez de continuar remendando o atual. Conjunto mínimo: **3 a 6 tiles de chão, 1 herói, 1 inimigo comum e 1 chefe**, feitos no Blender, animados e sincronizados com as mecânicas.

**Recorte recomendado:** reconstruir a **camada de apresentação e a casca de gameplay** (cena, arena, HUD, assets) e **manter o núcleo lógico**. Motivos verificados no código em 16/10:

| Parte | Linhas de produção | Testes | Decisão |
|---|---|---|---|
| Lógica (`core`, `combat`, `opportunity`, `profile`, `game`, `telemetry`, `ai`) | ≈ 2.950 (75%) | 369, todos nesta parte | **Manter e adaptar** |
| Apresentação (`scenes`, `visual`, `debug`) | ≈ 970 (25%) | poucos (`scenes/ArenaScene.ts`, 575 linhas, **sem nenhum**) | **Reconstruir** |

A regra de dependência já existente (nada da lógica importa Phaser nem `visual/`) torna a troca barata e mantém válidos os logs e o perfil. O `ArenaScene` concentra boot, persistência, entrada, câmera, desenho de debug e HUD; deve ser dividido em módulos pequenos e testáveis.

**Status:** 🔵 especificação neste documento → ⬜ implementação (sub-projeto "E: ambiente de gameplay").

## 3.2 Estado atual da apresentação (verificado em 16/10)

| Elemento | Hoje |
|---|---|
| Personagens | KayKit *Knight* (jogador) e *Barbarian* (Assaltante), pré-renderizados em 128 × 128 px, 8 direções; **idle com 1 quadro e walk com 6 quadros a 8 fps** |
| Armas | **Não aparecem na mão** (conferido nos PNGs): o sprite não muda com a arma equipada |
| Animações de combate | **Nenhuma** (ataque, esquiva, bloqueio, dano, morte) |
| Sinais visuais existentes | Assaltante com tom laranja ao atacar; jogador com tom verde durante os i-frames; hurtbox, leque e alcance desenhados em modo debug |
| Chão | Tiles 2D isométricos (grama no interior, água na borda), de pacote de terceiros |
| HUD | Texto cru de desenvolvimento (oportunidades abertas, contadores, vida, run/sala/encontro) |
| Áudio | **Nenhum** |
| Efeitos | Nenhum |

## 3.3 Arena

**Decisão do autor:** os tiles do chão são feitos no Blender e **compostos proceduralmente** para formar a arena, de modo que ela seja bonita e **expansível**.

| Item | Especificação *(proposta, a confirmar)* | Status |
|---|---|---|
| Conjunto de tiles | 3 a 6 variações do piso (por exemplo: base, duas variações, desgastado, borda) renderizadas pelo mesmo pipeline ortográfico a 26,57°, losango 2:1 (tile lógico de 64 unidades → 64 × 32 px) | ⬜ |
| Composição | Função pura `composeFloor(seed, colunas, linhas, tileset)` que devolve a matriz de tiles, com PRNG semeado e regras simples de vizinhança. Mesma seed produz a mesma arena; trocar o tamanho ou o conjunto de tiles basta para expandir | ⬜ |
| Registro | A seed da arena vai no log (`run.start` ou `room.enter`), para a arena ser reconstruível | ⬜ |
| Natureza | **Puramente visual:** não altera colisão nem nenhuma regra. Os testes da lógica passam sem mudança | — |
| Legibilidade | O chão **nunca** carrega informação de jogo. Telegrafia e zonas de dano são sobreposições autorais com contraste garantido sobre qualquer tile (regra herdada do GDD) | — |
| Dimensões | Hoje 1600 × 1200 unidades (25 × 19 tiles); passa a ser parâmetro | 🔵 |

**Critérios de aceitação:** `composeFloor` é determinístico (teste em Node); trocar o conjunto de tiles não muda nenhuma colisão; a arena lê bem com o zoom padrão de 2×.

## 3.4 Personagens

**Estilo (autor):** **bem poligonal, como um Zelda antigo**: poucas faces, sombreamento chapado, paleta curta. Combina com a pré-renderização em 128 px porque a silhueta continua legível.

**Conjunto mínimo:** herói, inimigo comum e chefe. O autor quer um **herói novo**, coerente com a necessidade de uma **arma nova**.

**Armas.** Hoje o jogo tem três (espada e escudo, arma pesada, arco), carregadas ao mesmo tempo. Elas precisam estar **visíveis na mão e mudar a silhueta** ao trocar de arma; isso torna legível a dimensão 1 (repertório de armas). O pacote KayKit traz os modelos como arquivos separados que nunca foram anexados: `sword_1handed`, `sword_2handed`, `axe_1handed`, `axe_2handed`, `bow`, `crossbow`, `dagger`, `staff`, `wand` e vários escudos. Qual será a "arma nova" é uma decisão em aberto 🔵.

### Qual rig usar

O que o rig precisa garantir: cobrir as poses necessárias, anexar a arma a um osso da mão e permitir renderizar em 8 direções. Comparação:

| Opção | O que é | Custo de animação | Controle | Recomendação |
|---|---|---|---|---|
| A. Personagens KayKit como estão | Usar *Knight*, *Barbarian* etc. | Mínimo | Baixo | Só como solução provisória |
| **B. Personagem novo no esqueleto `Rig_Medium` do KayKit** | Modelar o herói poligonal e vinculá-lo ao esqueleto do pacote (pesos automáticos, formas simples facilitam) | **Baixo:** reaproveita os clipes CC0 de combate corpo a corpo, à distância e movimento | Médio | **Recomendada** para herói e inimigo comum |
| C. Rig e animações próprios | Esqueleto próprio e poses animadas à mão | Alto | Total | Só se a B falhar para a arma nova |

Para o **chefe**, a decisão espera o design do boss. Existem animações para o rig `Rig_Large` no pacote, o que permite um chefe maior no mesmo esquema sem criar um esqueleto novo. Para golpes da arma nova sem clipe equivalente, parte-se do clipe mais próximo e ajustam-se as poses ou criam-se clipes curtos no Blender.

### Como a animação se encaixa em tempos, sons e mecânicas

1. **A lógica manda.** Os tempos do jogo (milissegundos por fase) são a verdade; a animação é **reamostrada** para caber neles. Como os sprites são pré-renderizados, escolhe-se quais quadros vão para cada fase, e a duração original do clipe deixa de importar.
2. **Poses-chave por fase:** antecipação (preparação), impacto (golpe) e acompanhamento (recuperação). Um golpe leve com 100 ms de preparação cabe em 2 quadros a 20 fps.
3. **O som dispara por evento do jogo**, não por quadro de animação: `player.action`, `enemy.attack_start`, `enemy.hurt` e os demais. Assim o áudio é determinístico e independe do rig.
4. **Cancelamento:** na recuperação, qualquer entrada interrompe a animação na hora (combate B). A animação precisa tolerar corte em qualquer quadro.

### Animações mínimas

| Personagem | Animações | Status |
|---|---|---|
| Herói | idle, walk; por arma: leve, pesado, carregado (segurar + soltar) e disparo; esquiva; guarda (segurar) e parry; dano/stagger; morte | ⬜ |
| Inimigo comum | idle, walk; **telegrafia (400 ms), golpe (150 ms), recuperação (500 ms)** com poses distintas; dano; morte | ⬜ |
| Chefe | a definir depois do design do boss | 🔵 |

## 3.5 HUD de análise e HUD de jogador ✅

**Status:** ✅ implementado em 16/10/2026 no E1 (commits `8920fab` a `6c3622d`): painel de análise em DOM com atualização limitada (*throttled*), alimentado por `MetricsAggregator`, `ProfileView` e fita de eventos; `ArenaScene` reduzida a orquestradora. O playtest do painel no navegador está pendente. O texto abaixo é a proposta original; o painel de preditor segue ⬜ (5b).

Hoje há um painel de texto único. A proposta separa dois modos:

- **HUD de jogador (mínima):** vida, postura, arma equipada e run/sala/encontro.
- **HUD de análise (modo desenvolvedor, alternável):** mostra **entradas, saídas e dados agregados**. A tecla de alternância é decisão em aberto, evitando as teclas que o navegador intercepta (F1, F5, F7 e F12).

| Painel | Conteúdo | Origem |
|---|---|---|
| **Entradas** | Teclas pressionadas, vetor de movimento, mira, arma equipada, estado do jogador | `ArenaScene` e controladores |
| **Saídas (eventos)** | Fluxo dos últimos *N* eventos, com `t_ms`, tipo e carga; contador por tipo | Barramento de eventos |
| **Métricas** | Dado bruto → **métrica derivada** (catálogo em 4.7), com valor, janela e tamanho da amostra | `MetricsAggregator` |
| **Perfil** | As 7 dimensões: domínio, confiança, déficit, nos dois relógios; omissão; progresso até o limiar de confiança 0,60 | `ProfileAccumulator` |
| **Registro** | Sessão, run, sala, encontro, `seq`, tamanho do buffer, estado do armazenamento, falhas de gravação | `TelemetryRecorder` e `EventStore` |
| **Preditor** *(⬜)* | Previsão do momento e acurácia acumulada | Camada preditiva (5b) |
| **Desempenho** | Quadros por segundo e tempo do passo de simulação | `ArenaScene` |

**Arquitetura:** um **agregador puro** (`MetricsAggregator`) assina o barramento, mantém contadores, somas e janelas deslizantes e expõe `snapshot()`. A HUD só **desenha** o snapshot. Isso o torna testável em Node e **somente leitura** (não altera a simulação). As métricas derivadas são funções puras do log; um teste de equivalência garante que o valor **ao vivo** coincide com o recalculado **offline** a partir do `.ndjson`, na mesma lógica do teste de reconstrução do perfil.

**Critérios de aceitação:** cada métrica do catálogo 4.7 aparece no painel com valor, janela e amostra; cada evento do barramento é listado com tipo e carga; o painel não afeta a simulação (os testes de lógica passam sem mudança); o custo é O(1) por evento e o desenho só ocorre com o painel visível. Os quadros do painel servem como **figuras para a tese**.

## 3.6 Catálogo audiovisual de sinais

Princípio: **toda mecânica tem um sinal**, e o critério de suficiência é **legibilidade**, não beleza. Se o jogador não percebe a oportunidade, os dados passam a medir a falta de legibilidade e não a habilidade (a leitura da omissão em 4.2 depende disso). Os critérios de aceitação abaixo são **proposta, a confirmar**.

| Evento ou mecânica | Sinal visual | Sinal sonoro | Critério de aceitação | Status |
|---|---|---|---|---|
| **Música de fundo** | — | Loop simples; o GDD do protótipo previa 3 trilhas (exploração, luta, fase final), e começa-se com um loop | Sem emenda audível; os efeitos continuam audíveis sobre a música no volume padrão | ⬜ |
| `player.action` (leve, pesado, carregado, disparo) | Animação do golpe por arma, com poses nas três fases e rastro do golpe | Whoosh por tipo: curto (leve), grave (pesado), estalo (disparo) | O jogador distingue o tipo de golpe só pelo som; o som toca no tick do evento | ⬜ |
| Carga (Q segurado) | Brilho crescente | Tom ascendente | O alcance crescente é percebido durante o *hold* | ⬜ |
| `player.cancel` | Corte imediato da animação de recuperação | **Nenhum** (para não poluir) | O corte é visível no quadro seguinte à entrada | ⬜ |
| `player.dodge` | Dash com rastro; tom verde durante os i-frames (**já existe**) | Whoosh curto | O fim dos i-frames é visível | 🟡 (tom) / ⬜ |
| `player.defense` bloqueio | Faísca; barra de postura visível | Som metálico surdo | O jogador percebe a postura caindo | ⬜ |
| `player.defense` parry | Flash dourado distinto do bloqueio | "Clang" agudo | Parry e bloqueio são inconfundíveis sem olhar o HUD | ⬜ |
| `player.hurt` / golpe não mitigado | Flash vermelho, tremor leve, animação de stagger | Impacto grave | O dano é percebido sem olhar a vida | ⬜ |
| **`enemy.attack_start` (telegrafia de 400 ms)** | Pose de preparação **distinta** de idle e walk, visível desde o 1º quadro; marcador do leque no chão (sobreposição autoral) | Aviso ascendente | **O sinal mais importante para a validade da medição:** um jogador novo percebe o golpe iminente durante a telegrafia | ⬜ |
| Golpe do inimigo (150 ms) | Slash da animação | Whoosh forte | O instante do golpe é inequívoco | ⬜ |
| `enemy.hurt` / `enemy.death` | Flash branco; animação ou dissolução de morte | Acerto; som de morte | O acerto é percebido sem olhar a vida do inimigo | ⬜ |
| **Janela de punição** (recuperação do inimigo, 500/750 ms) | Pose de recuperação legível; **sem destaque extra por padrão** | — | 🔵 Decisão metodológica: um destaque funciona como andaime e altera o sinal de omissão; se adotado, deve ser constante em todo o estudo | 🔵 |
| **Perfect dodge** | A definir | A definir | Depende de definir a mecânica (janela e efeito); hoje a esquiva é binária | 🔵 |
| Troca de arma (1/2/3) | A arma muda na mão | Som de equipar | A arma ativa é identificável pela silhueta | ⬜ |
| `run.start`, `room.enter`, saída de sala | Transição curta e texto | Estinger | Marca o ritmo sem tapar o combate | ⬜ |
| `player.death` / `run.end` | Animação de morte e tela de fim de run | Estinger | O fim da run é inequívoco | ⬜ |

## 3.7 Política de assets e áudio

- **3D e imagem:** CC0 preferencial; modelos próprios feitos no Blender; o pacote KayKit entra como base de esqueleto e animações. Geração 3D por serviço pago (Hyper3D, Tripo e similares) só com decisão explícita, por custo e licença. O Poly Pizza pode exigir crédito (CC-BY) e o Sketchfab varia por modelo.
- **Áudio (hoje inexistente), três caminhos, decisão 🔵:** (a) bibliotecas CC0 como Kenney, OpenGameArt e Freesound filtrado por CC0 *(conhecimento geral; não verificadas nesta sessão)*; (b) **síntese em código** com Web Audio, por exemplo o plugin comunitário *Audiorective* *(não instalado)*, que dispensa arquivos e licença; (c) música gerada por serviço externo, que é remoto, cobra créditos e tem licença não verificada, e por isso evito na versão da tese. O GDD do jogo completo cita FMOD, Suno/AIVA e ElevenLabs; isso **não** se aplica ao TCC.
- **Registro:** uma lista de licenças por arquivo (`LICENSES.md` na pasta de assets).
- **Técnica:** o Phaser já tem gerenciador de som (Web Audio), sem dependência nova. Navegadores só liberam áudio depois da primeira interação do usuário *(regra geral dos navegadores)*, então o boot precisa tratar isso.
- **Pesquisa:** o áudio ligado, desligado ou com volume diferente varia por participante e pode confundir os dados; considerar registrar `audio_on` no `session.start` 🔵.
- **Ferramenta:** o Blender MCP está disponível (busca em Poly Haven, Poly Pizza e Sketchfab, geração 3D, visualização), mas em 16/10 o add-on **não estava conectado** (porta 9876). O pipeline atual roda em modo headless sem o MCP.

## 3.8 Ordem de construção e limites de escopo

O ponto do "limite de escopo", em termos simples: arte, animação e som **não terminam sozinhos**; sempre dá para melhorar. O núcleo da tese (preditor, boss e validação) é onde saem os resultados e está em ≈ 7%. Por isso cada etapa tem um **critério de pronto** que encerra o trabalho de arte. O limite é por **entregável**, e o calendário fica a seu critério.

| Etapa | Entrega | Critério de pronto |
|---|---|---|
| **E1** | HUD de análise + cena modularizada, **com a arte atual** | Todas as métricas do catálogo 4.7 visíveis e testadas; `ArenaScene` dividida e com testes |
| **E2** | Arena procedural com 3 a 6 tiles | `composeFloor` determinístico; arena legível em 2× |
| **E3** | Herói e inimigo comum animados, sincronizados, com som mínimo | Todas as linhas da tabela 3.6 marcadas como ⬜ para esses dois personagens viram ✅ ou têm decisão registrada |
| **E4** | Chefe | Só depois do design do boss (4.6) |

**Condição:** definir a **escala lógica antes da arte**. Hurtbox (20), alcances e velocidades são lógica. Se os novos modelos exigirem outros tamanhos, as distâncias mudam, as dimensões mudam e os logs ficam incomparáveis (nova `GAME_VERSION`). O ideal é encaixar a arte na lógica atual.

---

# 4. O sistema de análise do jogador

Esta é a contribuição central do trabalho (D-0). Descreve, em camadas, como o comportamento observado vira perfil.

## 4.1 Camadas e estado

```
combate ──▶ eventos ──▶ oportunidades ──▶ perfil descritivo ──▶ ┐
              │                                                  ├─▶ boss (validação)
              └──▶ log persistente ──▶ reconstrução ──▶ preditor ┘
```

| Camada | Função | Implementação | Validação empírica |
|---|---|---|---|
| Observação | Eventos de combate tipados no barramento | ✅ | — |
| Oportunidades | Registra o que o jogo **ofereceu** (denominador) e o desfecho | ✅ | ⬜ |
| Perfil descritivo | Sete dimensões com domínio e confiança (seis ligadas) | ✅ | ⬜ (ICC) |
| Log e reconstrução | Persistência local; perfil sempre reconstruível | ✅ (🟡 no navegador) | ✅ equivalência testada |
| Preditor sequencial | Prevê a próxima ação | ⬜ | ⬜ |
| Boss (validação) | Consome perfil e modelo | ⬜ | ⬜ |

**Estimativa de progresso sob a D-0** *(julgamento meu; pesos explícitos, ajustáveis)*:

| Camada | Peso | Concluído |
|---|---|---|
| Base jogável | 5 | 65% |
| Oportunidades | 5 | 90% |
| Perfil descritivo | 20 | 85% |
| Dados e persistência | 15 | 85% |
| Preditor | 25 | 5% |
| Validação empírica | 20 | 10% |
| Boss (validação) | 10 | 5% |
| **Total** | **100** | **≈ 41%** |

A fundação (as quatro primeiras linhas) está em ≈ 83%; o núcleo da tese (preditor, validação e boss) em ≈ 7%. Os percentuais não medem tempo restante: preditor e validação são as partes mais difíceis. Não há prazo registrado em lugar nenhum.

## 4.2 Sistema de oportunidades

Uma telemetria comum registra o que o jogador fez. O sistema de oportunidades registra também o **que o jogo ofereceu**, o que elimina o problema do *denominador desconhecido*: um jogador que não apara porque nunca houve golpe aparável é diferente de um que não apara porque não sabe. A ideia vem do rastreamento de conhecimento (Corbett e Anderson, 1994).

Cada janela aberta termina com **exatamente um** desfecho, resolvido por precedência `inválido > aproveitado > errado > expirado`:

| Desfecho | Numerador | Denominador | Quando |
|---|---|---|---|
| `taken` (aproveitado) | sim | sim | O jogador executou a ação qualificadora |
| `missed` (errado) | não | sim | Respondeu, mas com ação incompatível |
| `expired` (expirado) | não | sim | A janela fechou sem tentativa |
| `invalid` (inválido) | não | **não** | A janela nunca foi realmente oferecida; exige um motivo |

**Tipos de janela implementados:**

| Tipo | Abre | Dura | Fecha como `taken` quando |
|---|---|---|---|
| `dodge` | No início do ataque do Assaltante | **550 ms** (telegrafia 400 + golpe 150) | O jogador está invulnerável quando o golpe conecta |
| `punish` | No início da recuperação do Assaltante | **500 ms** (750 após parry) | O golpe do jogador acerta o Assaltante |

**Motivos de invalidação:** seis previstos (`other_source_hitstun`, `out_of_range`, `player_dead`, `tool_locked`, `source_interrupted`, `overlapping_priority`); **três são emitidos hoje**: `out_of_range` (a punição fecha sem que o jogador tenha estado ao alcance), `source_interrupted` (o Assaltante morre com janela aberta) e `player_dead` (a run termina com janela aberta).

**Sinal de omissão** (implementado em `ProfileAccumulator.omission()`, **ainda não consumido**): `omissão = expirados ÷ (expirados + errados)`.

| Leitura | Interpretação | Resposta prevista |
|---|---|---|
| `> 0,65` | O jogador **não vê ou não conhece** a opção | Aumentar a legibilidade da janela; não aumentar a dificuldade |
| `< 0,35` | **Conhece e executa mal** | Manter a janela; mais repetições |

Por isso o sinal da telegrafia (3.6) é crítico: sem ele, a omissão mede a legibilidade e não o jogador.

**Verificação:** existe um teste de **conservação**: a soma dos desfechos é sempre igual ao número de aberturas, inclusive quando um ouvinte do barramento reage a um evento emitindo outro. Uma janela que nunca fecha corromperia todas as razões em silêncio.

## 4.3 Perfil descritivo

O perfil converte o comportamento em **sete dimensões**, separadas em duas famílias porque não compartilham a mesma matemática.

### Família A: razão sobre oportunidades (dims 3, 5, 6, 7)

```
domínio(s)   = (aproveitadas_s + α) / (oportunidades_s + α + β)      α = β = 1   (média posterior Beta-Binomial)
déficit(s)   = 1 − domínio(s)
confiança(s) = oportunidades_s / (oportunidades_s + κ)               κ = 10      (cruza 0,60 em 15 oportunidades)
```

### Família B: entropia de repertório (dims 1, 2, 4)

```
p_i          = contagem_i / Σ contagem                                 (rótulos com contagem > 0)
domínio(s)   = H(s) = −Σ p_i ln p_i / ln n                             n = nº de opções disponíveis
déficit(s)   = 1 − H(s)
confiança(s) = contagem_s / (contagem_s + κ_H)                         κ_H = 25    (cruza 0,60 em 37,5 ações)
```

`n` é o número de opções **disponíveis**, não as usadas: quem tem cinco ações e usa duas em partes iguais tem `H = ln 2 / ln 5 ≈ 0,43`. Com um único rótulo usado o domínio é indefinido (`null`) e a dimensão não pode ser alvo: quem tem uma arma só não tem "déficit de repertório de armas".

### Registro das dimensões

| # | Dimensão | `SkillId` | Fam. | Medida | Fonte do dado | Implementação | Validação |
|---|---|---|---|---|---|---|---|
| 1 | Repertório de armas | `weapon_repertoire` | B | Entropia sobre 3 armas | `player.action` | ✅ | ⬜ |
| 2 | Repertório de ações | `action_repertoire` | B | Entropia sobre 5 tipos | `player.action` (ação carregada conta só quando executada) | ✅ | ⬜ |
| 3 | Aproveitamento de punição | `punish` | A | Punições aproveitadas ÷ oportunidades | `opp.close` do tipo `punish`, exceto `invalid` | ✅ | ⬜ |
| 4 | Repertório defensivo | `defensive_repertoire` | B | Entropia sobre `dodge`, `block`, `parry`, `retreat` (n = 4) | Colisão do golpe inimigo + estado do jogador; **um rótulo por ataque** | ✅ | ⬜ |
| 5 | Distância operacional | `distance` | A | Segundos em alcance corpo a corpo ÷ segundos de combate | Todo passo de simulação | ✅ | ⬜ |
| 6 | Paciência | `patience` | A | Ataques iniciados em janela segura ÷ total de ataques | `player.action` + previsão de ameaça | ✅ | ⬜ |
| 7 | Uso de espaço | — | A | Reposicionamentos aproveitados ÷ total | — | ⛔ sem eixo Z | — |

**Dimensão 6, janela segura.** Um ataque é *paciente* se nenhum inimigo consegue atingir o jogador durante a parte **não cancelável** da ação (`lockedMs`). `predictThreatMs` simula a máquina de estados do inimigo **fase a fase** e devolve em quantos ms ele atingiria o alvo (`null` = seguro, nunca "desconhecido"). O modelo contínuo tem **viés de até ≈ 16 ms** em relação ao jogo discreto, sempre conservador, documentado e coberto por um teste de equivalência simulação-contra-realidade. De 12/09 a 30/09 a exposição era o comprometimento total; mudou com o combate B porque a recuperação passou a ser cancelável.

### Dois relógios, mesma mecânica de esquecimento

Em vez de suavizar a razão já calculada, o perfil aplica o decaimento às próprias **contagens** (`contagem ← γ · contagem + novas`), de modo que domínio e confiança esquecem juntos. A evidência nova fica em contadores pendentes e só é dobrada na próxima chamada de decaimento; o `snapshot()` só expõe dimensões que já passaram por ao menos uma fronteira de sala.

| Relógio | γ | Meia-vida | Decai em | Representa | Quem consome |
|---|---|---|---|---|---|
| `trait` (traço) | 0,87 | ≈ 5 salas | Saída de sala | O jogador ao longo do tempo | Boss e `profile.snapshot` |
| `state` (estado) | 0,55 | ≈ 1,2 encontro | Fim de encontro | A janela recente | Ninguém ainda |

**Atenção para a camada preditiva:** com γ = 0,87 o relógio traço lembra cerca de 8 salas; ele **acompanha** o jogador, não **acumula** conhecimento ao longo de muitas horas. É por isso que o preditor precisa de uma memória própria, sem esquecimento (4.5).

## 4.4 Persistência e reconstrução do perfil

Decisão **D4 (revisada em 30/09/2026):** o perfil acumula **entre runs e entre sessões** e só é zerado por ação explícita. Antes da revisão, resetava por sessão.

- Cada alteração do perfil gera uma observação `obs.*` no log. Ao abrir o jogo, o perfil é **reconstruído** reaplicando as observações posteriores ao último `obs.reset`, com os parâmetros atuais do código. Isso permite **reanalisar** com outros γ, κ ou sem uma dimensão cortada.
- A reconstrução é **idêntica bit a bit** ao perfil ao vivo (teste de equivalência sobre dezenas de milhares de passos simulados).
- Reset do perfil (F2) grava um marcador e **não apaga** o histórico.
- Reconstrução e numeração de runs são filtradas pelo `player_id`; observações malformadas são ignoradas e contadas.
- Detalhes do formato em 5.

## 4.5 Camada preditiva (sub-projeto 5b) ⬜

**Objetivo:** prever a próxima ação do jogador a partir da sequência de ações e do contexto, e mostrar que o modelo **melhora com o histórico acumulado**. Um perfil "bem desenvolvido" é aquele com o qual o sistema prevê ações e intenções.

**Já existe como insumo (no log):** a sequência de `player.action` (`actionId`, tipo, arma), defesas e cancelamentos, cada um com contexto (`ctx`): distância, estado do jogador e do inimigo, vidas, postura, mira, arma e tempo desde a última ação. Isso permite treinar e avaliar offline, sem novos participantes.

**Design preliminar** *(proposta, a confirmar; nada disso está implementado)*:

| Aspecto | Proposta | Base |
|---|---|---|
| Modelo | N-grama sobre símbolos discretizados, com ordens 1 a 3 e *back-off* para a ordem menor | Millington (2019); Chiu et al. (2014); Laird (2001) |
| Símbolo | Tipo de ação ou defesa × faixa de distância × estado do inimigo | `ctx` já gravado |
| Memória | Contagens **sem decaimento**, acumuladas entre sessões; variante com decaimento para comparar | Contraste com o relógio traço |
| Avaliação | **Prequencial** (prever o passo *t* só com o que veio antes) sobre o log | — |
| Métricas | Acurácia top-1 e top-3, log-loss, entropia condicional da próxima ação | — |
| Linhas de base | "Ação mais frequente" e "repetir a última" | — |
| Resultado central | **Curva de acurácia × quantidade de jogo acumulada**, por jogador | Operacionaliza "quanto mais joga, mais sabe" |

**Questões abertas 🔵:** como discretizar distância e direção; se a unidade de previsão é a ação ou a janela de oportunidade; como tratar `player.cancel` sem `player.action` seguinte; contexto por encontro, sala ou run; uso das dimensões do perfil como atributos; efeito de mudar a `GAME_VERSION` sobre um modelo já treinado.

**Sinal de ociosidade (ideia do autor).** Um jogador parado por muito tempo sem atacar é informação para o boss (avançar ou dar dash). O dado já existe: `ctx.ms_since_last_action` e as amostras de posição (4 Hz). Entra como atributo candidato do preditor e como métrica M14 (4.7).

## 4.6 Boss como validação ⬜

**Papel:** validar o sistema. É subproduto; **não** é a contribuição central.

| Aspecto | Situação |
|---|---|
| Consumo | O perfil e o modelo são **congelados na entrada da arena**; o boss não lê comandos durante a luta. É a decisão do texto atual da tese (evita a acusação de trapaça e preserva o replay por seed). 🔵 reconfirmar sob a D-0 |
| Regras de honestidade (GDD) | Não alterar vida, dano nem velocidade; telegrafias de duração constante; adaptar só **seleção e posicionamento**; micro-ajustes limitados a ±15% com histerese de 8 s. ⬜ |
| Mecanismo candidato | Seleção ponderada de regras com `opportunity_tags`, no estilo *dynamic scripting* (Spronck et al., 2006), com *clipping* de pesos. A base já existe nas regras do Assaltante |
| Parâmetros em conflito | O GDD fixa ±15% por ajuste; a spec v2 do perfil previa `w_i = base_i · exp(λ · …)` com *clip* em `[0,25; 4]·base` e λ ≤ 1,1. É preciso reconciliar 🔵 |
| Mecanismo 70/30 (GDD) | 70% da massa de probabilidade pressiona os traços dominantes e 30% fica em comportamentos fixos com janelas de punição generosas. Hipótese de projeto do GDD, a reavaliar 🔵 |
| Ablação | O mesmo código com o modelo desligado (`λ = 0` ou modelo vazio) reproduz o boss-base: o controle sai "de graça" |
| Eficácia | **Definição pendente 🔵.** Candidatas: fração de ataques do boss que acertam; dano causado; quanto o boss neutraliza o padrão previsto |
| Risco | A adaptação pode ser imperceptível (Bakkes et al., 2009); um resultado nulo continua sendo resultado |

**Fórmulas planejadas da spec v2 do perfil** (não implementadas; reavaliar sob a D-0, pois nasceram para o enquadramento pedagógico):

```
score(s)    = confiança(s) × déficit(s)                     entre dimensões com confiança ≥ 0,60
alvo        = argmax score(s); troca só se domínio(alvo) ≥ 0,75, ou score(cand) > 1,15·score(alvo), ou confiança(alvo) < 0,60
w_i         = base_i · exp(λ · déficit(alvo) · confiança(alvo) · tag_alvo,i)       clip em [0,25·base ; 4·base]
```

## 4.7 Catálogo de métricas: dados brutos → métricas derivadas

Princípio (autor, 16/10): toda métrica que precisa ser **combinada com outra para virar uma informação nova** entra aqui. Exemplo: dado bruto *distância* e *tempo* → métrica derivada *velocidade média*. Cada métrica derivada é uma **função pura do log**; a HUD (3.5) as calcula ao vivo e a análise offline as recalcula do `.ndjson`, e os dois resultados devem coincidir.

### Dados brutos disponíveis

| ID | Dado bruto | De onde vem |
|---|---|---|
| B1 | Posição do jogador e do inimigo | `pos.sample` (4 Hz) e `ctx.p_pos`, `ctx.e_pos` |
| B2 | Tempo de simulação | `t_ms` do envelope |
| B3 | Distância jogador–inimigo | `ctx.dist` e o passo de simulação |
| B4 | Ações | `player.action`: `actionId`, tipo, arma |
| B5 | Cancelamentos | `player.cancel`: `by`, `actionId` |
| B6 | Esquivas e defesas | `player.dodge`, `player.defense` |
| B7 | Dano e vida | `player.hurt`, `enemy.hurt` (`dmg`, `hp_after`), `ctx.p_hp`, `ctx.e_hp` |
| B8 | Oportunidades | `opp.open`, `opp.close` (tipo, desfecho, motivo, tentativa, janela) |
| B9 | Início da telegrafia | `enemy.attack_start` |
| B10 | Estados | `ctx.p_state`, `ctx.e_state`, `ctx.p_poise` |
| B11 | Tempo desde a última ação | `ctx.ms_since_last_action` |
| B12 | Ciclo de jogo | `run.start/end`, `room.enter`, `encounter.start/end` |

### Métricas derivadas

| ID | Métrica | Fórmula | Brutos | Janela | Status |
|---|---|---|---|---|---|
| M1 | **Velocidade média** | Σ (distância percorrida entre amostras consecutivas) ÷ Σ Δt; variante "em movimento" exclui amostras paradas | B1, B2 | encontro, run, histórico | ✅ |
| M2 | Distância média ponderada pelo tempo | Σ (dist · Δt) ÷ Σ Δt | B3, B2 | idem | ✅ |
| M3 | Fração do tempo ao alcance corpo a corpo | tempo com dist ≤ alcance ÷ tempo de combate | B3, B2 | idem | ✅ (**dim 5**; lida do `ProfileView`, com rótulo do relógio estado/traço) |
| M4 | Taxa de ações e intervalo médio entre ações | nº de `player.action` ÷ minuto de combate; média de `ms_since_last_action` | B4, B11, B2 | idem | ✅ |
| M5 | Distribuição e entropia de ações e de armas | contagens por tipo e por arma; entropia normalizada | B4 | idem | ✅ (**dims 1 e 2**) |
| M6 | Distribuição e entropia defensiva | contagens por rótulo; entropia | B6 | idem | ✅ (**dim 4**) |
| M7 | Aproveitamento por tipo de janela | `taken ÷ (taken + missed + expired)` | B8 | idem | ✅ punição (**dim 3**) e esquiva |
| M8 | Omissão | `expired ÷ (expired + missed)` por tipo | B8 | idem | ✅ exibida na HUD |
| M9 | **Latência de reação** | t(primeira esquiva ou defesa depois de `enemy.attack_start`) − t(`enemy.attack_start`); mediana | B9, B6, B2 | idem | ✅ só esquiva |
| M10 | Taxa de cancelamento | `player.cancel ÷ player.action`, e por `by` | B5, B4 | idem | ✅ |
| M11 | Razão de troca de dano | dano causado ÷ dano sofrido; dano por minuto | B7, B2 | idem | ✅ |
| M12 | Duração do encontro, da run e salas por run | `encounter.end − encounter.start`; `run.end.duration_ms` | B12, B2 | run, histórico | ✅ |
| M13 | Fração de ataques pacientes | ataques em janela segura ÷ total | B4 + previsão de ameaça | idem | ✅ (**dim 6**; lida do `ProfileView`, com rótulo do relógio estado/traço) |
| M14 | **Ociosidade** (ideia do autor) | tempo com `ms_since_last_action > L` ÷ tempo de combate; `L` = 3000 ms fixo (contado desde a última `player.action` ou `run.start`) | B11, B2 | idem | ✅ |
| M15 | Cobertura espacial (opcional) | células visitadas ÷ células da arena; entropia espacial | B1 | run, histórico | ✅ |
| M16 | Previsibilidade | acurácia top-1 móvel; entropia condicional da próxima ação | log de ações (5b) | histórico | ⬜ |
| M17 | Progresso até o limiar de confiança | `confiança(dim) ÷ 0,60` | perfil | atual | ⬜ (só HUD) |

**Implementação (E1, 16/10/2026):** M1 a M15 estão implementadas no `MetricsAggregator` e exibidas no painel. M9 mede só a esquiva (a latência de defesa fica de fora). M3 e M13 não são recalculadas: vêm do `ProfileView` e a HUD mostra o rótulo do relógio (estado ou traço). Em M10 (`byCause`) e M11 (campos por minuto) o agregador já calcula os campos, mas nem todos são renderizados no painel; o mesmo vale para M12 (`meanRoomsPerRun`). M16 e M17 continuam ⬜ (5b e HUD de confiança).

**Regras de agregação:** toda métrica mostra a **amostra** (*n*) junto do valor; sem amostra, o valor é "—" e nunca 0 (mesmo critério do domínio `null`); janelas possíveis: encontro, sala, run, sessão e histórico; unidades em unidades de mundo e milissegundos.

## 4.8 Lacunas do que já existe (a completar)

O autor pediu que o trabalho do novo ambiente também deixe **mais completo o que já está pronto**. Lacunas conhecidas, com onde se propõe fechá-las:

| Lacuna | Efeito | Proposta | Etapa |
|---|---|---|---|
| Regra de ≥ 8 ações por segmento para calcular `H` (spec v2 §3.3 b) não implementada | Entropia instável com poucas amostras; só a confiança `κ_H` atenua | Implementar ou justificar a omissão no texto. **Fora do E1:** muda os dados (nova `GAME_VERSION`) e depende de decisão do autor | 🔵 |
| Nenhuma ação usa o tipo `utility` | A dim 2 nunca atinge entropia máxima | Definir uma ação utilitária ou retirar o tipo | 🔵 |
| Omissão calculada, mas não consumida | Sinal diagnóstico invisível | Exibir na HUD (M8) | ✅ E1 (exibida no painel) |
| Relógio `state` (γ = 0,55) sem consumidor | Código sem uso | Exibir na HUD; usar no boss, se couber | ✅ E1 (relógio estado exibido; uso no boss segue em aberto) |
| Três dos seis motivos de invalidação são emitidos | Janelas de outras origens ainda contam como válidas | Emitir os demais quando surgirem as situações | futuro |
| `ArenaScene` (575 linhas) e `ai/` sem testes | Regressão não detectada na apresentação | Modularizar a cena e cobrir com testes | ✅ E1 (cena modularizada em controlador de sessão, entrada/atalhos, câmera, vista do mundo, debug e HUD; regras do Assaltante testadas) |
| Recuo (`retreat`) é **inferido** | Dim 4 depende de uma inferência | Declarar como limitação | texto |
| Um único arquétipo de inimigo | O perfil é medido diante de um só padrão | Sub-projeto D | 🔵 |
| `public/assets/README.md` desatualizado; `public/assets/_unused/` (≈ 3 MB de pacotes de terceiros, sem registro de licença) | Documentação e repositório sujos | Atualizar o README; decidir manter ou remover; criar `LICENSES.md` | ✅ E1 (README atualizado, `_unused/` removido, `LICENSES.md` criado; tiles `grass.png` e `water.png` com licença a conferir) |
| Documento de arquitetura v1.1 fora do repositório | As specs o citam, mas ele não está versionado | Copiar para o repositório ou registrar o que ele definia | 🔵 |

---

# 5. Modelo de dados e persistência

Implementado no sub-projeto 5a (30/09/2026). Spec: `docs/superpowers/specs/2026-09-30-telemetria-runs-5a-design.md`.

## 5.1 Visão

O jogo grava um **log de eventos em duas camadas**, localmente, e o perfil é sempre reconstruível dele:

- **Camada A, observações do perfil (`obs.*`):** uma linha para cada alteração do perfil. É a **fonte da verdade** da reconstrução.
- **Camada B, contexto:** eventos de combate com um instantâneo da situação (`ctx`), amostras de posição e o ciclo de vida da run. É o conjunto de dados do preditor (5b) e das métricas derivadas (4.7).

Por que duas camadas: algumas entradas do perfil são calculadas com estado ao vivo que não está num evento (a dim 6 usa a previsão de ameaça daquele instante). Reaplicar as observações reproduz o perfil **exatamente**; reanalisar com outros parâmetros sai direto delas; mudar *o que conta* (uma nova definição de paciência, por exemplo) usa a camada B, com os limites dos dados gravados. Descartada a alternativa de re-simular o jogo a partir dos comandos: qualquer mudança de balanceamento inutiliza um histórico antigo.

## 5.2 Envelope (toda linha)

```
{ v: 2, seq, t_ms, player_id, session_id, run_idx, room_idx, enc_idx, type, ...payload }
```

| Campo | Significado |
|---|---|
| `v` | Versão do esquema (hoje 2) |
| `seq` | Contador crescente por sessão, a partir de 0. **`(session_id, seq)` é a chave única** |
| `t_ms` | **Tempo de simulação** (soma dos passos fixos), não relógio de parede: determinístico e imune a pausa ou aba em segundo plano |
| `player_id` | UUID gerado na primeira execução; identifica o perfil de longo prazo; sobrevive ao reset |
| `session_id` | UUID novo a cada abertura do jogo; **só rotula**, não reseta nada |
| `run_idx`, `room_idx`, `enc_idx` | Posição no ciclo; `run_idx` continua entre sessões |

## 5.3 Camada A: observações do perfil

| Evento | Carga | Espelha |
|---|---|---|
| `obs.record` | `skill`, `num`, `den` | `record()` (dims 5 e 6; **agregado**, ver abaixo) |
| `obs.outcome` | `skill`, `outcome` | `recordOutcome()` (dim 3) |
| `obs.action` | `actionType`, `weaponId?` | `recordAction()` (dims 1 e 2) |
| `obs.defense` | `label` | `recordDefense()` (dim 4) |
| `obs.boundary` | `kind: 'encounter' \| 'room'` | `applyEncounterBoundary()` e `applyRoomBoundary()` |
| `obs.reset` | — | `resetSession()` (só pela tecla F2) |

**Agregação do `obs.record`.** A dim 5 chama `record()` a cada passo (60 por segundo). O `RecordingProfile` acumula `num` e `den` por dimensão e **grava e repassa a soma junto**, a cada 250 ms de simulação ou antes de qualquer fronteira ou reset. Como a evidência pendente é inobservável (só contagens já dobradas por uma fronteira são lidas), adiar o repasse não muda nenhuma leitura, e o perfil ao vivo e a reconstrução executam **as mesmas somas de ponto flutuante na mesma ordem**, o que dá igualdade bit a bit. Restrição: uma mesma dimensão não pode ser alimentada ao mesmo tempo por `record()` e por `recordOutcome()` (hoje não é).

## 5.4 Camada B: contexto

### Ciclo de vida

| Evento | Carga |
|---|---|
| `session.start` | `wall_clock_iso`, `game_version`, `schema_v`, `persistent` |
| `run.start` | `run_idx`, `seed` |
| `run.end` | `run_idx`, `cause` (`death` ou `abandoned`), `duration_ms`, `rooms_cleared`, `encounters_cleared` |
| `room.enter`, `encounter.start`, `encounter.end` | `room_idx` ou `enc_idx` |
| `profile.snapshot` | `partial` (sala interrompida pela morte ou pelo abandono) + `at`, `counts`, `domain`, `confidence`, `target` (sempre `null` hoje), `lambda` (sempre 0 hoje) |
| `pos.sample` | `p`, `e` (posições), `p_state`, `e_state`, a cada **250 ms** de simulação (4 Hz) |

### Combate (todos com `ctx`)

| Evento | Carga própria |
|---|---|
| `player.action` | `actionId`, `actionType`, `weaponId` |
| `player.cancel` | `by` (`move`, `dash`, `attack`), `actionId` |
| `player.dodge`, `player.hit_unmitigated`, `player.death`, `enemy.attack_start`, `enemy.death` | — |
| `player.defense` | `label` (`dodge`, `block`, `parry`, `retreat`) |
| `player.hurt` | `dmg`, `hp_after` |
| `enemy.hurt` | `dmg`, `hp_after`, `actionId` |
| `opp.open` | `opp_id`, `opp_type`, `src`, `window_ms` |
| `opp.close` | `opp_id`, `opp_type`, `outcome`, `reason?`, `attempt?` |

O campo `type` das cargas de oportunidade (`dodge` ou `punish`) é gravado como **`opp_type`**, para não colidir com o `type` do envelope.

### Contexto (`ctx`)

| Campo | Conteúdo |
|---|---|
| `dist` | Distância jogador–inimigo (1 casa decimal) |
| `p_pos`, `e_pos` | Posições `[x, y]` |
| `aim` | Direção da mira (3 casas) |
| `p_state`, `e_state` | Estado das máquinas de estado |
| `p_hp`, `e_hp`, `p_poise` | Vida e postura |
| `weapon` | Arma equipada |
| `ms_since_last_action` | Tempo desde a última ação (`null` antes da primeira da run) |

## 5.5 Ordem causal

O log segue a **ordem causal**: o gatilho vem antes dos efeitos. O gravador assina o barramento com prioridade (`EventBus.on(tipo, handler, { prepend })`), então, por exemplo, `player.dodge` é gravado antes do `player.defense` que ele provoca, e `enemy.attack_start` antes do `opp.open`. Isso importa porque vários eventos têm o mesmo `t_ms` e `seq` é a única ordem. A inversão foi encontrada na revisão final do 5a e corrigida antes de qualquer coleta; um log gravado com a ordem trocada não teria como ser reordenado.

## 5.6 Persistência

| Aspecto | Como é |
|---|---|
| Armazenamento | **IndexedDB** (banco `tcc-telemetry`: armazém `events` com chave `[session_id, seq]` e armazém `meta`), atrás da interface `EventStore`; cai para memória se o IndexedDB faltar (por exemplo, janela anônima) |
| Gravação | Buffer em memória; vai ao armazenamento a cada **2 s**, no fim de cada run e quando a aba é escondida ou fechada. Escrita que falha volta ao buffer e é tentada de novo, com um único aviso |
| Abertura | Lê (ou cria) o `player_id` → reconstrói o perfil do log (só `player_id` atual; observações malformadas são ignoradas e contadas) → continua a numeração de runs → **fecha** uma run que ficou aberta por fechamento da aba (`cause: 'abandoned'`) → registra `session.start` |
| Reset do perfil (F2) | Grava `obs.reset`; a reconstrução parte do último marcador; **o histórico não é apagado** |
| Exportar (F8) | Baixa `tcc-historico-<id>-<data>.ndjson` (uma linha JSON por evento) |
| Importar (F9) | Mescla ao armazenamento (idempotente por `(session_id, seq)`), adota o `player_id` do arquivo e reinicia a cena; avisa se o arquivo traz outro jogador |
| Tamanho | Estimativa de projeto: **< 1 MB por hora de jogo** *(não medida)* |

## 5.7 Versionamento e comparabilidade de dados

`GAME_VERSION` (em `telemetry/schema.ts`, hoje `0.0.2+combatB`) entra em todo `session.start`. **Regra:** mudou jogabilidade, balanceamento ou geometria → nova versão, e logs de versões diferentes não se misturam para as dimensões afetadas.

| Marco | Efeito sobre os dados |
|---|---|
| 07/09/2026 | O leque angular substitui a caixa de quatro quadrantes. Dados anteriores não são comparáveis (dims 3, 4 e 6); antes disso um erro geométrico do inimigo virava um falso recuo |
| 30/09/2026 (5a) | Nasce o log persistente (`0.0.1+5a`); antes dele não há log |
| 01/10/2026 (combate B) | `0.0.2+combatB`: velocidades, esquiva, stagger, recuperação cancelável e janela da dim 6. **Dims 4 a 6 e a dim 5 não são comparáveis com a versão anterior** |
| Reconstrução do ambiente | Arte, som e HUD **não** exigem nova versão se a lógica ficar igual. Mudar hurtbox, alcances ou velocidades exige |

## 5.8 Limitações conhecidas

- **Duas abas abertas ao mesmo tempo** produzem um perfil reconstruído que nenhuma das duas teve (as sessões são reaplicadas em sequência, não intercaladas). Não há trava.
- Sem **compactação** do histórico; a estimativa de tamanho não foi medida.
- Uma importação deixa a run corrente aberta; ela é fechada na próxima abertura, mas só a última run de cada jogador é fechada.
- Se a última gravação ao fechar a cena falhar, essa parte se perde.
- Falha permanente de gravação faz o buffer crescer (novas tentativas a cada 2 s).
- A falha parcial do boot pode duplicar o temporizador de gravação (improvável, sem dano aos dados).

---

# 6. Técnicas e algoritmos

## 6.1 Arquitetura em camadas

```
                 ┌──────────────────────────────────────────────┐
  Phaser  ──────▶│ scenes/ArenaScene  (input, câmera, render)   │  ← única camada que vê os dois lados
                 └───────┬──────────────────────────┬───────────┘
                         │ lógica                   │ apresentação
        ┌────────────────▼─────────┐     ┌──────────▼──────────────┐
        │ game/RunDirector         │     │ visual/  (projeção,     │
        │ combat/Encounter         │     │  sprites, tiles, zoom)  │
        │  ├ PlayerController      │     │ debug/   (overlay, HUD) │
        │  ├ AssaltanteController  │     └─────────────────────────┘
        │  ├ InputBuffer, sector   │
        │  └ threatPrediction      │     ┌─────────────────────────┐
        ├──────────────────────────┤     │ telemetry/              │
        │ opportunity/             │────▶│  RecordingProfile,      │
        │ profile/                 │     │  Recorder, EventStore,  │
        │ ai/rules                 │     │  replay, ndjson         │
        │ core/ EventBus, loop, PRNG│    └─────────────────────────┘
        └──────────────────────────┘
```

**Regra de dependência:** nada em `core/`, `combat/`, `opportunity/`, `profile/`, `ai/`, `game/` ou `telemetry/` importa Phaser nem `visual/`. Por isso toda a lógica roda e é testada em Node puro. Duas propriedades de valor para a pesquisa: **testabilidade** (a simulação inteira roda sem navegador) e **determinismo** (um PRNG semeado, nenhum `Math.random()` na lógica, passo de simulação desacoplado da taxa de quadros: uma sessão é, em princípio, reconstruível a partir da seed e dos comandos).

A regra tem uma exceção deliberada: `telemetry/eventStore.ts` usa a API do IndexedDB. É a fronteira de entrada e saída do armazenamento; a regra existe para proteger o determinismo da lógica.

## 6.2 Padrões de projeto

| Padrão | Onde | Por quê |
|---|---|---|
| **Observer** (barramento tipado, com *prepend*) | `core/eventBus.ts` | Desacopla quem gera o sinal de quem mede; o tipo da carga é verificado em compilação por evento |
| **Máquina de estados** | `PlayerController`, `AssaltanteController` | Fases temporizadas (preparação/golpe/recuperação; telegrafia/golpe/recuperação) |
| **Data-driven / Registry** | `actionRegistry.ts` | Nova ação = nova linha de dados; validação em tempo de carga |
| **Game loop de passo fixo** | `fixedTimestepLoop.ts` | Simulação determinística e independente do FPS |
| **Strategy** | `ThreatAssessor` | Cada arquétipo implementa sua própria previsão de ameaça |
| **Facade** | `ProfileAccumulator`, `Encounter` | API única sobre duas famílias matemáticas e vários controladores |
| **Decorator** | `RecordingProfile` sobre `ProfileSink` | Grava cada escrita do perfil e repassa, sem o perfil saber |
| **Mediator / orquestrador** | `Encounter`, `RunDirector` | Resolve interações e impõe a ordem do passo e do ciclo da run |
| **Repository / Adapter** | `EventStore` (memória e IndexedDB) | Trocar o armazenamento sem tocar no jogo |
| **Blackboard + regras com pré-condição** | `ai/rules` | Base do *dynamic scripting* planejado |
| **Funções puras** | projeção, setor, predição, entropia, replay | Testáveis sem *mocks* |

Referências de padrões: Nystrom (2014); passo fixo com acumulador: Fiedler (2004).

## 6.3 Ordem do passo de simulação (invariante crítica)

`RunDirector.step(16,67 ms)` chama `Encounter.step()` e depois trata mortes. Dentro de `Encounter.step()`:

1. O Assaltante avança (decide regra, persegue ou progride de fase, abre oportunidades).
2. O jogador avança (cancelamento de recuperação, buffer, fases da ação, dash, postura, stagger).
3. Colisão do golpe inimigo → esquiva (i-frames) / parry / bloqueio / golpe não mitigado (**no máximo uma resolução defensiva por ataque**; o golpe não mitigado tira vida).
4. Colisão do golpe do jogador → punição `taken` e **dano, no máximo uma vez por ação**.
5. **Por último**, `OpportunitySystem.step()` expira as janelas. Se rodasse antes, uma janela resolvida no mesmo passo seria fechada como `expired` um passo cedo (condição de corrida encontrada e corrigida em 13/08).
6. Registro da distância operacional (dim 5).
7. `RunDirector`: se o jogador morreu, encerra a run; senão, se o Assaltante morreu, encerra o encontro (e, no terceiro, a sala).

## 6.4 Algoritmos

### Passo fixo

```
acumulador += Δt_real
enquanto acumulador ≥ passo:  simular(passo); acumulador −= passo      passo = 1000/60 ms
```

### PRNG Mulberry32

Estado de 32 bits; incremento pela constante de Weyl `0x6D2B79F5` seguido de misturas com `Math.imul` e *xorshifts*; saída em [0, 1). Mesma seed, mesma sequência (testado). Usado no sorteio do nascimento do inimigo por run.

### Projeção isométrica (dimétrica 2:1)

Tile lógico de 64 unidades; losango de tela com meia-largura 32 px e meia-altura 16 px.

```
col = x / 64,  row = y / 64
tela.x = (col − row) · 32          tela.y = (col + row) · 16          profundidade = x + y  (ordem de desenho)
inversa:  col = (Δx/32 + Δy/16) / 2     row = (Δy/16 − Δx/32) / 2     (converte o mouse em direção de mira)
```

Entrada WASD rotacionada 45° (`dx = ix + iy`, `dy = iy − ix`). A elevação de 26,57° (= arctan 0,5) do render no Blender casa com a razão 2:1.

### Leque de ataque (setor circular)

```
AttackSector = { origem, direção (unitária), alcance, meio_ângulo = π/4 }        cone de 90°
ponto p dentro   ⇔  |p − o| ≤ alcance  e  cos∠(p − o, direção) ≥ cos(meio_ângulo)
setor × caixa    ⇔  algum dos 4 cantos ou o centro da caixa está dentro
```

### Balde de 8 direções (sprites)

```
balde = round(atan2(y, x) / (π/4)) mod 8          0 = leste, sentido horário na tela
linha_da_folha = (balde + 4) mod 8                calibrado em 13/09 (sem inversão de linhas)
```

### Predição de ameaça

```
predictThreatMs(config, snapshot, alvo, horizonte):   simula a máquina de estados do inimigo fase a fase (até 8 iterações)
  idle/chasing : se já está no alcance → attacking; senão (d − alcance)/velocidade; se passa do horizonte → null
  attacking    : se o golpe ficaria ativo dentro do horizonte e o leque cobre o alvo → ms até o impacto; senão → recovering
  recovering   : avança para idle ou null
isPatientAttack(exposição, ameaças, alvo) = ∀ a ∈ ameaças: a.msUntilThreatens(alvo, exposição) = null
```

### Buffer de entrada e cancelamento

```
tryAction / tryDodge: se pode executar → executa; senão, se for armazenável e não for carregado → push no buffer (1 slot, 120 ms)
a cada passo: avança o estado → depois, se há entrada pendente executável, executa; se expirou (> 120 ms), descarta
recuperação + entrada de movimento → player.cancel{move}, volta a idle e move no mesmo passo
```

### Entropia, contagens decaídas, prior Beta, confiança

Ver 4.3. Implementadas literalmente em `entropyAccumulator.ts` e `profileAccumulator.ts`; o decaimento está em `decayedRatio.ts` e `decayedCount.ts`.

### Parry, postura e carga

```
alcance_carregado = interpolação linear entre alcance (minHold) e alcanceMáx (maxHold)
postura: 100 máx; −40 por bloqueio (3 bloqueios seguidos quebram) → stagger de 250 ms; regenera 50/s após 1 s parado em idle
parry ⇔ guarda levantada há < 150 ms quando o golpe conecta → o inimigo pula o resto do golpe e abre punição de 750 ms (vs. 500)
```

### Reconstrução do perfil

```
rebuildProfile(log, player_id):  eventos do jogador, ordenados por (início da sessão, seq) → reaplica as obs.* após o último obs.reset → ProfileAccumulator novo
propriedade: snapshot e domínio/confiança/omissão (dois relógios) idênticos aos do perfil ao vivo
```

### Composição procedural do chão *(planejada)*

```
composeFloor(seed, colunas, linhas, tileset) → matriz de tiles; PRNG semeado + regras simples de vizinhança; apenas visual
```

---

# 7. Tecnologias e pipeline de assets

## 7.1 Stack (versões verificadas em 16/10/2026)

| Tecnologia | Versão | Papel |
|---|---|---|
| **TypeScript** | 5.9.3 | Linguagem de todo o jogo e dos testes; `strict`, alvo ES2020, módulos ESNext |
| **Phaser** | 3.90.0 | Framework de jogo 2D: cenas, spritesheets, animação por quadros, câmera, entrada, `Graphics`, som. **Única dependência de runtime** |
| Renderizador | WebGL com retorno para Canvas (`Phaser.AUTO`) | Resolução lógica 1280 × 720, escalada para a janela |
| **Vite** | 5.4.21 | Servidor de desenvolvimento com HMR e empacotamento de produção |
| **Vitest** | 2.1.9 | Testes unitários e de integração, ambiente `node` (a lógica não depende de DOM nem de Phaser) |
| **fake-indexeddb** | 6.2.5 | Só para testes: simula o IndexedDB em Node |
| **IndexedDB** | API nativa do navegador | Armazenamento local do log |
| **Node.js** | 24.18.0 | Build e testes (não roda em produção) |
| **Blender** | 5.2.1 *(registro de 28/09)* | Renderização headless de personagens 3D em folhas de sprites |
| **Python / `bpy`** | embutido no Blender | Scripts `render_character.py` e `inspect_fbx.py` |
| **Git** + Conventional Commits | — | Versionamento; mensagens `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:` |
| **Markdown** | — | Specs, planos e documentos de pesquisa, versionados com o código |

Comandos: `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`. Quatro dependências de desenvolvimento: TypeScript, Vite, Vitest e fake-indexeddb.

## 7.2 Tecnologias avaliadas e decisões

Material direto para a seção de decisões técnicas da tese.

| Tema | Opção | Veredito | Razão |
|---|---|---|---|
| Motor | **Phaser 3** | ✅ Adotado | Web (sem instalação para participantes, coleta remota), API pronta, TypeScript de primeira classe |
| | Unity ou Godot | ⛔ Não adotado | O GDD original usava Unity; a escolha web favorece coleta remota e integração com TypeScript e Vitest. Sem registro de decisão próprio no repositório |
| | Three.js ou Babylon.js | ⏸ Migração futura possível | 3D real no navegador; como a lógica não importa a apresentação, ela sobreviveria a uma troca de renderizador |
| FSM do jogador | XState, fiume, robot | ❌ Rejeitados | Dependência para um problema pequeno |
| | Máquina à mão (união de literais + `switch`) | ✅ Adotada | Padrão de todo o código |
| Entropia | `shannon-entropy`, `binary-shannon-entropy` | ❌ Rejeitadas | Descontinuada / não faz a normalização por `ln n` com `n` fixo |
| | Implementação própria | ✅ Adotada | ≈ 8 linhas; mais fácil de testar e de defender |
| Colisão | Física Arcade ou Matter do Phaser | ❌ Não usada | Colisão própria (AABB para hurtbox, setor para ataque): pura e testável em Node |
| Armazenamento | **IndexedDB** atrás de `EventStore` | ✅ Adotado | Sem servidor; reconstrução local; trocável |
| | Servidor ou endpoint próprio | ⏸ Não adotado | Exige backend, hospedagem e processo ético mais pesado; a interface permite acrescentar depois |
| | Só arquivo baixado | ❌ | Não atende "o sistema continua aprendendo": o jogo precisa reabrir o histórico |
| Renderização de sprites | `blender-sprite-render`, BlenderSpriteGenerator | ❌ | Assumem modelo animado autocontido por arquivo; o pipeline precisa aplicar uma animação de um arquivo a um personagem de outro |
| | **Script próprio `render_character.py`** | ✅ Adotado | ≈ 260 linhas, headless, reprodutível por linha de comando |
| Animação esquelética em tempo real | Spine (pago), DragonBones | ⏸ Adiado | O pré-render já entrega fluidez suficiente; o autor não conhece Spine |
| Efeitos | Tween do Phaser; `postFX` (brilho, bloom); editor de partículas do Phaser | ✅ Escolhidos | Nativos, sem dependência nova. Ainda não implementados |
| IA do boss | *Dynamic scripting* | ✅ Planejado | Pesos de regra com *clipping*; `λ = 0` reproduz o boss-base |
| | N-grama de ações | ✅ Planejado | Determinístico (compatível com replay), explicável, barato em amostras |
| | Árvore de comportamento | ✅ Candidata | Boa explicabilidade (Kozik et al., 2021) |
| | LSTM e aprendizado profundo | ❌ Rejeitados | Poucos dados, não determinismo que quebra o replay, perda de explicabilidade |
| Áudio | Gerenciador de som do Phaser | ✅ Já disponível | Sem dependência nova. Fonte dos arquivos: ver 3.7 |

## 7.3 Pipeline de assets 3D → sprites

**Por que pré-renderizar:** o Phaser é 2D e não carrega FBX. Modelos 3D CC0 são renderizados em folhas de sprites multidirecionais, técnica clássica de jogos isométricos: dá volume e fluidez sem trocar de engine e sem tocar na lógica.

**Etapas:**

1. Fontes em `tools/blender/source/` (ignorada pelo git): KayKit Adventurers 2.0 (modelos, armas e textura) e KayKit Character Animations 1.1 (**161 clipes** para `Rig_Medium` e arquivos para `Rig_Large`), ambos CC0.
2. `blender --background --python tools/blender/render_character.py -- --character <modelo>.fbx --idle-fbx … --idle-action "Rig_Medium|Idle_A" --walk-fbx … --walk-action "Rig_Medium|Walking_A" --walk-frames 6 --out-key <entidade>`.
3. O script limpa a cena, importa o personagem, importa o FBX de animação, **remove os objetos que não pertencem ao personagem**, atribui a *action* (e o *slot*), monta luz de três pontos mais ambiente, posiciona câmera **ortográfica a 26,57°**, renderiza **8 azimutes (45° cada)** e compõe uma grade de 8 linhas (direções) × N colunas (quadros), em PNG 128 × 128 com fundo transparente.
4. No jogo: `load.spritesheet`; animações `idle_<linha>` (1 fps) e `walk_<linha>` (8 fps); escala uniforme pela altura visual (40).

**Armas hoje não são anexadas** ao personagem no render. O pacote tem os modelos (espada de uma e duas mãos, machados, arco, besta, adaga, cajado, varinha e escudos), e o passo pendente é prendê-los a um osso da mão antes de renderizar.

### Problemas técnicos encontrados e resolvidos (material para "desafios")

| Problema | Causa | Solução |
|---|---|---|
| Animação estática | Blender 4.4+ usa *Actions* em camadas: atribuir `.action` sem `.action_slot` avalia a pose de repouso sem erro | Atribuir `action.slots[0]` |
| Nome da *action* não encontrado | O segundo import renomeia o rig para `Rig_Medium.001` | Casar pelo sufixo `\|Idle_A` |
| Arquivos não gravados | Caminhos relativos não resolvidos | `os.path.abspath()` em toda saída |
| Enum de motor inexistente | `BLENDER_EEVEE_NEXT` não existe no Blender 5.2 | Usar `BLENDER_EEVEE` |
| Silhuetas pretas em certos ângulos | Uma única luz de sol | Iluminação de 3 pontos + ambiente |
| NLA sobrepondo a *action* | Trilhas NLA deixadas pelo import | Remover as trilhas |
| **"Manequim fantasma" em T-pose** | O FBX de animação traz um mesh de referência com armadura própria que nunca recebe *action* e renderizava por cima do personagem | Apagar todo objeto que não seja a armadura do personagem ou mesh ligado a ela |
| **Direção do sprite invertida** (três calibrações erradas, 07/09 a 13/09) | Dupla inversão de linhas (o array de pixels do Blender é de baixo para cima) mal interpretada; conferir só frente e costas não detecta o erro, pois a inversão preserva a simetria de pares opostos | Remover a inversão, `offset = 4`; verificado projetando o vetor *forward* do personagem e com renders de 512 px |

**Lição metodológica:** uma verificação que só testa pares simétricos (frente e costas) passa mesmo com o sistema quebrado; é preciso testar um eixo assimétrico (esquerda e direita).

**Extensão planejada** (3.3 e 3.4): renderizar tiles de chão (3 a 6) pelo mesmo caminho ortográfico; personagens novos no esqueleto `Rig_Medium`; folhas de animação por fase (ataque, esquiva, guarda, dano, morte) com quadros escolhidos por fase; armas anexadas.

## 7.4 Desenvolvimento assistido por IA *(declarar conforme as normas da instituição)*

O desenvolvimento usou o **Claude Code** (assistente de programação da Anthropic, modelos da família Claude) como par de programação, com um complemento (*superpowers*) que impõe um fluxo estruturado: discussão de alternativas → especificação → plano → execução por tarefas com **subagentes** e revisão por outro agente entre tarefas e ao fim do conjunto. Mensagens de commit são sempre aprovadas pelo autor antes de gravar. Integrações usadas: **Blender MCP** (inspeção da cena, usada para calibrar a direção dos sprites), o conector do **Google Drive** (leitura do texto da tese e das listas de referências) e o navegador para verificação visual.

**O autor tomou todas as decisões de pesquisa e de design** (enquadramento, dimensões, parâmetros, mecânicas); o assistente propôs alternativas, implementou sob TDD e revisou. Os subagentes revisores já encontraram defeitos relevantes (ver 8.2).

## 7.5 Metodologia de desenvolvimento

**Ciclo por sub-projeto:** (1) *brainstorming* com alternativas e decisões explícitas; (2) **spec** (`docs/superpowers/specs/`): motivação, escopo, fora de escopo, contratos, critérios de pronto e riscos; (3) **plano** (`docs/superpowers/plans/`): tarefas pequenas, cada uma com teste primeiro; (4) **implementação com TDD** (teste que falha → código mínimo → refatoração), um commit por tarefa; (5) **revisão** por tarefa e do conjunto, com achados bloqueantes corrigidos na hora; (6) **playtest manual** no navegador; (7) **atualização da documentação**. São **15 specs e 15 planos**.

**Princípios:** fatiamento vertical fino (cada sub-projeto mede algo de ponta a ponta); riscos primeiro (o sistema de oportunidades foi construído antes de qualquer medida); instrumento antes da intervenção; YAGNI e dependências mínimas; determinismo por construção; decisões rastreáveis com identificador e documento de origem; honestidade nos documentos ("riscos aceitos" e "limitações").

**Estratégia de testes** (369 testes em 32 arquivos; ≈ 4.340 linhas de teste para ≈ 3.920 de produção):

| Tipo | Exemplos |
|---|---|
| Unitário puro | Projeção e inversa, setor, entropia (casos-limite), decaimento, PRNG, balde de direção, zoom, `lockedMs` |
| Máquina de estados | Jogador (fases, cancelamento, buffer, dash) e Assaltante |
| Invariante e conservação | Soma dos desfechos = aberturas; reentrância de ouvintes; precedência |
| Integração | `Encounter` completo; `RunDirector`; cadeia do gravador até o armazenamento |
| **Equivalência** | `predictThreatMs` contra `Encounter.step()` real; **perfil reconstruído do log contra o perfil ao vivo** (exato, `toBe`) |
| Armazenamento | `EventStore` em memória e em IndexedDB simulado; NDJSON de ida e volta |
| Estático | `tsc --noEmit` em modo `strict` |
| Manual | Playtest no navegador e overlay de depuração |

---

# 8. Verificação, validação e plano experimental

## 8.1 Verificação (o software faz o que declara?)

| Item | Estado em 16/10/2026 |
|---|---|
| Testes automatizados | **369 testes em 32 arquivos**, todos passando (≈ 1,5 s) |
| Tipos | `tsc --noEmit` em modo `strict`, sem erros |
| Build | `vite build` sem erros |
| Código | ≈ 3.920 linhas de produção e ≈ 4.340 de teste |
| Propriedades verificadas | Conservação das oportunidades; equivalência da previsão de ameaça com o jogo real; **equivalência exata do perfil reconstruído com o perfil ao vivo**; determinismo por seed |
| Não coberto por teste | `ArenaScene` e a camada de apresentação; o comportamento no navegador (depende do playtest do autor) |

## 8.2 Lições aprendidas (defeitos que ameaçavam a validade dos dados)

Úteis para uma seção de "desafios" ou "ameaças à validade". O padrão se repete: **um problema de jogo vira um problema de dado**.

| Data | Defeito | Consequência | Correção |
|---|---|---|---|
| 13/08 | A expiração das janelas rodava antes da resolução dos acertos | Uma janela aproveitada era fechada como expirada | Expiração sempre por último no passo |
| 18/08 | Distância contada em milissegundos | A confiança passava do limiar quase de imediato | Contar em segundos |
| 06/09 | Ação carregada contada ao começar a carga | Cancelar a carga inflava a dim 2 | Contar só na execução |
| 07/09 | Colisão persistia por vários passos | Parry, bloqueio e stagger se repetiam | Uma resolução defensiva por ataque |
| 07 a 12/09 | **Hitbox retangular errava alvos na diagonal** | Cada erro geométrico virava um **falso recuo** na dim 4 | Leque angular; dados anteriores incomparáveis |
| 12/09 | Critério "simulação concorda com a colisão real" **argumentado**, não testado | Faltava prova | Teste de equivalência; revelou viés de ≈ 16 ms, conservador |
| 07 a 13/09 | **Direção do sprite invertida** (três calibrações erradas) | Personagem olhando para o lado oposto | Verificação com eixo assimétrico (esquerda e direita) |
| 12/09 | **Manequim fantasma** em T-pose renderizado por cima do personagem | Todos os quadros quebrados | Apagar objetos que não são do personagem |
| 30/09 | **Log gravado em ordem não causal** (o efeito antes do gatilho) | O preditor aprenderia sequências trocadas, e nenhum log gravado poderia ser reordenado depois | Gravador assina o barramento com prioridade; testes de ordem |
| 30/09 | **Run interrompida pelo fechamento da aba ficava sem fim** | A evidência da sala interrompida vazava para a sala seguinte | Fechamento automático na abertura (`abandoned`) |
| 30/09 | **Reconstrução misturava jogadores** após uma importação | Perfil de duas pessoas num só | Filtrar por `player_id` |
| 30/09 | Eventos perdidos ao importar e reiniciar a cena | Buraco no log | Parar a simulação, descarregar o buffer e fechar o armazenamento só depois |
| 01/10 | Cadência do bot de teste exatamente no limite de um critério de cobertura | Qualquer ajuste de balanceamento quebraria o teste | Margem na cadência; asserções de equivalência intocadas |

**Duas lições gerais.**
1. A verificação precisa ser desenhada para **falhar quando há erro**: conferir só frente e costas passa com o sprite invertido; conferir só "o perfil parece certo" passa com a ordem do log trocada.
2. A **revisão do conjunto** encontra o que as revisões por tarefa não encontram: no 5a, uma revisão final por um modelo mais capaz achou três problemas importantes depois de todas as tarefas terem sido aprovadas individualmente.

## 8.3 Ameaças à validade (conhecidas)

- Dados anteriores ao leque angular (07/09) e à versão `0.0.2+combatB` não são comparáveis com os atuais nas dimensões afetadas.
- Viés de discretização da previsão de ameaça (≈ 16 ms, conservador).
- O tipo `utility` não tem ação: a dim 2 nunca chega a entropia máxima.
- A regra de 8 ações mínimas por segmento de `H` não está implementada.
- `retreat` é **inferido**, não observado.
- As sete dimensões dividem o mesmo orçamento de oportunidades por sala.
- **Um único arquétipo de inimigo:** o perfil é medido diante de um só padrão de ataque.
- Os parâmetros de balanceamento são valores iniciais e ainda não passaram por playtest registrado.
- **Poucos jogadores:** não há registro, nos documentos nem nas conversas, de dados de outros jogadores além do autor, e nenhum log foi analisado ainda.
- Duas abas simultâneas, ausência de compactação e as demais limitações de 5.8.

## 8.4 Plano de validação *(proposta, a confirmar com o orientador)*

A D-0 muda o desenho experimental. O desenho antigo (Estudo 1 com ICC por sessão independente e Estudo 2 com sala de transferência) pressupunha o perfil reiniciado a cada sessão e a transferência como variável central; nenhum dos dois vale mais. Proponho quatro verificações, da mais barata para a mais cara:

| # | Verificação | Pergunta | Dados | Métrica | Pré-requisito | Status |
|---|---|---|---|---|---|---|
| **V0** | **Separação de estilos por agentes sintéticos** (validade discriminante) | O perfil distingue estilos de jogo conhecidos? | Agentes scriptados com estilos distintos (por exemplo agressivo, evasivo, paciente, repetitivo), muitas runs | Os perfis divergem na direção esperada por dimensão | Agentes sintéticos (nova camada, ⬜) | ⬜ |
| **V1** | **Estabilidade das dimensões** (P1) | As dimensões medem traços estáveis? | Valores por sala de cada jogador (ou agente) | `ICC(1,1)` por dimensão, intervalo por *bootstrap*; critério D1: `< 0,50` é removida | Dados de vários jogadores ou agentes | 🔵 |
| **V2** | **Previsibilidade** (P2) | A acurácia de previsão sobe com o histórico? | Log de ações | Curva de acurácia top-1 e top-3 contra a quantidade de jogo; comparação com as linhas de base | Camada preditiva (5b) | ⬜ |
| **V3** | **Ablação do boss** (P3) | O boss com o modelo é mais eficaz que sem ele? | Mesmo boss com e sem modelo, jogado por agentes e, se couber, por pessoas | "Eficácia" a definir | Boss (sub-projeto 6) | 🔵 |

**Um problema de medida a resolver antes da V1.** O desenho antigo calculava o ICC sobre os `profile.snapshot` de saída de sala no relógio traço. Com γ = 0,87 cada instantâneo **carrega ≈ 87% da evidência do anterior**, de modo que instantâneos consecutivos são fortemente correlacionados por construção, e o ICC tenderia a **superestimar** a estabilidade. A unidade de medida do ICC deveria ser o **valor da dimensão calculado só com as observações de cada sala** (sem herdar o passado), obtido do log. 🔵 decisão.

**Por que a V0 vem primeiro.** Ela exercita a hipótese central da D-0 (o sistema perfila bem) **sem participantes humanos, sem comitê de ética e sem boss**, e serve também de teste de regressão automatizado do pipeline inteiro. Agentes com estilos deliberadamente distintos têm precedente na literatura de personas procedurais (Holmgård et al., 2019).

## 8.5 Dados-piloto, dados oficiais e congelamento

- **Dados-piloto:** as partidas do próprio autor e dos agentes durante o desenvolvimento. Servem para construir e depurar o preditor e o boss. **Podem ser descartados** quando o jogo mudar; cada log leva a versão do jogo.
- **Dados oficiais:** os que entram nos resultados da tese. Só podem ser coletados com a versão **congelada**.
- **Congelar** significa: nada que mude jogabilidade, balanceamento ou geometria pode mudar depois da coleta oficial. Mudam sem exigir nova versão: arte, som, HUD e arena visual (3.3), desde que a lógica fique igual.
- O que exige nova versão: velocidades, tempos, hurtboxes e alcances, vida e dano, novos inimigos, novas ações, estrutura de salas e mudanças de regra de dimensão.

## 8.6 Questões metodológicas abertas

| Questão | Observação |
|---|---|
| Participantes humanos, agentes sintéticos, ou os dois? | Muda o custo e a necessidade de comitê de ética (CEP) |
| Quantos jogadores ou agentes bastam? | Cálculo amostral ainda não feito |
| Submissão ao comitê de ética | O GDD original já alertava que a aprovação demora |
| Definição de "eficaz" para o boss | Necessária para a V3 |
| Unidade de medida do ICC | Ver 8.4 |
| Retenção em segunda sessão (D5) | Adiada; o esquema já prevê `session_idx` |
| Orçamento de oportunidades para sete dimensões | Afeta o ritmo em que cada dimensão atinge o limiar de confiança |
| Quantas runs por jogador são necessárias para a curva da V2 | Depende da taxa de ações por run |
| Confirmação do orientador sobre a D-0 | Sem registro nas conversas |

---

# 9. Decisões, histórico e pendências

## 9.1 Decisões

Não mudam sem discussão explícita; mudar vira emenda registrada aqui.

| ID | Questão | Decisão | Data |
|---|---|---|---|
| **D-0** | Foco do TCC | O **sistema de profilamento do jogador** é o objetivo principal. O boss preditivo valida o sistema (subproduto). A melhora do jogador é consequência | 16/10/2026 |
| D1 | Corte de dimensões | Nenhum corte a priori: mantêm-se as sete. Dimensões com `ICC(1,1) < 0,50` são removidas **antes da validação do boss**. O corte é resultado, com justificativa estatística | 08/2026; texto ajustado 16/10 |
| D2 | `missed` e `expired` | Ambos contam no denominador; a distinção é diagnóstica | 08/2026 |
| D3 | `invalid` | Fora do numerador e do denominador; exige motivo | 08/2026 |
| **D4** | Persistência do perfil | **Revisada em 30/09/2026:** acumula entre runs **e entre sessões**; só é zerado por ação explícita (`obs.reset`), sem apagar o histórico. *Antes:* reiniciava por sessão | 30/09/2026 |
| D5 | Retenção em segunda sessão | Não decidido; o esquema suporta | — |
| D6 | Suavização | Contagens decaídas, não média móvel exponencial sobre a razão | 08/2026 |
| D9 | Taxonomia da dimensão 2 | Remove `aéreo`; conjunto `{leve, pesado, carregado, arremesso, utilitário}`, n = 5 | 09/2026 |
| — | Quem adapta | Só o boss. Inimigos comuns têm IA fixa | reconfirmada 12/09 |
| — | Sem eixo Z | Combate planar; bloqueia a dim 7 | 08/2026 |
| — | Janela da dim 6 | **Revisada em 30/09/2026:** só a parte não cancelável da ação (`lockedMs`). *Antes (12 a 30/09):* o comprometimento total | 30/09/2026 |
| — | Lógica separada da apresentação | `combat/`, `opportunity/`, `profile/`, `ai/`, `game/` e `telemetry/` não importam Phaser nem `visual/` | 08/2026 |
| — | Armazenamento do log | IndexedDB atrás de `EventStore` | 30/09/2026 |
| — | Estrutura de jogo | Encontro (inimigo morre), sala (3 encontros), run (jogador morre) | 30/09/2026 |
| — | Combate | Estilo ágil (referência *Hades*): preso só na preparação e no golpe; recuperação cancelável | 30/09/2026 |
| — | Reconstrução do ambiente | Reconstruir **apresentação e casca de gameplay**; manter o núcleo lógico | 16/10/2026 |
| — | Arena | Tiles feitos no Blender, **compostos proceduralmente**, expansível | 16/10/2026 |
| — | Estilo visual | Bem poligonal, "Zelda antigo"; herói novo com arma nova | 16/10/2026 |
| — | Terminologia | "Modelagem de jogador" e "adaptação online"; evitar prometer aprendizado de máquina | proposta, 16/10 |
| — | Consumo pelo boss | Perfil e modelo congelados na entrada da arena | texto atual da tese; 🔵 reconfirmar |

**Observação:** os identificadores **D7 e D8 não constam** em nenhum documento atual (as decisões saltam de D6 para D9). Se existiram, o registro se perdeu.

## 9.2 Cronologia

| Data | Marco | Entrega principal |
|---|---|---|
| 08/07 a 03/08 | GDDs e primeiro levantamento de referências | Enquadramento 1 (Unity, arena por LLM) |
| 13/08 | Núcleo jogável e `OpportunitySystem`; movimento e câmera | Loop fixo, PRNG, barramento, esquiva e punição |
| 18/08 | Esqueleto visual; ciclo de vida da oportunidade; acumuladores decaídos; Família A (dims 3 e 5) | Quatro desfechos, dois relógios, formato do instantâneo |
| 24 e 25/08 | Projeção isométrica | Migração para isometria 2:1 e tiles reais |
| 06/09 | Registro de ações e entropia (dim 2); mira, arco, arma pesada e troca (dim 1) | Combate orientado a dados |
| 07/09 | Pipeline de assets 3D; kit defensivo (dim 4); leque de ataque | Sprites pré-renderizados; bloqueio, parry, postura |
| 12/09 | Janela segura (dim 6) | Previsão de ameaça e predicado de paciência |
| 13/09 | Correção da direção dos sprites e do manequim fantasma | Sprites corretos (commit em 30/09) |
| 28/09 | Documento consolidado (20 seções) | Base da escrita |
| 30/09 | **5a: runs, HP e telemetria persistente** | `RunDirector`, log em duas camadas, IndexedDB, reconstrução, exportar e importar (`a96bc37..28589a0`) |
| 30/09 | **A: escala e câmera** | Zoom 2×, personagem de 40 px, câmera de interface (`1f0aa4f`) |
| 01/10 | **B: combate fluido** | Recuperação cancelável, buffer, esquiva responsiva, nova janela da dim 6 (`676c9fc..5a998c3`, branch `combat-b`) |
| 16/10 | **D-0 e este documento** | Foco no sistema de profilamento; especificação do novo ambiente |

Estado do repositório: 156 commits; 15 specs e 15 planos; `master` em `1f0aa4f`, **sem o combate B**; `combat-b` com o B e **ainda local**, com duas alterações sem commit.

## 9.3 Pendências abertas

| Área | Pendência | Bloqueia |
|---|---|---|
| **Pesquisa** | Confirmar a D-0 com o orientador | Reescrita da tese |
| | Definir "eficaz" (P3), nº de jogadores ou agentes, humanos ou sintéticos, comitê de ética | V1 a V3 |
| | Decidir a unidade de medida do ICC (8.4) | V1 |
| | Reconciliar parâmetros do boss (±15% do GDD contra *clip* `[0,25; 4]·base`) | Boss |
| **Tese** | Reescrever título, resumo, introdução, §2.4 e §2.5, §3.1, §3.3, §3.4 e §4 (Apêndice B) | Entrega |
| | Corrigir referências (Motta; páginas de Schmidt e Bjork; ano de Corbett e Anderson; Smith) e acrescentar as da camada preditiva | Entrega |
| **Jogo** | Playtest do combate B, do zoom e das teclas F2, F8 e F9 | Merge |
| | Mesclar `combat-b` no `master` (avanço direto) e dar push | — |
| | Definir *perfect dodge*, a ação `utility`, o design do boss, outros arquétipos e a estrutura de salas | Boss, E4 |
| **Ambiente (E1 a E4)** | ✅ E1 (HUD de análise e cena modularizada) feito em 16/10. Faltam: arena procedural (E2), herói e inimigo comum (E3), chefe (E4). Playtest do painel no navegador pendente | — |
| | Decidir a "arma nova" | E3 |
| **Áudio** | Decidir a fonte (CC0, síntese em código); registrar licenças; decidir o `audio_on` no log | E3 |
| **Dados** | Registrar os dados-piloto; definir o ponto de congelamento | Coleta oficial |
| **Repositório** | ✅ README, `_unused/` e `LICENSES.md` resolvidos no E1. Pendente: conferir a licença de `grass.png` e `water.png`; revisar `public/assets/exemplo/` e `sprites/` (sem referência no código); trazer o documento de arquitetura v1.1 para dentro do repositório | — |
| **Lacunas do sistema** | Ver 4.8 | — |

## 9.4 Pendências aceitas (follow-ups registrados)

**Do 5a** (aceitas na revisão final): falha permanente de gravação faz o buffer crescer e a spec ainda descrevia o comportamento antigo; uma falha parcial do boot pode duplicar o temporizador de gravação; a última gravação ao fechar a cena pode se perder; só a última run de cada jogador é fechada como abandonada; duas abas simultâneas produzem um perfil que nenhuma teve.

**Do B:** `player.cancel{attack}` pode não ser seguido de `player.action`; E, Q e 1/2/3 apertados em certas fases não cancelam nem entram no buffer; os campos de direção não são zerados em `reset()` e `respawn()` (a próxima entrada os sobrescreve); alguns testes têm título que promete mais do que verificam.

**Heranças menores:** `as unknown as P` no valor padrão do perfil em `Encounter`; `profileSink.ts` importa `DefensiveLabel` do acumulador (dependência reversa só de tipos); `start()` duplo do `RunDirector` sem teste.

---

# Apêndice A: Referências e situação da verificação

**Método (16/10/2026):** metadados conferidos no Crossref, na API do arXiv, em páginas dos editores (PMC, SBC, UCSC) e por busca na web. **Os artigos completos não foram lidos.** Citar só depois de conferir na fonte, como o próprio levantamento do Drive recomenda.

## A.1 Referências do texto atual da tese (31)

| Referência | Papel sob a D-0 | Verificação | Observação |
|---|---|---|---|
| Bauckhage, Drachen e Sifa (2015) | Contraste com agrupamento; estabilidade por reamostragem | Parcial | DOI 10.1109/TCIAIG.2014.2376982; volume e páginas não vistos |
| Beck (2002) | Metodologia (TDD) | Não conferida | Livro |
| Chiu et al. (2014) | **Central** (N-grama) | ✅ | J. Internet Technol. 15(7):1209-1215; N-grama com árvore de sufixos, ≈ 40% de ganho |
| Corbett e Anderson (1994) | **Central** (medida por oportunidade) | ✅ | **Ano:** a tese usa 1994, o Crossref registra 1995 |
| Drachen et al. (2013) | Contraste (agrupamento) | Parcial | Existe como arXiv:1407.3950 (comentário "FDG 2013"); páginas 245-252 não conferidas |
| Efron e Tibshirani (1993) | IC por *bootstrap* | Não conferida | Livro |
| Ericsson, Krampe e Tesch-Römer (1993) | Secundária (pedagogia) | ✅ | |
| Fiedler (2004) | Técnica (passo fixo) | Não conferida | Página web |
| Gick e Holyoak (1983) | Secundária | ✅ | |
| Guadagnoli e Lee (2004) | Secundária (ponto ótimo de desafio) | ✅ | |
| Hunicke (2005) | Contraste (DDA) | ✅ | |
| Hunicke e Chapman (2004) | Contraste (DDA) | ✅ | p. 91-96 |
| Jennings-Teats, Smith e Wardrip-Fruin (2010) | Contraste (adaptação estrutural) | ✅ | |
| Koo e Li (2016) | **Central** (ICC) | ✅ | **Errata** confirmada (PMC5731844): `(k+1)` → `(k−1)` na fórmula do ICC(1,1) |
| Kozik et al. (2021) | Candidata (árvore de comportamento) | Parcial | Só pré-print (arXiv:2111.12144) |
| Laird (2001) | **Central** (predição de ação) | ✅ | DOI 10.1145/375735.376343 |
| Machado, Fantini e Chaimowicz (2011) | **Central** (taxonomia) | Parcial | Páginas 50-57 vêm de uma dissertação, não do IEEE |
| Magill e Hall (1990) | Secundária | ✅ | |
| Mahmoudi-Nejad, Guzdial e Boulanger (2021) | Secundária (crítica a regras predefinidas) | ✅ | p. 164-171; arXiv:2110.04146 |
| Millington (2019) | **Central** (N-grama) | Não conferida | Livro, 3ª ed. |
| **Motta et al. (2015)** | Contexto (predição em jogos de luta) | ❌ **Não encontrada** | Nenhuma busca achou; nomes de autores parecem incompletos. Conferir nos anais do SBGames 2015 |
| Nystrom (2014) | Técnica (padrões) | Não conferida | Livro |
| Pelánek (2017) | **Central** | ✅ | |
| Schmidt e Bjork (1992) | Secundária | ✅ | **Páginas:** a tese traz 207-217, o Crossref registra 207-218 |
| Shannon (1948) | **Central** (entropia) | Não conferida | Clássico |
| Shea e Morgan (1979) | Secundária | ✅ | |
| Shrout e Fleiss (1979) | **Central** (ICC) | ✅ | |
| Smith et al. (2011) | **Central** (taxonomia) | Parcial | O relatório UCSC-SOE-11-13 existe; existe também o artigo curto FDG'11 (p. 301-303, DOI 10.1145/2159365.2159419). Escolher qual citar |
| Spronck et al. (2006) | **Central** (mecanismo do boss) | ✅ | |
| Stafford e Dewar (2014) | **Central** para as dimensões de repertório (variar no início prevê desempenho posterior) | ✅ | O Crossref lista 2013 (publicação online); volume e número de 2014 |
| Yannakakis e Togelius (2018) | **Central** (contexto) | Não conferida | Livro |

Resumo: **18 confirmadas, 5 parciais, 7 não conferidas (livros e clássicos), 1 não encontrada.**

## A.2 Pool do Drive (fora da lista da tese)

| Grupo | Itens | Situação sob a D-0 |
|---|---|---|
| **Continuam úteis** | Bakkes et al. (2009), Holmgård et al. (2019) e Liapis et al. (2015) (agentes sintéticos), Yannakakis e Togelius (2011, EDPCG), Elshamy et al. (2026) (contraste: habilidade em classes discretas), Teoi et al. (2024) (contraste: perfil por questionário) | Candidatas a citação |
| **Secundárias** | Treino adaptativo: Landsberg et al. (2012), Van Buskirk et al. (2021), Fraulini et al. (2024), Thomas et al. (2025) | Entram na discussão; voltam a ser centrais só se o orientador quiser a tese de aprendizagem |
| **Obsoletas** (enquadramento 1) | LLM, gramática GBNF, SDXL e ControlNet, Unity e MCPs de Unity, PCGRL, texturização, geração de encontros de boss | Fora do trabalho atual, salvo se a geração de arena voltar |

**Metadados resolvidos nesta verificação:** revisão de escopo *Challenge accepted* (Thomas, Paul, Rasenyalo, Jones, Hendricks; 2025; *J. Motor Behavior* 57(4):444-462); meta-análise de intervenções de treino adaptativo (Fraulini, Marraffino, Garibaldi, Johnson, Whitmer; 2024; *Military Psychology* 37(5):479-493); Teoi et al. (SBGames 2024, Manaus, p. 396-415, DOI 10.5753/sbgames.2024.240282); autores do arXiv:2112.04406 (Fernandes, Jørgensen, Poldervaart).

## A.3 Lacunas de literatura para o foco atual

A camada preditiva e a validação por agentes pedem leitura que o pool não cobre bem: predição de ação do jogador e do oponente além de Laird e Chiu; métricas de previsibilidade; avaliação de modelos de jogador; produção nacional recente sobre modelagem de jogador. Isso é tarefa de busca; **nenhuma referência nova foi proposta aqui sem verificação**.

---

# Apêndice B: Mapa para a tese e divergências do texto atual

## B.1 Mapa das seções deste documento para os capítulos da tese

| Capítulo da tese (`TCC2-Atualizado.docx`) | Consultar neste documento |
|---|---|
| Resumo e Introdução | 1 (objetivo, posicionamento), 4.1, Apêndice A |
| 2. Revisão de literatura | 1.4 e 1.5, 4.2 a 4.6, Apêndice A |
| 3.1 Domínio | 2 (mecânicas), 2.7 (estrutura de jogo) |
| 3.2 Materiais | 7.1 a 7.4 |
| 3.3 Métodos | 7.5, 9.2 |
| 3.4 Protocolo de avaliação | 8.4 a 8.6 |
| 4.1 Arquitetura | 6.1 a 6.3 |
| 4.2 Oportunidades e fluxo de dados | 4.2, 5 |
| 4.3 Perfil | 4.3, 4.7 |
| 4.4 Verificação | 8.1, 8.2 |
| 4.5 Compromissos | 6.2, 9.1 |
| *(novo)* Camada preditiva e HUD de análise | 4.5, 3.5, 4.7 |
| 5. Considerações finais | 8, 9.3 |

## B.2 O que o texto atual da tese precisa corrigir

O texto foi escrito entre 12 e 28/09 sobre o enquadramento 2 (aprendizagem). Diverge do estado atual em:

| Trecho | O texto diz | Hoje |
|---|---|---|
| Título, resumo e §1 | Pergunta: **aprendizado transferível**; chefe adaptativo como mecanismo central | **D-0:** sistema de profilamento é o foco; boss preditivo valida |
| §2.4 e §2.5 | Núcleo pedagógico (ponto ótimo de desafio, interferência contextual) | Passam a discussão ou consequência |
| §3.1, progressão | Perfil **reiniciado entre sessões**; sessão = calibração → treino → transferência; sala de transferência | **D4 revisada:** perfil persiste entre sessões; sem sala de transferência (8.4) |
| §3.1, regras | Troca de arma de 250 ms; invulnerabilidade da esquiva de 200 ms | **150 ms** e **150 ms** (esquiva: 180 ms, recarga 200, deslocamento 120) |
| §3.1, janela de esquiva | "Aberta durante os 400 ms de anúncio" | **550 ms** (telegrafia 400 + golpe 150) |
| §3.3, fase 6 | Exposição = comprometimento completo da ação | `lockedMs`: só preparação + golpe |
| §3.3, fases | Seis fases até a janela segura | Faltam o 5a (runs e telemetria), A (escala) e B (combate fluido) |
| §3.4 | Estudos 1 e 2 (ICC; adaptativo contra controle com sala de transferência) | Redesenho em 8.4 (V0 a V3) |
| §4.1, Figura 14 | Módulos sem `game/` e `telemetry/` | Atualizar a figura |
| §4.2 | "Dos seis motivos de invalidação, apenas um é emitido" | **Três** são emitidos |
| §4.3, último parágrafo | "Nenhuma parte do jogo invoca as fronteiras de sala e encontro" | O 5a as chama; o perfil acumula em tempo real |
| §3.2 e §4.4 | 127 commits; 259 testes em 22 arquivos; ≈ 2.770 linhas de teste contra ≈ 2.280 de produção | 156 commits; **369 testes em 32 arquivos**; ≈ 4.340 contra ≈ 3.920 |
| Referências | Ver A.1 | Motta; páginas de Schmidt e Bjork; ano de Corbett e Anderson; escolha de Smith |

Regra de redação do próprio modelo da tese: usar "indicam", "sugerem" e "contribui para" para o que não foi medido; reservar "demonstrou" e "comprovou" para o que foi medido.

---

# Apêndice C: Glossário

| Termo | Significado |
|---|---|
| **Oportunidade / janela** | Intervalo em que o jogo oferece ao jogador a chance de executar uma ação (esquivar, punir) |
| **Desfecho** | Como a janela terminou: aproveitada, errada, expirada ou inválida |
| **Domínio** | Estimativa do quanto o jogador domina uma dimensão (0 a 1) |
| **Déficit** | `1 − domínio` |
| **Confiança** | Quanta evidência sustenta o domínio (0 a 1) |
| **Dimensão / família** | Uma das sete medidas do perfil; família A = razão sobre oportunidades, família B = entropia de repertório |
| **Relógio traço / estado** | Os dois ritmos de esquecimento do perfil: longo (salas) e curto (encontros) |
| **Fronteira** | Momento em que o perfil aplica o decaimento (fim de encontro, saída de sala) |
| **Instantâneo (`profile.snapshot`)** | Foto do perfil na saída de uma sala |
| **`lockedMs`** | Parte não cancelável de uma ação (preparação + golpe) |
| **Telegrafia** | Aviso do ataque do inimigo (400 ms) |
| **Parry / bloqueio / postura** | Defesa por timing / defesa que gasta a barra de postura / a barra |
| **Encontro / sala / run** | Combate contra um inimigo / 3 encontros / do início até a morte do jogador |
| **Observação (`obs.*`)** | Registro de uma alteração do perfil; fonte da reconstrução |
| **Reconstrução / replay** | Recalcular o perfil reaplicando as observações do log |
| **Ablação** | Comparar o sistema com e sem um componente |
| **Avaliação prequencial** | Prever cada passo usando só o que veio antes dele |
| **ICC** | Coeficiente de correlação intraclasse: proporção da variância devida a diferenças entre indivíduos |
| **N-grama** | Modelo que prevê o próximo símbolo pelos *n−1* anteriores |
| **Persona procedural** | Agente sintético com um estilo de jogo definido |
| **Congelamento** | Fixar jogabilidade, balanceamento e geometria antes da coleta oficial |
