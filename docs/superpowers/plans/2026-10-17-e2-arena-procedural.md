# E2: Projeção estilo Hades, arena procedural e fundo — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Nota (19/10/2026):** As tarefas 1–3 e 7–8 foram parcialmente substituídas pelo E2.1 (ver `2026-10-19-e2-1-losango-fluidez.md`): a projeção voltou ao losango 2:1 e o chão passou a ser desenhado em blocos.

**Goal:** Trocar a vista em losango 2:1 por uma vista inclinada alinhada à tela (estilo Hades) e o chão fixo por 5 tiles próprios do Blender, compostos de forma determinística, com anel de tiles e fundo, sem mudar nenhuma regra de jogo.

**Architecture:** Parte A troca a projeção (`GroundProjection`) e tudo que depende dela (entrada, mira, depuração, câmera, sprites re-renderizados). Parte B acrescenta módulos puros em `src/visual/floor/` (PRNG e `floorSeed`, `composeFloor`/`composeFloorWithSkirt`, `floorFromEvents`, `FloorTracker`), uma vista fina `FloorView` (contêiner único criado antes do `CameraRig.attach`) e o script de Blender dos tiles.

**Tech Stack:** TypeScript 5.9 estrito, Vitest 2 (ambiente `node`), Phaser 3.90 (só em `src/scenes/**`), Blender 5.2.1 headless. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-17-e2-arena-procedural-design.md` (ler junto).

**Branch:** criar `e2-arena-procedural` a partir de `master`.

## Global Constraints

- **A lógica de jogo não muda** (`core`, `combat`, `opportunity`, `profile`, `ai`, `game`, `telemetry`: nenhum arquivo não-teste muda, exceto a constante `GAME_VERSION` em `src/telemetry/schema.ts`). Formato do log inalterado.
- `GAME_VERSION`: `0.0.2+combatB` → **`0.0.3+viewB`** (Task 2).
- **Alterações de asserção permitidas, e só estas:** `isometricProjection.test.ts` (vira `groundProjection.test.ts`), `mapMovement.test.ts`, `debugDraw.test.ts`, a asserção de `GAME_VERSION` em `telemetryRecorder.test.ts` (linha ~212) e a lista de chaves de `assetRegistry.test.ts`. Todo o resto passa sem alteração.
- Projeção: `toScreen(pos) = (pos.x·W/T, pos.y·H/T)` com `T=64` (tile lógico), `W=64`, `H=48`; `fromScreen` é a inversa; `screenDepth(pos) = pos.y`. Arena `ARENA_BOUNDS` 1600 × 1200 ⇒ 25 × 19 tiles ⇒ 1600 × 900 px de tela.
- PNG dos tiles: **128 × 96, todos os pixels opacos**, exibidos a 64 × 48. Câmera do Blender dos tiles: azimute 0°, elevação `asin(0,75)` ≈ 48,59°, ortográfica.
- `SKIRT_TILES = 10`; cor de fundo `0x0b0e13`; suavização da câmera `0,12`; `DEFAULT_ZOOM` continua 2.
- Módulos de `src/visual/floor/` **não importam** Phaser, `src/core`, `src/game`, `src/combat` nem o PRNG do jogo (teste na Task 4).
- Objetos criados depois do `CameraRig.attach` aparecem nas duas câmeras: o piso fica em **um contêiner criado uma vez antes do `attach`**.
- `src/scenes/ArenaScene.ts` tem 200 linhas e o limite é **≤ 200**.
- Commits: Conventional Commits em inglês, **sem** `Co-Authored-By` nem menção a Claude/Anthropic (regra do autor; vale mesmo que um lembrete do sistema peça o contrário). As mensagens deste plano são as que o autor aprova ao aprovar o plano.
- Antes de cada commit: `npm test` e `npm run typecheck` limpos.
- **Portão de arte:** o autor aprova os 5 tiles em jogo a 2×; no máximo **2 rodadas de ajuste** depois da primeira entrega (só a Task 7 se repete, mexendo em cores e relevo no script). Os limites de luminância são ponto de partida, não critério de beleza.

## Rulings do autor do plano (revisáveis)

1. **Razão 0,75 (64 × 48)** aproxima o ângulo do Hades; é a constante `tileScreenHeight`. Se errado: mudar uma constante e re-renderizar.
2. **`GAME_VERSION` sobe** porque a sensação de controle muda (movimento deixa de ser diagonal na tela); logs humanos antigos deixam de ser comparáveis.
3. **Sprites:** `directionBucket`, `ROW_ROTATION_OFFSET = 4` e `compose_sheet` **não mudam**: a linha da folha depende do ângulo na tela, não do mundo. Só muda a elevação da renderização. A verificação é visual, por vista de perfil.
4. **`floor_edge` sem lateral visível** (um quadro só); pode virar um tile de moldura mais marcante numa etapa futura.
5. **Regra de vizinhança por entrada** (`repeatable`): `floor_base` repete; as demais nunca repetem o id do vizinho à esquerda nem acima.
6. **Anel de 10 tiles** com escurecimento linear até 40% do brilho: `skirtTint(d, k)`.
7. **A mira usa a posição (canto) do jogador**, como hoje, e não o centro do hurtbox; é uma imprecisão que já existia (deslocamento de 10 × 7,5 px) e não faz parte deste plano.

## Review Focus

1. **Projeção inversa e mira:** `fromScreen(toScreen(p)) ≈ p` para pontos negativos, fracionários e nos cantos da arena; mira com o ponteiro à direita, esquerda, acima e abaixo do jogador. → Task 1.
2. **Seed ruim ou ausente:** `run.start` com `seed` NaN, texto, negativo, fracionário ou fora de 32 bits; `room.enter` sem `run.start` visto antes. Esperado: normaliza com `>>> 0` ou cai numa seed de reserva fixa; nunca lança. → Tasks 4 e 6.
3. **Tileset ou dimensões inválidos:** miolo ou borda vazios, pesos 0/negativos/NaN, ids repetidos, `colunas`/`linhas` < 3 ou não inteiras. Esperado: erro claro, sem laço infinito. → Task 5.
4. **Trocas de sala sem duplicar imagens e textura ausente:** reconstruir duas vezes deixa exatamente `células` filhos; id sem textura falha no boot nomeando o id. → Task 8.
5. **Frestas e vazio visível:** tiles com algum pixel transparente; limites da câmera menores que a tela no zoom mínimo. → Tasks 2, 7 e 8.

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/visual/groundProjection.ts` (+ teste) | criar | `GroundProjection`, `GROUND_PROJECTION`, `toScreen`, `fromScreen`, `screenDepth` |
| `src/visual/isometricProjection.ts` (+ teste) | remover | substituído |
| `src/visual/{placeholderTextures,directionalSprite,groundTilemap}.ts`, `src/scenes/input/{mapMovement,playerInput}.ts`, `src/scenes/view/{cameraRig,debugDraw,worldView}.ts` | alterar | usar a nova projeção |
| `src/visual/cameraDefaults.ts` | criar | `CAMERA_FOLLOW_LERP`, `VOID_COLOR`, `worldCameraBounds` |
| `tools/blender/render_character.py`, `public/assets/characters/**` | alterar | `--elevation`; re-renderizar |
| `src/visual/floor/{floorSeed,composeFloor,floorFromEvents,floorAssets,skirtTint}.ts`, `testing/readPng.ts` | criar | módulos puros do piso |
| `tools/blender/render_floor_tiles.py`, `public/assets/tiles/floor/*.png` | criar | os 5 tiles |
| `src/scenes/view/floorView.ts` | criar | contêiner do piso (stub-testável) |
| `src/visual/groundTilemap.ts`, `public/assets/tiles/{grass,water}.png` | remover | substituídos |

---

## Parte A — Projeção estilo Hades

### Task 1: Nova projeção e tudo que depende dela

**Files:**
- Create: `src/visual/groundProjection.ts`, `src/visual/groundProjection.test.ts`
- Delete: `src/visual/isometricProjection.ts`, `src/visual/isometricProjection.test.ts`
- Modify: `src/visual/placeholderTextures.ts`, `src/visual/directionalSprite.ts`, `src/visual/groundTilemap.ts`, `src/scenes/input/mapMovement.ts`, `src/scenes/input/mapMovement.test.ts`, `src/scenes/input/playerInput.ts`, `src/scenes/view/{cameraRig,debugDraw,worldView}.ts`, `src/scenes/view/debugDraw.test.ts`

**Interfaces:**
- Produces: `interface GroundProjection { tileWorldSize: number; tileScreenWidth: number; tileScreenHeight: number }`; `GROUND_PROJECTION: GroundProjection = { tileWorldSize: 64, tileScreenWidth: 64, tileScreenHeight: 48 }`; `toScreen(pos: Vec2, p: GroundProjection): Vec2`; `fromScreen(delta: Vec2, p: GroundProjection): Vec2`; `screenDepth(pos: Vec2, p: GroundProjection): number`; `rangeEllipseSize(range: number, p: GroundProjection): { width: number; height: number }` (exportada de `debugDraw.ts`). `ISO_CONFIG`/`IsoConfig` deixam de existir; `GROUND_TILE_SIZE` continua exportada por `placeholderTextures.ts` (agora importada de `groundProjection.ts` se evitar ciclo).

- [ ] **Step 1: Escrever os testes que falham**
  - `groundProjection.test.ts`: `toScreen({x:0,y:0}) = {0,0}`; `toScreen({x:64,y:64}) = {64,48}`; `toScreen({x:32,y:64}) = {32,48}`; `'fromScreen inverts toScreen'` para `{0,0}`, `{123.4,-56.7}`, `{-640,-480}`, `{1600,1200}` (`toBeCloseTo`, 6 casas) — Review Focus 1; `'screenDepth grows with y and ignores x'`: `screenDepth({x:5,y:7}) = 7`, `screenDepth({x:900,y:7}) = 7`, `screenDepth({x:0,y:8}) > screenDepth({x:0,y:7})`.
  - `mapMovement.test.ts` (reescrito): `mapMovement(1,0) → {dx:1,dy:0}`; `(-1,0) → {-1,0}`; `(0,-1) → {0,-1}`; `(0,1) → {0,1}`; `(1,1) → {1,1}`; `(0,0) → {0,0}`. `mapAim`: ponteiro em `(playerScreen.x+64, playerScreen.y)` ⇒ `{x:64, y:0}`; em `(playerScreen.x, playerScreen.y+48)` ⇒ `{x:0, y:64}`; sobre o jogador ⇒ vetor nulo; à esquerda ⇒ `x < 0`; acima ⇒ `y < 0`.
  - `debugDraw.test.ts` (reescrito com a nova projeção, usando o tipo real de `AttackSector`): `sectorPoints` com origem `(0,0)`, direção `(1,0)`, alcance 64, meio-ângulo `π/4`, `samples = 2` ⇒ 4 pontos ≈ `(0,0)`, `(45.25,-33.94)`, `(64,0)`, `(45.25,33.94)` (`toBeCloseTo(…, 1)`); `boxCorners({x:0,y:0,width:64,height:64})` ⇒ `(0,0)`, `(64,0)`, `(64,48)`, `(0,48)`; `rangeEllipseSize(60, GROUND_PROJECTION)` ⇒ `{width:120, height:90}`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/visual src/scenes` → FAIL.
- [ ] **Step 3: Implementar** `groundProjection.ts` e migrar **todos** os consumidores (`grep -rn "ISO_CONFIG\|IsoConfig\|isometricProjection" src` não pode sobrar nada). `mapMovement` vira identidade (`{dx: ix, dy: iy}`); `mapAim` continua `fromScreen(delta)`. Em `DirectionalSprite`, o deslocamento do centro e a profundidade usam a nova projeção; `spriteDirection.ts` não muda. Em `debugDraw`, a elipse usa `rangeEllipseSize`. Em `cameraRig`, os limites usam a nova projeção (a margem e o contêiner do anel vêm nas Tasks 2 e 8). `groundTilemap.ts` (ainda existente até a Task 8) passa a posicionar os tiles antigos em `(col·64, row·48)` com origem `(0,0)` e tamanho `64 × 48`, só para compilar e continuar visível.
- [ ] **Step 4: Rodar a suíte** — `npm test`, `npm run typecheck`, `npm run build` limpos.
- [ ] **Step 5: Commit** — `git add -A src && git commit -m "feat: switch to a screen-aligned pitched ground projection"`

---

### Task 2: Câmera suave, fundo e versão do jogo

**Files:**
- Create: `src/visual/cameraDefaults.ts`, `src/visual/cameraDefaults.test.ts`
- Modify: `src/scenes/view/cameraRig.ts`, `src/telemetry/schema.ts`, `src/telemetry/telemetryRecorder.test.ts`

**Interfaces:**
- Produces: `CAMERA_FOLLOW_LERP = 0.12`; `VOID_COLOR = 0x0b0e13`; `worldCameraBounds(arena: AABB, p: GroundProjection, marginTiles: number): { x: number; y: number; width: number; height: number }` (retângulo na tela: cantos projetados da arena expandidos em `marginTiles · tileScreenWidth` na horizontal e `marginTiles · tileScreenHeight` na vertical). `CameraRig.attach` usa `worldCameraBounds(ARENA_BOUNDS, GROUND_PROJECTION, 2)` por enquanto, `startFollow(follow, true, CAMERA_FOLLOW_LERP, CAMERA_FOLLOW_LERP)`, `main.roundPixels = true` e `main.setBackgroundColor(VOID_COLOR)`.

- [ ] **Step 1: Escrever os testes que falham**
  - `worldCameraBounds`: arena `{x:0,y:0,width:1600,height:1200}`, margem 2 ⇒ `{x:-128, y:-96, width:1856, height:1092}`; margem 10 ⇒ `{x:-640, y:-480, width:2880, height:1860}`; arena deslocada `{x:64,y:64,…}` desloca na mesma medida.
  - `'camera constants are sane'`: `0 < CAMERA_FOLLOW_LERP && CAMERA_FOLLOW_LERP <= 1`; `VOID_COLOR` inteiro entre `0` e `0xffffff`.
  - `telemetryRecorder.test.ts`: asserção de `GAME_VERSION` passa a `'0.0.3+viewB'` (única alteração do arquivo).
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/visual/cameraDefaults.test.ts src/telemetry/telemetryRecorder.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `cameraDefaults.ts`, ajustar `cameraRig.ts` e trocar `GAME_VERSION` em `schema.ts` para `'0.0.3+viewB'`.
- [ ] **Step 4: Rodar a suíte** — `npm test`, `npm run typecheck`, `npm run build` limpos.
- [ ] **Step 5: Fumaça no navegador** — `npm run dev` (checar a porta 5173 antes), abrir no navegador embutido: sem erros no console; W/A/S/D andam alinhados à tela; o mouse à direita faz o jogador mirar à direita; o fundo escuro aparece fora do mapa. Se a janela estiver oculta e o jogo não rodar, registrar isso (o roteiro fica para o autor). Parar o servidor.
- [ ] **Step 6: Commit** — `git add -A src && git commit -m "feat: add the smooth follow camera and void background; bump the game version to 0.0.3+viewB"`

---

### Task 3: Personagens re-renderizados na nova inclinação

**Files:**
- Modify: `tools/blender/render_character.py`, `tools/blender/README.md`, `tools/blender/CHARACTERS.md`, `public/assets/characters/{player,assaltante}/{idle,walk}.png`

**Interfaces:**
- Produces: `render_character.py` aceita `--elevation <graus>` (padrão `48.59`); `ELEVATION_DEG` deixa de ser uma constante fixa de 26,57. Folhas com o mesmo formato de antes: quadro 128 × 128, 8 linhas, `idle` 1 coluna, `walk` 6 colunas.

- [ ] **Step 1: Ler o script e o README** (`tools/blender/README.md`, seção "Direction-row convention") para repetir os comandos exatos de renderização do jogador (Knight) e do Assaltante (Barbarian).
- [ ] **Step 2: Implementar `--elevation`** no estilo de leitura de argumentos que o script já usa; padrão `48.59`; mensagem do cabeçalho do script e do README atualizadas ("elevação que corresponde ao tile 64 × 48 do jogo").
- [ ] **Step 3: Re-renderizar** os dois personagens (idle e walk) com os comandos do README; confirmar com `node -e` que cada PNG tem as mesmas dimensões de antes (`idle` 128 × 1024, `walk` 768 × 1024) e que há pixels opacos em todas as 8 linhas.
- [ ] **Step 4: Verificação de perfil (obrigatória, ver README):** abrir `walk.png` e `idle.png` do jogador (Read de imagem) e confirmar, por linha, a convenção documentada: linha 0 olha para a esquerda da tela, linha 4 para a direita, linha 2 mostra as costas, linha 6 a frente. Registrar a descrição das 4 linhas cardeais no relatório. Se algo divergir, **parar e reportar** (não alterar `ROW_ROTATION_OFFSET`).
- [ ] **Step 5: Fumaça no navegador** — como na Task 2: o personagem tem a inclinação nova e vira para o lado do mouse à esquerda, à direita, acima e abaixo; sem erros no console. Registrar o que foi visto.
- [ ] **Step 6: Documentar** — `tools/blender/README.md` e `CHARACTERS.md` (elevação 48,59°, motivo, data).
- [ ] **Step 7: Commit** — `git add -A tools public/assets/characters && git commit -m "feat: re-render the characters at the pitched camera elevation"`

---

## Parte B — Arena procedural

### Task 4: Seed do piso e PRNG próprio

**Files:**
- Create: `src/visual/floor/floorSeed.ts`
- Test: `src/visual/floor/floorSeed.test.ts`

**Interfaces:**
- Produces: `floorSeed(runSeed: number, roomIdx: number): number` (inteiro sem sinal de 32 bits; entradas por `>>> 0` e `| 0`, não finitos viram 0); `createFloorRng(seed: number): () => number` (valores em `[0, 1)`; PRNG pequeno tipo *mulberry32*; não importa nada do jogo).

- [ ] **Step 1: Escrever os testes que falham**
  - `'floorSeed is deterministic and returns an unsigned 32-bit integer'` para `(1,0)`, `(0,0)`, `(0xdeadbeef,7)`.
  - `'rooms of the same run get different seeds'`: `new Set([0,1,2,3,4,5].map((r) => floorSeed(42, r))).size === 6`; `floorSeed(1,0) !== floorSeed(2,0)`.
  - `'bad inputs never throw and are normalized'` (Review Focus 2): `NaN`, `Infinity`, `-5`, `1.9` com `0.9`; `floorSeed(-1,0) === floorSeed(0xffffffff,0)`.
  - `'createFloorRng is deterministic, in [0,1) and not constant'`: 100 valores iguais em duas instâncias, todos em `[0,1)`, mais de 90 distintos.
  - `'golden values freeze the algorithm'`: depois de implementar, copiar para o teste os valores reais de `floorSeed(1,0)`, `floorSeed(1,1)`, `floorSeed(0xdeadbeef,7)` e dos 5 primeiros de `createFloorRng(1)`; comentário: "mudar o algoritmo muda a arena de logs antigos; só com decisão do autor".
  - `'floor modules do not import the game, core, combat or phaser'`: lê com `fs` todos os `.ts` de `src/visual/floor/` (menos `*.test.ts` e `testing/`) e afirma que nenhum `import`/`from` casa `/(phaser|\/core\/|\/game\/|\/combat\/)/`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/visual/floor` → FAIL.
- [ ] **Step 3: Implementar** `floorSeed.ts` (sem `Math.random` nem `Date`).
- [ ] **Step 4: Rodar** — `npx vitest run src/visual/floor` → PASS.
- [ ] **Step 5: Commit** — `git add src/visual/floor && git commit -m "feat: add the floor seed and a private PRNG"`

---

### Task 5: `composeFloor`, anel e tileset padrão

**Files:**
- Create: `src/visual/floor/composeFloor.ts`, `src/visual/floor/skirtTint.ts`
- Test: `src/visual/floor/composeFloor.test.ts`, `src/visual/floor/skirtTint.test.ts`

**Interfaces:**
- Consumes: `createFloorRng`, `floorSeed` (Task 4).
- Produces: `interface TileChoice { id: string; weight: number; repeatable: boolean }`; `interface TileSet { border: string[]; interior: TileChoice[] }`; `FLOOR_TILESET: TileSet` (`border: ['floor_edge']`; `floor_base` peso 6 `repeatable: true`; `floor_a` peso 2, `floor_b` peso 2, `floor_worn` peso 1, os três `repeatable: false`); `SKIRT_TILES = 10`; `composeFloor(seed: number, colunas: number, linhas: number, tileset: TileSet): string[][]`; `interface FloorLayout { tiles: string[][]; playable: { col0: number; row0: number; cols: number; rows: number } }`; `composeFloorWithSkirt(seed: number, colunas: number, linhas: number, skirt: number, tileset: TileSet): FloorLayout`; `skirtTint(distance: number, skirt: number): number` (cor `0xRRGGBB` cinza: canal `round(255·(1 − 0,6·clamp(distance/skirt, 0, 1)))`).

- [ ] **Step 1: Escrever os testes que falham** (usar `FLOOR_TILESET`)
  - `composeFloor`: determinismo (`toEqual` em duas chamadas) e seeds `[1..5]` duas a duas diferentes; `linhas × colunas` para `25×19` e `40×30`; moldura toda em `border` e miolo nunca; para seeds `1..50` os ids `repeatable:false` do miolo diferem do vizinho esquerdo e do de cima; `floor_base` aparece ao lado de `floor_base` e os 4 ids do miolo aparecem em 50 seeds; trocar de tileset mantém as posições de borda; miolo só com `{id:'x',weight:1,repeatable:false}` em 5×5 não lança e preenche com `'x'`.
  - Invalidez (Review Focus 3), cada um `toThrow` com mensagem que nomeia o problema: `colunas`/`linhas` `< 3`, `0`, `-1`, `2.5`, `NaN`; miolo ou borda vazios; peso `0`, `-1` ou `NaN`; id repetido entre borda e miolo ou dentro do miolo.
  - `composeFloorWithSkirt(seed, 25, 19, SKIRT_TILES, FLOOR_TILESET)`: `tiles` tem `19 + 2·10` linhas e `25 + 2·10` colunas; `playable` é `{col0:10,row0:10,cols:25,rows:19}`; o recorte jogável de `tiles` é exatamente `composeFloor(seed, 25, 19, FLOOR_TILESET)`; determinístico; nenhuma célula do anel é `floor_edge`; `skirt = 0` devolve o mesmo que `composeFloor`; `skirt` negativo ou fracionário lança.
  - `skirtTint`: `skirtTint(0,10) = 0xffffff`; `(1,10) = 0xf0f0f0`; `(5,10) = 0xb3b3b3`; `(10,10) = 0x666666`; `(20,10) = 0x666666`; `(-3,10) = 0xffffff`; `skirt` `0` não lança (devolve `0xffffff`).
  - Golden: congelar `composeFloor(1, 5, 4, FLOOR_TILESET)` como literal.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/visual/floor` → FAIL.
- [ ] **Step 3: Implementar** `composeFloor.ts`: valida o tileset e as dimensões antes de sortear; varre linha→coluna com um único `createFloorRng(seed)`; no miolo sorteia por peso entre candidatos não excluídos (se vazio, entre todos); na moldura sorteia uniformemente em `border`. O anel usa uma segunda composição `composeFloor(floorSeed(seed, 0x5eed), colunas + 2·skirt, linhas + 2·skirt, skirtSet)` onde `skirtSet.border` são os ids do miolo do tileset, com o recorte jogável substituído pela composição jogável.
- [ ] **Step 4: Implementar** `skirtTint.ts`.
- [ ] **Step 5: Rodar** — `npx vitest run src/visual/floor` → PASS (inclui o teste de dependência da Task 4).
- [ ] **Step 6: Commit** — `git add src/visual/floor && git commit -m "feat: add composeFloor with a skirt ring, neighbour rules and tint"`

---

### Task 6: Piso a partir do log e rastreador de salas

**Files:**
- Create: `src/visual/floor/floorFromEvents.ts`
- Test: `src/visual/floor/floorFromEvents.test.ts`

**Interfaces:**
- Consumes: `LoggedEvent` (`import type` de `src/telemetry/schema.ts`), `floorSeed`, `composeFloorWithSkirt`, `TileSet`, `FloorLayout`.
- Produces: `DEFAULT_FLOOR_SEED = 0x2f0a`; `floorFromEvents(events: readonly LoggedEvent[], runIdx: number, roomIdx: number, colunas: number, linhas: number, skirt: number, tileset: TileSet): FloorLayout | null` (acha o `run.start` com o `run_idx` do payload e lê `seed`; `null` se não achar ou se `seed` não for número finito); `class FloorTracker { constructor(colunas: number, linhas: number, skirt: number, tileset: TileSet); apply(ev: LoggedEvent): FloorLayout | null; initial(): FloorLayout }` (`apply` guarda a seed ao ver `run.start` e devolve o piso novo ao ver `room.enter`, com a seed guardada ou `DEFAULT_FLOOR_SEED`; `null` para qualquer outro evento; **nunca lança**; `initial()` = piso da seed de reserva na sala 0).

- [ ] **Step 1: Escrever os testes que falham** (eventos montados à mão: `{v:2, seq, t_ms, player_id, session_id, run_idx, room_idx, enc_idx, type, ...payload}`)
  - `'floorFromEvents equals composeFloorWithSkirt for the logged seed and room'`: `run.start{run_idx:3, seed:777}` e `room.enter{room_idx:2}` ⇒ `toEqual(composeFloorWithSkirt(floorSeed(777,2), 25, 19, 10, FLOOR_TILESET))`.
  - `'returns null when run.start is missing, run_idx differs or seed is not a finite number'`: `seed: 'abc'`, `NaN`.
  - `FloorTracker`: `run.start{seed:5}` ⇒ `null`; `room.enter{room_idx:0}` ⇒ layout de `floorSeed(5,0)`; `room.enter{room_idx:1}` difere; `pos.sample` ⇒ `null`.
  - `'uses the default seed when room.enter arrives before any run.start'` (Review Focus 2): igual a `composeFloorWithSkirt(floorSeed(DEFAULT_FLOOR_SEED, 4), …)`, sem lançar.
  - `'ignores a malformed run.start seed and keeps the previous one'`; `'a new run.start replaces the seed'`; `'room.enter without a numeric room_idx does not throw and yields null'`; `'initial() equals the default seed, room 0'`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/visual/floor/floorFromEvents.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `floorFromEvents.ts`.
- [ ] **Step 4: Rodar** — `npx vitest run src/visual/floor` → PASS.
- [ ] **Step 5: Commit** — `git add src/visual/floor && git commit -m "feat: rebuild the floor from the log and track room changes"`

---

### Task 7: Tiles do Blender e leitor de PNG para teste

**Files:**
- Create: `tools/blender/render_floor_tiles.py`, `src/visual/floor/testing/readPng.ts`, `src/visual/floor/floorAssets.ts`, `public/assets/tiles/floor/{floor_base,floor_a,floor_b,floor_worn,floor_edge}.png`
- Modify: `tools/blender/README.md` (seção "Floor tiles")
- Test: `src/visual/floor/floorAssets.test.ts`

**Interfaces:**
- Produces (`floorAssets.ts`, `import type Phaser`): `FLOOR_TILE_IDS: readonly string[]` (`floor_base`, `floor_a`, `floor_b`, `floor_worn`, `floor_edge`); `FLOOR_TILE_KEYS: Record<string, string>` (id → `floor:<id>`); `FLOOR_TILE_URLS: Record<string, string>` (id → `/assets/tiles/floor/<id>.png`); `loadFloorTiles(scene: FloorTileLoaderScene): void`, onde `FloorTileLoaderScene` é uma interface estrutural (`{ load: { image(key, url): unknown } }`) que um `Phaser.Scene` satisfaz, em vez de importar o tipo do Phaser.
- Produces (`readPng.ts`): `readPngRgba(path: string): { width: number; height: number; data: Uint8Array }` (PNG 8 bits RGBA sem entrelaçamento; `zlib.inflateSync` e filtros 0–4; lança com mensagem clara em outro formato ou arquivo inexistente).

- [ ] **Step 1: Escrever os testes que falham**
  - `'every tileset id has a texture key, a url and a PNG file'` para borda e miolo de `FLOOR_TILESET`.
  - `'each tile is 128x96 and fully opaque'` (Review Focus 5): `width === 128 && height === 96`; **todos** os pixels com alfa `255`.
  - `'tiles are close in brightness so none competes with telegraphs'`: luminância média (Rec. 709) de cada tile entre `40` e `140`; `max − min` entre as médias `≤ 30`; no máximo 5% dos pixels com luminância `> 200`. (Pontos de partida; ajustar junto com a arte registrando os números finais no relatório.)
  - `'neighbouring tile edges are similar so tiles do not show seams'`: para cada tile, a diferença média de luminância entre a coluna 0 e a coluna 127 `≤ 25`, e entre a linha 0 e a linha 95 `≤ 25`.
  - `'readPngRgba fails clearly for a missing file'`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/visual/floor/floorAssets.test.ts` → FAIL.
- [ ] **Step 3: Implementar `readPng.ts` e `floorAssets.ts`.**
- [ ] **Step 4: Escrever `render_floor_tiles.py`.** Comando: `"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tools/blender/render_floor_tiles.py -- --out public/assets/tiles/floor`. Decisões fixas: cena limpa por tile; só a face superior de um quadrado de lado 1, **escalada a 1,02** e cortada pelo quadro, relevo máximo 0,02; material de cor sólida no nó Principled BSDF achado **por tipo**; sombreado chapado; `film_transparent = True`; sol único mais luz de ambiente plana; câmera ortográfica azimute 0°, elevação `asin(0,75)`, `ortho_scale = 1,0`, resolução 128 × 96, PNG RGBA. Constantes (cores, relevo, chanfro) no topo. Paleta fria e dessaturada, sem vermelho/laranja saturados. Tiles: `floor_base` laje lisa com chanfro leve; `floor_a` sulco ao meio; `floor_b` canto chanfrado; `floor_worn` depressão rasa e uma rachadura de poucas faces; `floor_edge` mais escura com bisel interno (Ruling 4). Imprime a lista de arquivos escritos.
- [ ] **Step 5: Gerar e conferir** — rodar o comando; `npx vitest run src/visual/floor/floorAssets.test.ts` → PASS. Se luminância ou costuras falharem, ajustar as cores/relevo no script (nunca afrouxar limites sem registrar o motivo). Abrir os 5 PNGs lado a lado (Read de imagem), montar uma tira 3 × 3 de tiles variados num PNG temporário no escaneamento e descrever o resultado, incluindo se há costuras visíveis.
- [ ] **Step 6: Documentar** — seção "Floor tiles" em `tools/blender/README.md` (comando, câmera, 128 × 96 e por quê, como ajustar a paleta).
- [ ] **Step 7: Commit** — `git add tools/blender src/visual/floor public/assets/tiles/floor && git commit -m "feat: render the five floor tiles with Blender and pin their format"`

---

### Task 8: `FloorView`, anel, fundo e ligação na cena

**Files:**
- Create: `src/scenes/view/floorView.ts`
- Modify: `src/scenes/view/worldView.ts`, `src/scenes/view/cameraRig.ts`, `src/scenes/ArenaScene.ts`
- Delete: `src/visual/groundTilemap.ts`
- Test: `src/scenes/view/floorView.test.ts`

**Interfaces:**
- Consumes: `FLOOR_TILE_KEYS`, `FLOOR_TILE_IDS`, `loadFloorTiles` (Task 7); `FloorTracker`, `FLOOR_TILESET`, `SKIRT_TILES`, `FloorLayout`, `skirtTint` (Tasks 5 e 6); `toScreen`, `GROUND_PROJECTION`, `ARENA_BOUNDS`, `worldCameraBounds` (Task 2).
- Produces: `interface FloorScene { add: { container(x: number, y: number): FloorContainer; image(x: number, y: number, key: string): FloorImage }; textures: { exists(key: string): boolean } }`; `FloorContainer { add(child: FloorImage): unknown; removeAll(destroyChild?: boolean): unknown; destroy(): unknown; readonly length: number }`; `FloorImage { setOrigin(x: number, y: number): unknown; setDisplaySize(w: number, h: number): unknown; setDepth(d: number): unknown; setTint(color: number): unknown }`; `class FloorView { constructor(scene: FloorScene, bounds: AABB, projection: GroundProjection, tileIds: readonly string[]); readonly container: FloorContainer; rebuild(layout: FloorLayout): void; destroy(): void }`.
- `WorldView` ganha `handleEvent(e: LoggedEvent): void`. `ArenaScene.preload` troca as duas linhas de `grass/water` por `loadFloorTiles(this)`; o assinante do gravador no `onStackReady` chama `world.handleEvent(e)` **dentro do `try`** existente (capturar `const world = this.world` com os outros locais). `CameraRig` usa `worldCameraBounds(ARENA_BOUNDS, GROUND_PROJECTION, SKIRT_TILES)`.

- [ ] **Step 1: Escrever os testes que falham** (stub de cena em memória, sem Phaser; `textures.exists` configurável)
  - `'construction fails fast naming the missing texture'` (Review Focus 4): `exists` falso para `floor:floor_worn` ⇒ `new FloorView(...)` lança com `floor_worn` na mensagem.
  - `'rebuild places one image per cell at the projected position with origin (0,0) and display size 64x48'`: layout 3×3 (`skirt 0`, `bounds` na origem) ⇒ imagem `(r,c)` em `toScreen({x: c·64, y: r·64})`, `setOrigin(0,0)`, `setDisplaySize(64,48)`, profundidade `−100000 + r`.
  - `'cells outside the playable rectangle are tinted with skirtTint of their Chebyshev distance and playable cells are not'`: layout com `skirt 2` ⇒ canto externo `setTint(skirtTint(2,2))`; célula jogável sem `setTint`.
  - `'the layout origin is shifted by the skirt so the playable rectangle sits at the bounds'`: a célula `(skirt, skirt)` fica em `toScreen({x: bounds.x, y: bounds.y})`.
  - `'rebuilding twice leaves exactly rows x cols children'` e `'rebuild clears previous children with destroy'` (Review Focus 4): `removeAll(true)` chamado; `container.length` igual a `linhas·colunas` do layout depois de duas chamadas.
  - `'unknown tile id in the layout throws naming the id'`; `'destroy removes the container'`.
  - `'camera bounds with SKIRT_TILES cover the viewport at MIN_ZOOM'` (Review Focus 5): `worldCameraBounds(ARENA_BOUNDS, GROUND_PROJECTION, SKIRT_TILES)` tem `width ≥ 1280 / MIN_ZOOM` e `height ≥ 720 / MIN_ZOOM`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/scenes/view/floorView.test.ts` → FAIL.
- [ ] **Step 3: Implementar `FloorView`.** O contêiner é criado no construtor (uma vez). `rebuild` valida os ids, faz `removeAll(true)` e recria as imagens; cada célula fora do retângulo jogável recebe `setTint(skirtTint(distância, SKIRT_TILES))`, distância de Chebyshev ao retângulo.
- [ ] **Step 4: Ligar** — `WorldView` troca `createGroundTilemap(...)` por `new FloorView(...)` seguido de `rebuild(tracker.initial())`, **antes** de qualquer outro objeto do `WorldView`; a ordem em `ArenaScene.create` (WorldView → DebugDraw → HUD → `CameraRig.attach`) **não muda**; `handleEvent` repassa ao `FloorTracker` e reconstrói quando ele devolve um layout. `ArenaScene`: ajustar `preload` e o assinante; `wc -l src/scenes/ArenaScene.ts` ≤ 200. Remover `groundTilemap.ts` e seus imports.
- [ ] **Step 5: Verificar** — `npm test`, `npm run typecheck`, `npm run build` limpos; `grep -rn "groundTilemap\|createGroundTilemap" src` sem ocorrências.
- [ ] **Step 6: Fumaça no navegador** — `npm run dev` (checar a porta), navegador embutido: sem erros no console; o chão novo e o anel escurecido aparecem; nenhuma área vazia no zoom mínimo (roda do mouse); trocar de sala (matar o inimigo 3 vezes) muda o piso sem imagens duplicadas na câmera da interface. Se a janela estiver oculta e o jogo não rodar, registrar isso e deixar o roteiro da spec §5 para o autor. Parar o servidor ao final.
- [ ] **Step 7: Commit** — `git add -A src && git commit -m "feat: draw the procedural floor and skirt in a single container, rebuilt on room.enter"`

---

### Task 9: Limpeza, licenças e documentação

**Files:**
- Delete: `public/assets/tiles/grass.png`, `public/assets/tiles/water.png`
- Modify: `src/visual/assetRegistry.ts`, `src/visual/assetRegistry.test.ts` (exceção declarada), `public/assets/README.md`, `public/assets/LICENSES.md`, `Contexto_pesquisa/documento-tecnico-mestre.md`, `docs/superpowers/specs/2026-10-17-e2-arena-procedural-design.md`

- [ ] **Step 1: Confirmar que nada usa os tiles antigos** — `grep -rn "groundGrass\|groundWater\|grass.png\|water.png" src index.html`; só devem restar `assetRegistry.ts` e seu teste.
- [ ] **Step 2: Atualizar o registro e o teste** — remover `groundGrass` e `groundWater` de `ASSET_KEYS`; em `assetRegistry.test.ts` tirar `'ground_grass'` e `'ground_water'` da lista esperada (única alteração de asserção deste arquivo).
- [ ] **Step 3: Remover os PNGs** — `git rm public/assets/tiles/grass.png public/assets/tiles/water.png`.
- [ ] **Step 4: Documentação** — `public/assets/README.md` (tiles do piso em `tiles/floor/`, 128 × 96, câmera 48,59°; personagens re-renderizados); `public/assets/LICENSES.md` (tiles do piso autorais, gerados por `tools/blender/render_floor_tiles.py`, sem textura externa; **remover** a linha "licença a conferir" de `grass.png`/`water.png`); documento mestre: `grep -n "45°\|losango\|isom" Contexto_pesquisa/documento-tecnico-mestre.md` e atualizar toda afirmação sobre WASD girado 45°, projeção em losango e tile 64 × 32 para a nova projeção (64 × 48, sem giro, W vai para cima), §3.3 (status ✅ de conjunto de tiles, composição, registro por derivação `floorSeed(run.start.seed, room.enter.room_idx)`, anel e fundo), §3.8 (E2 ✅ com a data, "playtest visual pendente"), a linha de versão (`GAME_VERSION 0.0.3+viewB` e por quê) e os pendentes de §9; spec do E2: linha "Status: implementado em <data>, commits …".
- [ ] **Step 5: Verificação final** — `npm test`, `npm run typecheck`, `npm run build` limpos; `git status` limpo; `wc -l src/scenes/ArenaScene.ts` ≤ 200; `git diff master --stat -- src/core src/game src/combat src/opportunity src/profile src/ai src/telemetry` mostra apenas `schema.ts` (constante da versão) e `telemetryRecorder.test.ts` (uma asserção).
- [ ] **Step 6: Commit** — `git add -A && git commit -m "chore: remove the old ground tiles, update the asset registry and docs for E2"`
