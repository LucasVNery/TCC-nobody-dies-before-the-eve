# E2: Projeção estilo Hades, arena procedural e fundo — Design

**Data:** 2026-10-17 (revisada no mesmo dia: o autor escolheu a projeção estilo Hades, caminho B)
**Status:** implementado em 2026-10-17, commits 89c0bde..HEAD; playtest visual pendente. (Padrões do Claude marcados como **[minha escolha]**.)
**Sub-projeto:** E2 do ambiente de gameplay v2. Sequência: E1 (feito) → **E2 projeção + arena** → E3 herói e inimigo comum animados → E4 chefe. Contexto: `Contexto_pesquisa/documento-tecnico-mestre.md` §3.3 e §3.8.

## 1. Intenção

A tese é sobre o sistema de análise de perfil; o ambiente só precisa ser **legível, coerente e feito por você**. O autor pediu que a câmera se pareça com a de **Hades**: vista inclinada de cima, **sem o giro de 45°** do losango atual. Arena retangular alinhada à tela, W vai para cima, tiles retangulares.

O E2 tem duas partes, nesta ordem:
- **Parte A, projeção:** trocar a vista em losango 2:1 por uma vista inclinada alinhada à tela. É uma mudança só de apresentação e de mapeamento de entrada; a lógica continua em coordenadas de mundo.
- **Parte B, chão:** 5 tiles modelados do zero no Blender, compostos por uma função pura e determinística, com piso novo a cada sala, um anel de tiles (*skirt*) ao redor da arena e uma cor de fundo, para a câmera nunca mostrar vazio.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- Projeção `GROUND_PROJECTION`: mundo (x, y) ⇒ tela (x·1, y·0,75) com o tile lógico de 64 unidades ocupando **64 × 48 px**; sem rotação; `W` para cima, `A` para a esquerda etc., diretamente.
- Mira, desenho de depuração, ordem de profundidade e limites da câmera coerentes com a nova projeção.
- Câmera que segue o jogador com suavização leve (sensação Hades), sem mudar o zoom padrão.
- Personagens re-renderizados no Blender com a inclinação nova.
- Tileset próprio (5 tiles), `composeFloor` determinística, piso reconstruível só com o log existente, anel de tiles e fundo.
- Remover `grass.png` e `water.png` ao fim (resolve a licença pendente).

**Não-objetivos**
- Paredes, obstáculos ou qualquer elemento que mude colisão ou geometria jogável.
- Props decorativos, iluminação dinâmica, partículas, parallax.
- Personagens novos, armas, som (E3, E4).
- Mostrar a seed do piso no painel de análise.
- Renomear ou refatorar a lógica de jogo.

**Anti-objetivos (falha mesmo que "funcione")**
- Qualquer mudança em colisão, limites, velocidades, alcances, no formato do log ou no PRNG do jogo.
- O chão competir com telegrafia, projéteis ou personagens.
- A mira do mouse ou as direções do sprite ficarem erradas em qualquer parte do mapa (já houve três calibrações erradas antes; ver §4.3).

## 3. Restrições

- **A lógica não importa Phaser nem `visual/`.** Projeção, sprites, câmera e piso ficam em `src/visual/**` e `src/scenes/**`.
- **`GAME_VERSION` sobe de `0.0.2+combatB` para `0.0.3+viewB` [minha escolha].** A lógica não muda, mas a **sensação de controle muda** (o movimento deixa de ser diagonal na tela), o que torna os logs de partidas humanas antigos não comparáveis em comportamento. Os dados-piloto podem ser descartados (documento mestre §8.5). Custo se errado: reverter uma constante e uma asserção.
- Tile lógico = 64 unidades; tela = 64 × 48 px (razão 0,75, equivale a uma câmera a ≈ 48,59° de elevação). Arena: `ARENA_BOUNDS` 1600 × 1200 ⇒ 25 × 19 tiles ⇒ 1600 × 900 px de tela.
- PNG dos tiles: **128 × 96 px, totalmente opacos** (o retângulo preenche o quadro), exibidos a 64 × 48.
- Objetos criados depois do `CameraRig.attach` aparecem nas duas câmeras: o piso fica em **um contêiner criado uma vez antes do `attach`**, cujos filhos são substituídos.
- `src/scenes/ArenaScene.ts` tem 200 linhas e o limite é ≤ 200.
- Convenção de commits: Conventional Commits em inglês, sem trailer de co-autoria; mensagens aprovadas pelo autor.

## 4. Decisões

### 4.1 Projeção **[minha escolha]**

```
toScreen(pos)   = (pos.x · W/T, pos.y · H/T)     W=64, H=48, T=64 (tileWorldSize)
fromScreen(d)   = (d.x · T/W,  d.y · T/H)
screenDepth(pos)= pos.y                           (quem está mais "embaixo" na tela fica na frente)
```

Razão 0,75 ≈ o ângulo de vista do Hades; é um parâmetro (`tileScreenHeight`), não um número espalhado. Substitui `IsoConfig`/`ISO_CONFIG`/`isometricProjection.ts` por `GroundProjection`/`GROUND_PROJECTION`/`groundProjection.ts`.

Efeitos em cadeia, todos de apresentação: `mapMovement` vira identidade; `mapAim` usa `fromScreen`; elipse do alcance de ataque e leques de depuração usam a nova projeção; limites da câmera usam os cantos projetados da arena mais a margem do anel.

### 4.2 Câmera

Segue o jogador com suavização leve (*lerp* 0,12), pixels arredondados, zoom padrão e roda do mouse como hoje (`DEFAULT_ZOOM` 2). Os limites incluem o anel de tiles; a cor de fundo cobre o que sobrar. Afinar o enquadramento é parte do playtest, por isso os números são constantes nomeadas.

### 4.3 Sprites dos personagens

A linha da folha (8 direções) já é função do **ângulo do vetor na tela** (`directionBucket` + `ROW_ROTATION_OFFSET`), não do mundo. Isso continua valendo com a nova projeção; **`directionBucket`, `ROW_ROTATION_OFFSET` e `compose_sheet` não mudam**. O que muda é só a elevação das renderizações no Blender (de 26,57° para ≈ 48,59°), em `tools/blender/render_character.py`. Depois de re-renderizar, verifica-se a calibração com uma **vista de perfil** (esquerda/direita), nunca só frente/costas (lição documentada em `tools/blender/README.md`).

### 4.4 Tileset **[minha escolha]**

Tema: laje de pedra de masmorra, poligonal, sombreado chapado, paleta fria e dessaturada, luminosidade em faixa estreita (contrasta com a telegrafia quente).

| Id | Papel | Descrição |
|---|---|---|
| `floor_base` | miolo, frequente | laje lisa, chanfro leve |
| `floor_a` | variação 1 | laje dividida ao meio por um sulco |
| `floor_b` | variação 2 | laje com um canto chanfrado |
| `floor_worn` | desgastado, raro | depressão rasa e uma rachadura |
| `floor_edge` | perímetro jogável | mais escura, bisel interno, sem lateral (um quadro só) |

Qualquer tile também serve no anel externo (§4.6). Sem linhas finas de alto contraste; sem vermelho/laranja saturados.

### 4.5 Composição

```
composeFloor(seed, colunas, linhas, tileset): string[][]
```

`TileSet = { border: string[]; interior: { id; weight; repeatable }[] }`. Moldura = `border`; miolo sorteado por peso. Entradas `repeatable:false` nunca repetem o id do vizinho à esquerda nem acima (isso também impede qualquer par adjacente); se todos os candidatos forem excluídos, sorteia entre todos. PRNG próprio (*mulberry32*), nunca o do jogo. Valida dimensões (inteiros ≥ 3) e tileset (miolo e borda não vazios, pesos finitos > 0, ids únicos) com erro claro.

### 4.6 Anel (skirt) e fundo **[minha escolha]**

`composeFloorWithSkirt(seed, colunas, linhas, skirt, tileset)` devolve uma matriz de `(colunas+2·skirt) × (linhas+2·skirt)` mais o retângulo jogável. O miolo e a moldura jogáveis são exatamente `composeFloor(seed, colunas, linhas, tileset)`; o anel usa uma segunda composição com seed derivada, cuja "borda" são os tiles de miolo. `SKIRT_TILES = 10`. O anel é escurecido por distância ao retângulo jogável (tinta). A câmera tem cor de fundo escura (`0x0b0e13`). **Só visual:** o jogador continua limitado a `ARENA_BOUNDS`.

### 4.7 Seed e registro **[minha escolha]**

`floorSeed(runSeed, roomIdx)`: hash inteiro puro. `run.start` já registra `seed` e `room.enter` já registra `room_idx`, então o piso é reconstruível só com o log existente (`floorFromEvents`), sem campo novo. O piso muda a cada sala. Um `FloorTracker` puro acompanha os eventos ao vivo (seed de reserva fixa se `room.enter` chegar antes de `run.start`).

### 4.8 Pipeline do Blender

Novo `tools/blender/render_floor_tiles.py` (headless): só a face superior de um quadrado de lado 1 com relevo ≤ 0,02, ligeiramente maior que o quadro (1,02) e cortada, para as bordas ficarem opacas e os tiles encaixarem sem frestas; câmera ortográfica com azimute 0°, elevação ≈ 48,59° (`asin(0,75)`), resolução 128 × 96, `ortho_scale` 1,0 (o quadro mostra exatamente 1 × 1 de chão; o quadrado escalado a 1,02 transborda e é cortado). Parâmetros no topo. O Blender MCP não precisa estar conectado. `render_character.py` ganha `--elevation` (padrão 48,59°).

## 5. Testes e aceitação

Testes em Node (sem DOM):
- Projeção: `toScreen`/`fromScreen` são inversas (vários pontos, incluindo negativos e fracionários); `(64,64)` ⇒ `(64,48)`; profundidade cresce com `y`.
- Entrada: `mapMovement(1,0) = {1,0}`, `(0,-1) = {0,-1}`, `(1,1)` normalizável; `mapAim` com o ponteiro à direita do jogador ⇒ `x > 0`, `y ≈ 0`; abaixo ⇒ `y > 0`.
- Depuração: `sectorPoints`/`boxCorners` com a nova projeção (números exatos derivados da fórmula).
- Piso: determinismo, dimensões, moldura, regra de vizinhança (50 seeds), troca de tileset, tileset inválido, golden da matriz e dos valores de `floorSeed`; `composeFloorWithSkirt` (dimensões, retângulo jogável igual a `composeFloor`, anel determinístico); `floorFromEvents` e `FloorTracker` (seed ausente ou malformada, sala sem `run.start`).
- Arquivos: cada PNG de tile existe, tem 128 × 96, **todos os pixels opacos**, luminância média e dispersão dentro dos limites.
- `FloorView` (stub de cena): uma imagem por célula na posição projetada, `rebuild` duas vezes deixa exatamente `células` filhos, textura ausente falha no boot nomeando o id.
- A suíte atual passa; **alterações de asserção permitidas e declaradas:** testes que codificam a projeção antiga (`isometricProjection.test.ts` ⇒ `groundProjection.test.ts`, `mapMovement.test.ts`, `debugDraw.test.ts`), o teste de `GAME_VERSION` e a lista de chaves de `assetRegistry.test.ts`. Nenhum teste de `core`, `combat`, `opportunity`, `profile`, `ai`, `game` ou `telemetry` muda.

Verificação manual (jogo no navegador, a cargo do autor): o mouse aponta para onde o personagem olha à esquerda, à direita, acima e abaixo; as 8 direções do sprite batem; W/A/S/D andam alinhados à tela; a arena lê bem a 2×; nenhuma área vazia aparece em qualquer zoom; trocar de sala muda o piso sem duplicar imagens; F9 não deixa pisos duplicados.

**Critério de pronto da arte:** o autor aprova os 5 tiles em jogo a 2×; no máximo 2 rodadas de ajuste depois da primeira entrega.

## 6. Deixado ao implementador

Modelagem detalhada dos tiles (§4.4); PRNG e hash exatos (congelados em testes *golden*); contêiner do piso como `Container` ou `RenderTexture`; organização interna de `src/visual/floor/`; nomes internos da câmera suave.

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Mira ou direção do sprite erradas após a troca | Testes inversos da projeção; verificação manual de perfil; `directionBucket`/offset intactos |
| Controles diferentes tornam logs antigos incomparáveis | `GAME_VERSION` sobe para `0.0.3+viewB` |
| Frestas visíveis entre tiles | Tiles opacos, 1,02 de escala cortada, teste de opacidade |
| Piso criado depois do `attach` aparece nas duas câmeras | Contêiner único antes do `attach` |
| Tiles competem com telegrafia | Paleta fria, limites de luminância, verificação a 2× |
| Arte nunca "termina" | No máximo 2 rodadas |

## 8. Decisões que você pode querer mudar

1. **Razão 0,75** (§4.1): quanto mais perto de 1, mais "de cima" (a 1,0 vira vista totalmente vertical); é uma constante.
2. **`GAME_VERSION` sobe** (§3).
3. **Tema do chão** (§4.4), **seed derivada do log** e **piso novo a cada sala** (§4.7: para um piso por run, troque `roomIdx` por `0`).
4. **Anel de 10 tiles com escurecimento** (§4.6).

## 9. Divergências da implementação

- `ortho_scale` 1,0 em vez de 1,02: com 1,02 a borda do quadrado coincidia com a do quadro e a linha de pixels de borda saía semitransparente (223 pixels não opacos por tile); o quadrado escalado a 1,02 transborda o quadro de 1,0 e é cortado.
- Câmera dos tiles a `asin(0,75)` (48,59°) em vez dos 26,57° do losango 2:1 anterior.
- `floor_edge` sem face lateral (só a face superior, como os demais).
- Zoom e limites da câmera ajustados na implementação (`cameraZoom`, `worldCameraBounds`), não fixados no desenho.
- `FloorView` genérica: desenha qualquer `FloorLayout` com o anel; não conhece a arena.
