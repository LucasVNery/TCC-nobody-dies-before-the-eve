# Pipeline de Assets 3D Pré-renderizados (Jogador + Assaltante) — Design

**Data:** 07/09/2026
**Sub-projeto:** terceiro da trilha de assets visuais do jogo (antecipado de §8.4/§8.5 dos specs de dim 2 e dim 1)
**Depende de:** nenhuma dependência de código — não toca `combat/`, `opportunity/`, `ai/`, `profile/`
**Documento guarda-chuva:** decisão já travada em `docs/superpowers/specs/2026-09-06-registro-acoes-entropia-repertorio-design.md` §8.5 (KayKit Adventurers, pipeline Blender) e memória `project_weapon_visual_pipeline_decision.md`

---

## 1. Contexto e objetivo

Os sub-projetos 1 e 2 da trilha de repertório de armas (dim 2, dim 1) são só código TypeScript testável por Vitest. Este é o primeiro sub-projeto que produz **assets de verdade** em vez de lógica: substitui os prismas placeholder do jogador e do Assaltante por sprites 3D pré-renderizados (estilo Diablo/Torchlight), mantendo o jogo 100% Phaser 2D — sem motor 3D em runtime, sem mudança na arena/tiles isométricos.

Diferença chave em relação aos sub-projetos anteriores: o "critério de pronto" aqui não é um teste automatizado — é verificação visual manual (capturas de tela via automação de navegador), porque o resultado é inerentemente visual.

### 1.1 Restrições técnicas verificadas nesta sessão (não presumidas)

| Restrição | Status verificado |
|---|---|
| Blender disponível no ambiente | **Não estava instalado.** Instalado via `winget install BlenderFoundation.Blender` nesta sessão (Blender 5.2.1 LTS), confirmado rodando headless via `blender --version --background`. |
| Acesso à internet | Confirmado (ping bem-sucedido a kaylousberg.com). |
| KayKit Adventurers acessível sem login/pagamento | Confirmado — CC0, tier grátis sem login, download via fluxo padrão do itch.io (automatizável por navegador). |
| Ferramenta de retarget de animação sem login | Quaternius Universal Animation Library tem ferramenta web de retarget que roda no navegador sem exigir login (ao contrário do Mixamo, que exige conta Adobe) — escolhida por isso. |

### 1.2 Decisões de brainstorming desta rodada

| Decisão | Escolha |
|---|---|
| Quem executa o pipeline | Claude, de ponta a ponta — Blender local via CLI, download/retarget via automação de navegador (Claude in Chrome) no Chrome do usuário. Usuário só destrava passos que exijam interação humana genuína (ex: captcha), se aparecerem. |
| Fatia inicial de animação | Só `idle` + `walk`, **8 direções**. Ataques (light/heavy/charged × 3 armas + tiro do arco) ficam para sub-projeto(s) futuro(s) — mesmo padrão de fatia vertical fina dos sub-projetos 1 e 2. |
| Arma no sprite | Sem arma nas mãos nesta fatia — não há sprite de ataque ainda, não vale renderizar 3 variações (uma por arma) antes de saber se o pipeline funciona. |
| Escopo de entidades | Jogador **e** Assaltante juntos, usando dois personagens diferentes do pack KayKit Adventurers (5 disponíveis no tier grátis) para diferenciação visual. |
| Fonte de animação | Quaternius Universal Animation Library (retarget no navegador, sem login) — Mixamo descartado para automação porque exige login numa conta Adobe do usuário. |
| Ferramenta de render | `blender-sprite-render` (GitHub, headless via `blender --background --python`) — preferido sobre `BlenderSpriteGenerator` porque este último é um addon pensado para uso interativo dentro da GUI do Blender, e este ambiente não tem sessão gráfica confiável para automação de GUI. |

---

## 2. Escopo

### 2.1 Entra

- Download do pack KayKit Adventurers (CC0) via automação de navegador.
- Seleção de 2 personagens do pack (jogador, Assaltante).
- Retarget das animações `Idle` e `Walk` via ferramenta web da Quaternius, exportando FBX animado por personagem.
- Render headless via Blender (`blender-sprite-render` ou fork ajustado), 8 direções, sem arma equipada, fundo transparente.
- Composição dos PNGs renderizados em sprite sheets consumíveis pelo Phaser (`scene.load.spritesheet`).
- Reescrita de `src/visual/directionalSprite.ts`: troca o retângulo+seta atual por seleção de frame direcional (bucket de 8 direções a partir do vetor `facing`) + avanço de frame de animação (idle vs. walk) ao longo do tempo.
- Scripts do pipeline (download, retarget, render, composição) versionados em `tools/` (ou local equivalente, a decidir na fase de plano) para serem reexecutados quando animações de ataque entrarem.
- Verificação visual manual via captura de tela (Claude in Chrome), confirmando as 8 direções e a troca idle↔walk em jogo real.

### 2.2 Não entra (sub-projetos/iterações futuras)

- Animações de ataque (light/heavy/charged de qualquer arma, tiro do arco) — precisam de sincronismo com o timing startup/active/recovery já existente em `combat/actionRegistry.ts`, tratado à parte.
- Arma equipada aparecendo no sprite (prop attachment).
- Kit defensivo, predicado de janela segura, boss adaptativo — inalterados, fora do escopo deste documento (já fora de escopo desde os specs anteriores).
- Efeitos de ataque (postFX, Phaser 3 Particle Editor) — documentados em §8.5 do spec de dim 2, mas dependem de haver sprite de ataque primeiro; não fazem parte desta fatia.
- Qualquer mudança em `combat/`, `opportunity/`, `ai/`, `profile/` — a separação lógica/visual já travada na arquitetura do projeto permanece intacta.

### 2.3 Critério de pronto

1. Sprite sheets de `idle` e `walk` existem para as duas entidades (jogador, Assaltante), 8 direções cada.
2. `ArenaScene` carrega os sprite sheets sem erro (`npm run dev` sobe sem exceção relacionada a assets).
3. Verificação visual (captura de tela via Claude in Chrome, não teste automatizado): jogador e Assaltante aparecem como sprite 3D — não mais o retângulo colorido —, e o frame direcional muda corretamente conforme o personagem se move nas 8 direções.
4. `npm test`/`npm run typecheck` continuam 100% verdes — nenhuma lógica de `combat/`/`opportunity/`/`ai/`/`profile/` foi tocada.

---

## 3. Pipeline — passo a passo

### 3.1 Download (KayKit Adventurers)

Via automação de navegador (Claude in Chrome), sem login: página `kaylousberg.itch.io/kaykit-adventurers` → baixar o tier grátis → arquivos `.FBX`/`.GLTF` de 5 personagens. Escolher 2 (a definir no momento da execução, depois de ver os nomes reais disponíveis no pack).

### 3.2 Animação (retarget via Quaternius)

Cada modelo FBX do KayKit entra na ferramenta web da Quaternius Universal Animation Library (sem login) → aplicar os clipes `Idle` e `Walk` da biblioteca (260 clipes disponíveis, cobre esses dois) → exportar FBX animado por personagem.

**Risco explícito:** essa ferramenta pode não ser 100% automatizável por navegador de ponta a ponta (ex: o export pode cair na pasta de Downloads do usuário e precisar ser localizado/movido por script, em vez de ir direto para o repositório). Mitigação: testar com um personagem só primeiro, confirmar o fluxo completo, só then repetir para o segundo.

### 3.3 Render (Blender headless)

```
blender --background --python blender_batch_render.py -- \
  --input <pasta com os FBX animados> \
  --output <pasta de sprites> \
  --rotations 8 \
  --animations idle,walk
```

`--rotations 8` é o pedido deste documento; o script publicado documenta `--rotations 4` nos exemplos — **a verificar na implementação** se o parâmetro aceita 8 diretamente ou se o script precisa de um ajuste pequeno (é um script Python aberto, editável). Isso não muda o design, é um detalhe de execução.

Saída: PNGs com fundo transparente, um por (personagem × animação × direção × frame).

### 3.4 Composição em sprite sheet

Idle: 1 frame por direção (pose estática — sem “respirar”, para manter a fatia mínima). Walk: ~6 frames por direção (ciclo de caminhada legível — número exato ajustável na implementação conforme o resultado visual). Os PNGs de uma mesma (personagem × animação) são compostos num único sprite sheet em grade, formato que o Phaser carrega via `scene.load.spritesheet(key, url, { frameWidth, frameHeight })`.

### 3.5 Integração — `DirectionalSprite` reescrito

Hoje (`src/visual/directionalSprite.ts`): um `Image` retangular fixo (`base`) + uma seta (`arrow`) que gira continuamente por cima via `Math.atan2`, sem troca de frame nenhuma.

Depois: `base` passa a ser um `Sprite` (não `Image`) com uma `Phaser.Animations` por (personagem × animação × direção), e `syncDirection(dir: Vec2)` passa a:
1. Converter `dir` num bucket de 8 direções (`Math.atan2(dir.y, dir.x)`, dividido em 8 setores de 45°) em vez de rotação contínua.
2. Tocar a animação `idle` ou `walk` do bucket correspondente, dependendo se a entidade está parada ou em movimento (`ArenaScene` já sabe disso via `lastMoveInput`/`moveInput`).

A seta de debug (`arrow`) pode ser mantida como overlay opcional de depuração ou removida — a decidir na implementação, já que passa a ser redundante com o próprio sprite direcional.

---

## 4. Estrutura de arquivos

| Caminho | Responsabilidade |
|---|---|
| `public/assets/characters/<personagem>/` (novo) | Sprite sheets finais (PNG) consumidos pelo Phaser — versionados normalmente, como os tiles atuais. |
| `tools/blender/` (novo, nome a confirmar na implementação) | Scripts do pipeline: download, retarget (instruções/script de automação), render (`blender_batch_render.py` ou fork), composição de sprite sheet. Versionados para reexecução quando animações de ataque entrarem. |
| `src/visual/directionalSprite.ts` (edit) | Reescrito para sprite direcional com animação, conforme §3.5. |
| `src/visual/assetRegistry.ts` (edit, provável) | Novas chaves de asset para os sprite sheets do jogador/Assaltante, substituindo/complementando as placeholder atuais. |
| `src/scenes/ArenaScene.ts` (edit, pequeno) | Carrega os novos sprite sheets em `preload()`; `create()`/`update()` não deveriam precisar de mudança estrutural, já que `DirectionalSprite` mantém a mesma interface pública (`syncPosition`, `syncDirection`, `setTint`). |
| `src/visual/placeholderTextures.ts` (edit) | `generateRectTexture`/`generateArrowTexture` para jogador/Assaltante saem de uso (a seta pode continuar existindo se mantida como debug overlay, ver §3.5). |

Assets 3D brutos (FBX baixado, FBX animado) — decisão de versionar ou não fica para a implementação: se pequenos, versionar em `tools/blender/source/` facilita reexecução sem precisar rebaixar; se grandes, listar em `.gitignore` e documentar como regenerar.

---

## 5. Estratégia de verificação (não é TDD — é visual)

| Etapa | Como verificar |
|---|---|
| Download | Arquivos FBX/GLTF existem no disco, tamanho não-zero. |
| Retarget | FBX animado exportado existe; abrir rapidamente num visualizador (ou o próprio Blender) confirma que a animação está presente antes de gastar tempo renderizando. |
| Render | PNGs existem, contagem bate com (direções × frames × animações), fundo transparente (canal alpha presente). |
| Composição | Sprite sheet carrega no Phaser sem erro de `preload()`. |
| Integração | `npm run dev`, Claude in Chrome navega até a cena, captura de tela confirma sprite 3D visível, movendo o jogador em pelo menos 4 das 8 direções e comparando a captura com a direção esperada. |
| Regressão de lógica | `npm test` e `npm run typecheck` continuam no mesmo estado de antes (nenhum teste novo esperado, nenhum teste quebrado). |

---

## 6. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Ferramenta de retarget da Quaternius não ser 100% automatizável por navegador | Testar com 1 personagem primeiro; se travar em um passo que exija interação humana, parar e reportar exatamente onde, em vez de tentar forçar. |
| `blender-sprite-render` não aceitar `--rotations 8` nativamente | Script pequeno e aberto — ajuste local se necessário, documentado no script versionado em `tools/blender/`. |
| Licença/atribuição do KayKit ou da Quaternius | Ambos CC0/uso livre conforme já pesquisado; documentar a fonte exata (URL, versão do pack) no `tools/blender/README` para o texto do TCC. |
| Tamanho dos assets brutos infla o repositório | Decisão de versionar só o sprite sheet final (pequeno) e manter o FBX bruto fora do git, documentando como regenerar — ver §4. |
| Sprite sheet muito grande degradar performance | 8 direções × poucos frames é pequeno (idle: 8 imagens; walk: ~48) por personagem — não deve ser um problema nesta fatia; reavaliar se animações de ataque (mais frames) entrarem depois. |

---

## 7. Trilha completa (contexto — só o passo 3 é este sub-projeto)

1. ~~Registro de ações + dim 2, com espada+escudo.~~ **Mesclado (commit `0c9bee4`).**
2. ~~Mira por mouse + arco + arma pesada + troca de arma → dim 1.~~ **Mesclado (commit `939a521`).**
3. **[este doc]** Pipeline de assets 3D pré-renderizados — jogador + Assaltante, idle + walk, 8 direções.
4. Kit defensivo: recuo, bloqueio, parry, barra de postura, stagger → **dim 4**.
5. Definição do predicado "janela segura" → **dim 6**.
6. Seleção de déficit-alvo com histerese.
7. Pesos de regra + boss adaptativo + preditor de movimento.

Estudo 1 pode rodar ao fim do passo 5 (era passo 4 antes desta antecipação do pipeline visual).
