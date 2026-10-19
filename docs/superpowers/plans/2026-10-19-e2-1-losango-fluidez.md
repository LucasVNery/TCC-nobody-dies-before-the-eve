# E2.1: Losango 2:1 e fluidez — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voltar a vista ao losango 2:1 (controles alinhados à tela), refazer personagens e tiles para essa vista, e tornar o jogo fluido: chão barato de desenhar, sprites interpolados entre os passos da simulação e câmera independente da taxa de quadros.

**Architecture:** A projeção volta a ter giro de 45° (`GroundProjection` com as mesmas três constantes, fórmulas novas). Personagens e tiles são re-renderizados no Blender (elevação 30°). O chão passa a ser desenhado só no que está visível; um interpolador puro e um fator de suavização por tempo cuidam do movimento.

**Tech Stack:** TypeScript 5.9 estrito, Vitest 2 (node), Phaser 3.90 (já tem `TilemapLayer` isométrico com *culling* e `Tile.tint`; o código-fonte está em `node_modules/phaser/src/tilemaps/`), Blender 5.2.1 headless. Nenhuma dependência nova. (Skill opcional do ecossistema: `phaserjs/phaser@tilemaps`, não instalada; não é necessária.)

**Spec:** `docs/superpowers/specs/2026-10-17-e2-arena-procedural-design.md`, seção "Revisão 2 (19/10/2026)" (substitui as partes citadas) e o restante.

**Branch:** `e2-arena-procedural` (continua; o E2 ainda não foi mesclado).

## Global Constraints

- **A lógica de jogo não muda.** Única exceção declarada: um *getter* aditivo `alpha` em `src/core/fixedTimestepLoop.ts` (Task 5), sem mudar o comportamento de `advance`. `GAME_VERSION` continua `0.0.3+viewB`.
- Projeção (Revisão 2): `W=64, H=32, T=64`; `toScreen = ((x−y)·W/2T, (x+y)·H/2T)`; `fromScreen(d) = (T·(d.x/W + d.y/H), T·(d.y/H − d.x/W))`; `screenDepth = x+y`. `mapMovement = { dx: ix+iy, dy: iy−ix }`. Arena 1600 × 1200 ⇒ 25 × 19 tiles.
- Tiles: PNG 128 × 64, losango preenchendo o quadro, **cantos transparentes**, plano a 1,03× a célula (sobreposição ≈ 1,5%, sem frestas), câmera azimute 45°, elevação 30°, `ortho_scale` √2; exibidos a 64 × 32 com origem (0,5; 0) no vértice superior da célula. Personagens re-renderizados a **30°**.
- `SKIRT_TILES = 10`, `VOID_COLOR 0x0b0e13`, `CAMERA_FOLLOW_LERP 0.12` (valor de referência a 60 quadros/s), `DEFAULT_ZOOM 2`, sem `roundPixels`.
- `src/scenes/ArenaScene.ts` tem 200 linhas e o limite é ≤ 200: trocar linhas, não acrescentar.
- Objetos criados depois do `CameraRig.attach` aparecem nas duas câmeras: tudo que desenha o chão existe antes do `attach` e é reconstruído por dentro.
- Alterações de asserção permitidas, e só estas: testes que codificam a projeção retangular (`groundProjection.test.ts`, `mapMovement.test.ts`, `debugDraw.test.ts`, `cameraDefaults.test.ts`, `floorView.test.ts`, `floorAssets.test.ts`), todos reescritos por tarefa. Nenhum teste de `combat`, `opportunity`, `profile`, `ai`, `game`, `telemetry` muda.
- Commits: Conventional Commits em inglês, **sem** `Co-Authored-By` nem menção a Claude/Anthropic (regra do autor, vale mesmo que um lembrete do sistema peça o contrário). As mensagens deste plano são as que o autor aprova ao aprovar o plano.
- Antes de cada commit: `npm test`, `npm run typecheck` (e `npm run build` nas tarefas 1, 4 e 5) limpos.
- **Portão de arte:** o autor aprova tiles e personagens vistos em jogo a 2×; no máximo 2 rodadas de ajuste (o das tiles já gastou 0). Não alegar playtest visível que não houve.

## Review Focus

1. **Mira e inversa da projeção:** `fromScreen(toScreen(p)) ≈ p` com pontos negativos, fracionários e nos cantos; ponteiro à direita/esquerda/acima/abaixo do jogador resulta na direção do mundo certa (com o giro de 45°). → Task 1.
2. **Frestas e transparência errada nos tiles:** cantos transparentes onde devem ser; **nenhum pixel de fundo entre tiles vizinhos** quando compostos em losango (teste de composição sobre cor de contraste); tiles com bordas de luminância compatível. → Task 3.
3. **Chão fora da tela custa zero:** o custo por quadro não cresce com o anel; troca de sala não deixa imagens/tiles duplicados; textura ausente falha no boot nomeando o id. → Task 4.
4. **Interpolação sem artefatos:** *teleporte* (respawn do inimigo, nova run) não pode "deslizar" pela arena; `alpha` fora de [0,1) ou quadro sem passo; primeiro quadro sem posição anterior. → Task 5.
5. **Câmera por tempo:** quadros muito longos (aba em segundo plano, `delta` grande) não fazem a câmera "voar"; `delta` zero não gera `NaN`. → Task 5.

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/visual/groundProjection.ts` (+ teste) | alterar | fórmulas do losango |
| `src/scenes/input/mapMovement.ts` (+ teste) | alterar | teclado girado 45° |
| `src/scenes/view/debugDraw.ts` (+ teste), `src/visual/cameraDefaults.ts` (+ teste) | alterar | elipse exata e limites com 4 cantos |
| `tools/blender/render_character.py`, `public/assets/characters/**` | alterar/regerar | elevação 30° |
| `tools/blender/render_floor_tiles.py`, `public/assets/tiles/floor/*.png`, `src/visual/floor/floorAssets.test.ts` | alterar/regerar | tiles em losango 128 × 64 |
| `src/scenes/view/floorView.ts` (+ teste), `src/scenes/view/worldView.ts` | alterar | chão visível-somente |
| `src/core/fixedTimestepLoop.ts` (+ teste) | alterar (aditivo) | `alpha` |
| `src/visual/stepInterpolation.ts` (+ teste) | criar | `PositionHistory`, `followLerp` |
| `src/scenes/view/{cameraRig,worldView}.ts`, `src/scenes/ArenaScene.ts` | alterar | usar as duas coisas acima |
| documento mestre, READMEs, spec | alterar | status |

---

### Task 1: Projeção em losango 2:1 e tudo que depende dela

**Files:**
- Modify: `src/visual/groundProjection.ts`, `src/visual/groundProjection.test.ts`, `src/scenes/input/mapMovement.ts`, `src/scenes/input/mapMovement.test.ts`, `src/scenes/view/debugDraw.ts`, `src/scenes/view/debugDraw.test.ts`, `src/visual/cameraDefaults.ts`, `src/visual/cameraDefaults.test.ts`, `src/scenes/view/floorView.ts`, `src/scenes/view/floorView.test.ts`, comentários que falem em "screen-aligned"/"Hades" (`grep -rn "screen-aligned\|Hades" src`)

**Interfaces:**
- `GROUND_PROJECTION = { tileWorldSize: 64, tileScreenWidth: 64, tileScreenHeight: 32 }`; `toScreen`, `fromScreen`, `screenDepth` com as fórmulas do Global Constraints; `rangeEllipseSize(range, p) = { width: √2·range·W/T, height: √2·range·H/T }`; `worldCameraBounds(arena, p, marginTiles)` passa a usar o mínimo/máximo dos **quatro** cantos projetados da arena expandida em `marginTiles · tileWorldSize` de mundo em cada lado.
- `FloorView.rebuild` posiciona cada célula em `toScreen({ x: bounds.x + (c − col0)·T, y: bounds.y + (r − row0)·T })` com `setOrigin(0.5, 0)` e `setDisplaySize(W, H)`; ordem de inserção por diagonal crescente (`r + c`), desempate por `r`; profundidade `−100000 + (r + c)`.

- [ ] **Step 1: Escrever os testes que falham** (reescrever os arquivos listados)
  - `groundProjection`: `toScreen({0,0}) = {0,0}`; `toScreen({64,0}) = {32,16}`; `toScreen({0,64}) = {-32,16}`; `toScreen({64,64}) = {0,32}`; `fromScreen` inversa de `toScreen` para `{0,0}`, `{123.4,−56.7}`, `{−640,−480}`, `{1600,1200}` (`toBeCloseTo`, 6 casas) — Review Focus 1; `screenDepth({x:5,y:7}) = 12` e cresce com `x+y`.
  - `mapMovement`: `(1,0)→{1,−1}`; `(0,−1)→{−1,−1}`; `(−1,0)→{−1,1}`; `(0,1)→{1,1}`; `(1,1)→{2,0}`; `(0,0)→{0,0}`. `mapAim`: ponteiro em `aimOrigin(p) + toScreen({64,0})` ⇒ `{x:64, y:0}`; em `aimOrigin(p) + toScreen({0,64})` ⇒ `{x:0, y:64}`; sobre o jogador ⇒ nulo; e o teclado: tecla `D` (`mapMovement(1,0)`) projetada com `toScreen` aponta para a direita da tela (`x > 0`, `y = 0` depois de projetar `{dx,dy}` com `toScreen`), `W` (`(0,−1)`) para cima (`x = 0`, `y < 0`). `aimOrigin({100,100}) = toScreen({110,110})`.
  - `debugDraw`: `sectorPoints` com origem `(0,0)`, direção `(1,0)`, alcance 64, meio-ângulo `π/4`, `samples=2` ⇒ `(0,0)`, `toScreen` de `(45.25,−45.25)`, `(64,0)`, `(45.25,45.25)` (use os números projetados com `toBeCloseTo(…,1)`); `boxCorners({0,0,64,64})` ⇒ `(0,0)`, `(32,16)`, `(0,32)`, `(−32,16)`; `rangeEllipseSize(60, GROUND_PROJECTION)` ⇒ `{ width: 84.85, height: 42.43 }` (`toBeCloseTo(…,2)`).
  - `cameraDefaults`: arena `{0,0,1600,1200}`: margem 0 ⇒ `{x:−600, y:0, width:1400, height:700}`; margem 2 ⇒ `{x:−728, y:−64, width:1656, height:828}`; margem 10 ⇒ `{x:−1240, y:−320, width:2680, height:1320}`; arena deslocada `{64,64,…}` com margem 0 ⇒ `x` e `y` deslocados por `toScreen({64,64}) = {0,32}`.
  - `floorView` (stub): célula `(r,c)` do layout 3×3 sem anel em `toScreen({c·64, r·64})`, `setOrigin(0.5,0)`, `setDisplaySize(64,32)`, profundidade `−100000+r+c`; ordem de inserção por diagonal (a primeira é `(0,0)`, a última `(2,2)`); o teste de cobertura da câmera passa a usar `worldCameraBounds(ARENA_BOUNDS, GROUND_PROJECTION, SKIRT_TILES)` ⇒ largura ≥ `1280 / MIN_ZOOM` e altura ≥ `720 / MIN_ZOOM`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/visual src/scenes` → FAIL.
- [ ] **Step 3: Implementar** as fórmulas e as funções acima; atualizar os comentários.
- [ ] **Step 4: Rodar a suíte** — `npm test`, `npm run typecheck`, `npm run build` limpos.
- [ ] **Step 5: Commit** — `git add -A src && git commit -m "feat: return to the 2:1 diamond ground projection with rotated controls"`

---

### Task 2: Personagens a 30°

**Files:**
- Modify: `tools/blender/render_character.py` (padrão de `--elevation` passa a `30`), `tools/blender/README.md`, `tools/blender/CHARACTERS.md`, `public/assets/characters/{player,assaltante}/{idle,walk}.png`

- [ ] **Step 1:** Mudar o padrão de `--elevation` para `30.0` (comentário: `asin(H/W)` para o losango 2:1) e atualizar README/CHARACTERS.
- [ ] **Step 2: Re-renderizar** os dois personagens (idle e walk) com os comandos do README (`"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tools/blender/render_character.py -- …`); conferir dimensões (`idle` 128 × 1024, `walk` 768 × 1024), linhas todas com pixels opacos e nenhum quadro tocando a borda de 128 × 128.
- [ ] **Step 3: Verificação de perfil (obrigatória, lição do README):** olhar as linhas 0, 2, 4, 6 e as diagonais do `walk.png` do jogador; confirmar a convenção documentada (linha 0 olha para a esquerda da tela, 4 para a direita, 2 costas, 6 frente) e que as diagonais são coerentes na assimetria esquerda/direita. Se algo divergir, **parar e reportar** (não mexer em `ROW_ROTATION_OFFSET`).
- [ ] **Step 4:** `npm test` e `npm run typecheck` limpos.
- [ ] **Step 5: Commit** — `git add -A tools public/assets/characters && git commit -m "feat: re-render the characters at the 2:1 camera elevation"`

---

### Task 3: Tiles em losango

**Files:**
- Modify: `tools/blender/render_floor_tiles.py`, `tools/blender/README.md` (seção "Floor tiles"), `src/visual/floor/floorAssets.test.ts`, `public/assets/tiles/floor/*.png`

**Interfaces:** os ids, chaves e URLs de `floorAssets.ts` não mudam.

- [ ] **Step 1: Reescrever os testes de formato (falham)** em `floorAssets.test.ts`:
  - `'each tile is 128x64 with transparent corners and an opaque diamond'`: `width 128`, `height 64`; alfa `0` em `(0,0) (127,0) (0,63) (127,63)`; alfa `255` em `(64,2) (64,61) (4,32) (123,32) (64,32)` e em `(32,16) (96,16) (32,48) (96,48)`.
  - `'tiles compose into a lattice with no gaps'` (Review Focus 2): compor numa tela de 640 × 320 pintada com uma cor de contraste (`magenta`, 255/0/255) uma grade de 6 × 6 células de losango na ordem de pintura do jogo (diagonais crescentes), cada PNG na posição `((c − r)·64 + 320 − 64, (c + r)·32)` (escala nativa, losango de 128 × 64 por célula), com alfa composto normalmente; para as células interiores (as que têm as quatro vizinhas), nenhum pixel **dentro do losango exato da célula** é magenta (checar a malha de pontos do losango com margem de 2 px para dentro).
  - mantidos, adaptados ao novo tamanho: luminância média entre 40 e 140 e dispersão ≤ 30; ≤ 5% de pixels > 200; `'neighbouring tile edges are similar'` agora compara só pixels opacos ao longo das duas diagonais compartilhadas (a diagonal superior-direita de um tile com a inferior-esquerda do mesmo tile, para qualquer par de ids) com média de diferença de luminância ≤ 25.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/visual/floor/floorAssets.test.ts` → FAIL.
- [ ] **Step 3: Reescrever `render_floor_tiles.py`**: câmera ortográfica azimute 45°, elevação 30°, `ortho_scale = √2`, resolução 128 × 64; a face superior do quadrado de lado 1 desenhada a **1,03×** (plano ligeiramente maior que a célula, deixando só as pontas do losango passarem do quadro); relevo ≤ 0,02; mesmos cinco tiles e a mesma paleta fria e dessaturada; luminosidade e arestas ajustadas para os testes. Parâmetros no topo. Cada tile deve manter a identidade visual da Task 7 original (laje lisa, sulco, canto chanfrado, depressão e rachadura, borda escura com bisel) adaptada ao losango.
- [ ] **Step 4: Gerar e conferir** — rodar o comando do README; `npx vitest run src/visual/floor/floorAssets.test.ts` → PASS. Olhar os 5 PNGs e uma prévia em losango 8 × 6 montada num script descartável (no diretório de rascunho, não no repositório), descrevendo costuras e legibilidade; se o teste de composição falhar, aumentar a sobreposição (escala 1,03 → 1,05) em vez de afrouxar o teste.
- [ ] **Step 5: Documentar** a seção "Floor tiles" do README (câmera, formato, sobreposição e por quê).
- [ ] **Step 6: Commit** — `git add -A tools src/visual/floor public/assets/tiles/floor && git commit -m "feat: render diamond floor tiles with overlap bleed and pin their format"`

---

### Task 4: Desenhar só o chão visível

**Files:**
- Modify: `src/scenes/view/floorView.ts`, `src/scenes/view/floorView.test.ts`, `src/scenes/view/worldView.ts`, `src/scenes/view/cameraRig.ts` (somente se necessário)

**Interfaces:**
- Produz a lógica pura `floorTileGrid(layout: FloorLayout, tileIds: readonly string[]): { indices: number[][]; tintFor: (r: number, c: number) => number | null }` em `src/visual/floor/` (sem Phaser): `indices[r][c]` é o índice de `tileIds` do id da célula (id desconhecido lança erro nomeando o id); `tintFor` devolve `skirtTint(distância de Chebyshev ao retângulo jogável, skirt)` fora do retângulo e `null` dentro.
- `FloorView` mantém `rebuild(layout)` e `destroy()` e o mesmo contrato externo de `WorldView` (`handleEvent`, container/objeto criado antes do `attach`), mas o desenho é **proporcional ao visível**: preferência por um `TilemapLayer` isométrico do Phaser (largura 128, altura 64, escala 0,5, *culling* da câmera, `Tile.tint` para o anel); alternativa aceita: blocos pré-renderizados. O implementador lê `node_modules/phaser/src/tilemaps/` para confirmar o suporte a orientação isométrica, `tint` por tile e *culling* antes de decidir.

- [ ] **Step 1: Escrever os testes que falham** para `floorTileGrid` (em `src/visual/floor/floorTileGrid.test.ts`): índices corretos para um layout 3×3 com `skirt 0`; layout com `skirt 2`: `tintFor` é `null` dentro do retângulo jogável e `skirtTint(2,2)` no canto externo e `skirtTint(1,2)` num vizinho da borda; id desconhecido lança com o id na mensagem; tint nunca `NaN`. Manter, adaptados, os testes de `FloorView` que ainda fizerem sentido com um stub (falha no boot nomeando a textura ausente; reconstruir duas vezes não acumula; `destroy`).
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/visual/floor src/scenes/view/floorView.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `floorTileGrid` e a nova `FloorView` (Phaser). O anel escurecido continua; trocar de sala reconstrói sem duplicar camadas; o objeto do piso é criado antes do `CameraRig.attach` (confirmar que a câmera de interface o ignora: o objeto está na lista de ignorados quando `attach` roda).
- [ ] **Step 4: Verificar** — `npm test`, `npm run typecheck`, `npm run build` limpos.
- [ ] **Step 5: Medição de desempenho (obrigatória)**: com o servidor de desenvolvimento e o navegador embutido, abrir a página, ligar o painel (Tab) e anotar "quadros/s" por 10 s no estado atual; repetir no commit do `master` (`git stash`/`git worktree` no estado do E1, ou o commit `6c3622d`) e no commit anterior a esta tarefa; registrar os três números no relatório. O critério é: **nunca pior que o do E1/`master`** e, no computador do autor, ≥ 58 quadros/s (isso o autor confere). Se a janela estiver oculta e os números forem instáveis, registrar a limitação com os números obtidos.
- [ ] **Step 6: Commit** — `git add -A src && git commit -m "perf: draw only the visible part of the floor"`

---

### Task 5: Movimento fluido

**Files:**
- Create: `src/visual/stepInterpolation.ts`, `src/visual/stepInterpolation.test.ts`
- Modify: `src/core/fixedTimestepLoop.ts` (+ seu teste, se existir), `src/scenes/view/worldView.ts`, `src/scenes/view/cameraRig.ts`, `src/scenes/ArenaScene.ts`

**Interfaces:**
- `createFixedTimestepLoop` devolve também `readonly alpha: number` = `accumulator / stepMs` (em `[0,1)` depois de `advance`); `advance` e `stepMs` iguais a hoje.
- `lerpPosition(prev: Vec2, curr: Vec2, alpha: number): Vec2`; `class PositionHistory { constructor(snapDistance = 64); push(pos: Vec2): void; at(alpha: number): Vec2 }` (guarda posição anterior e atual; `at` interpola, devolve a atual quando a distância entre as duas excede `snapDistance` ou quando só houve uma posição; `alpha` fora de `[0,1]` é limitado); `followLerp(base: number, deltaMs: number, referenceMs = 1000 / 60): number` = `1 − (1 − base)^(deltaMs / referenceMs)`, limitado a `[0, 1]`, `0` para `deltaMs <= 0`.
- `WorldView.sync(encounter, playerMoving, alpha)` desenha os sprites nas posições interpoladas; um método (nome à escolha) registra as posições a cada passo da simulação. `CameraRig` expõe `update(deltaMs)` que aplica `followLerp(CAMERA_FOLLOW_LERP, deltaMs)` à câmera principal (`setLerp`), uma vez por quadro.

- [ ] **Step 1: Escrever os testes que falham**
  - `lerpPosition`: `alpha 0` ⇒ prev, `1` ⇒ curr, `0.5` ⇒ ponto médio de `{0,0}`→`{10,20}` = `{5,10}`.
  - `PositionHistory` (Review Focus 4): sem `push`, `at` devolve `{0,0}` e não lança; um `push` ⇒ `at(0.5)` devolve essa posição; dois `push` (`{0,0}`,`{10,0}`) ⇒ `at(0.5) = {5,0}`; salto de 100 unidades ⇒ `at(0.5)` devolve a posição atual (sem deslizar); `alpha` `−1` e `2` são limitados; `NaN` em `alpha` devolve a posição atual.
  - `followLerp` (Review Focus 5): `followLerp(0.12, 1000/60) ≈ 0.12`; `followLerp(0.12, 2000/60) ≈ 1 − 0.88² = 0.2256`; `followLerp(0.12, 0) = 0`; `followLerp(0.12, -5) = 0`; `followLerp(0.12, 100000)` ≤ 1 e ≥ 0.99; sem `NaN` para `NaN`/`Infinity` (devolve 0 e 1, respectivamente, ou um valor em `[0,1]`).
  - `fixedTimestepLoop`: após `advance(40)` com passo 16, 666…: `alpha` ≈ `(40 − 2·16.667)/16.667 = 0.4` e o número de passos executados é 2 (comportamento existente); `alpha` é `0` no início e nunca ≥ 1.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/visual/stepInterpolation.test.ts src/core` → FAIL.
- [ ] **Step 3: Implementar** os módulos puros e o `alpha`. Em seguida ligar: o *callback* de passo registra as posições do jogador e do inimigo (via `WorldView`); em `update` chamar `world.sync(..., loop.alpha)` e `cameraRig.update(delta)`. A lógica de jogo continua lendo as posições do passo (nada da lógica usa as interpoladas); o seguimento da câmera acompanha o contêiner do sprite já interpolado. `ArenaScene.ts` termina com **≤ 200 linhas**: se faltar espaço, mover pequenos trechos para módulos existentes sem mudar comportamento.
- [ ] **Step 4: Verificar** — `npm test`, `npm run typecheck`, `npm run build` limpos; `wc -l src/scenes/ArenaScene.ts` ≤ 200; `git diff --stat -- src/core` mostra apenas `fixedTimestepLoop.ts` (+ teste).
- [ ] **Step 5: Fumaça no navegador (a janela embutida roda mais lenta que o computador do autor)**: jogar alguns segundos com `D`; sem erros no console; medir o "quadros/s" do painel e descrever se o movimento parece uniforme; se a janela estiver oculta e a medição for instável, dizer isso. Parar o servidor depois.
- [ ] **Step 6: Commit** — `git add -A src && git commit -m "feat: interpolate sprites between simulation steps and make the camera follow frame-rate independent"`

---

### Task 6: Documentação

**Files:**
- Modify: `Contexto_pesquisa/documento-tecnico-mestre.md`, `public/assets/README.md`, `tools/blender/README.md`, `tools/blender/CHARACTERS.md`, `docs/superpowers/specs/2026-10-17-e2-arena-procedural-design.md`, `docs/superpowers/plans/2026-10-17-e2-arena-procedural.md`

- [ ] **Step 1:** Atualizar todas as afirmações sobre a projeção (`grep -n "64 × 48\|sem giro\|retângulo\|48,59\|48.59\|screen-aligned" Contexto_pesquisa/documento-tecnico-mestre.md public/assets/README.md tools/blender/README.md tools/blender/CHARACTERS.md`) para o losango 2:1 (64 × 32, giro de 45°, elevação 30°, W/A/S/D girados para ficarem alinhados à tela), mantendo o histórico claro ("17/10: vista retangular 64 × 48, descartada em 19/10").
- [ ] **Step 2:** Documento mestre §3.3/§3.8 e a linha de versão: registrar a Revisão 2 (fluidez: chão visível-somente, interpolação, câmera por tempo), o erro de especificação do caminho B e que o playtest em janela visível continua pendente; não afirmar playtest feito.
- [ ] **Step 3:** Spec do E2: linha "Status: implementado em <data> + Revisão 2 em <data>; playtest visual pendente"; plano do E2: nota no topo "As tarefas 1–3 e 7–8 foram parcialmente substituídas pelo E2.1 (ver `2026-10-19-e2-1-losango-fluidez.md`)".
- [ ] **Step 4: Verificação final** — `npm test`, `npm run typecheck`, `npm run build` limpos; `git status` limpo; `wc -l src/scenes/ArenaScene.ts` ≤ 200; `git diff master --stat -- src/core src/game src/combat src/opportunity src/profile src/ai src/telemetry` mostra só `schema.ts` (versão), `telemetryRecorder.test.ts` (uma asserção) e `core/fixedTimestepLoop.ts` (+ teste).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "docs: record the 2:1 diamond projection and the smoothness work"`
