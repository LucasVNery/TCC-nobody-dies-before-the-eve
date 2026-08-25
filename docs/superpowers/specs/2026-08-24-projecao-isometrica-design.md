# Spec — Projeção Isométrica

**Data:** 24/08/2026
**Status:** proposto, aguardando revisão
**Escopo:** substitui a renderização top-down reta implementada no sub-projeto "Esqueleto Visual 2.5D" (`docs/superpowers/specs/2026-08-18-esqueleto-visual-2-5d-design.md`) por uma projeção isométrica de verdade (câmera em ângulo, chão em losango) — mantendo intacta toda a lógica de simulação (`combat/`, `opportunity/`, `ai/`, `profile/`), que permanece em coordenadas cartesianas. Este sub-projeto cobre **apenas** a camada de projeção/render; não introduz boss, múltiplos inimigos, nem telemetria.

---

## 1. Por que este recorte

O sub-projeto anterior deixou a base visual pronta (sprites + seta de direção + chão em tilemap), mas assumindo uma câmera reta de cima. Referências visuais concretas trazidas pelo usuário (screenshots do próprio Hades, e um tileset isométrico real já obtido) confirmaram que o jogo de referência usa câmera em ângulo — chão desenhado como losango, não quadrado reto — algo que a decisão original ("top-down/isométrico leve") descrevia de forma imprecisa. Um mockup estático (`docs/mockups/isometric-tileset-example.html`) validou que:
- o tileset obtido (`_unused/isometric tileset/`, um único pacote/artista) encaixa sem gaps numa grade isométrica 2:1 quando projetado com `screenX = (col−row)×32`, `screenY = (col+row)×16`;
- blocos coloridos posicionados nessa mesma grade demonstram profundidade plausível com apenas sombra oval + z-order por `col+row`, sem precisar de eixo Z real.

Este sub-projeto existe para levar essa validação visual (feita em HTML solto) para dentro do jogo real, sem quebrar o desacoplamento entre lógica e visual já travado nos specs anteriores.

Fora de escopo: sprites humanoides reais para player/Assaltante (ainda não fornecidos — chão troca de placeholder pra tileset real, personagens continuam como blocos coloridos por enquanto); variação de tiles (múltiplos tipos de chão/decoração); boss; qualquer mudança em `combat/`, `opportunity/`, `ai/`, `profile/` além de leitura (nenhuma dessas camadas é modificada).

## 2. Decisões travadas nesta rodada

| Decisão | Escolha |
|---|---|
| Fronteira lógica/visual | `combat/`, `opportunity/`, `ai/`, `profile/` continuam cartesianos, sem qualquer referência a projeção. Existe **um único ponto de conversão**: `src/visual/isometricProjection.ts`. Nada fora de `src/visual/` importa esse módulo. |
| Fórmula de projeção | `screenX = (worldCol − worldRow) × TILE_HALF_WIDTH`, `screenY = (worldCol + worldRow) × TILE_HALF_HEIGHT` — mesma fórmula 2:1 validada no mockup. `worldCol`/`worldRow` são a posição cartesiana já existente (`Vec2`) dividida pelo tamanho do tile, não uma grade nova — nenhum sistema de coordenadas novo entra em `combat/`. |
| Y-sort | Passa de `depth = pos.y` para `depth = worldCol + worldRow` (equivalente a `pos.x + pos.y` na escala do tile) — critério correto de profundidade em isometria 2:1. Continua usando o `depth` nativo do Phaser, sem sistema de camadas customizado. |
| Chão | Tentativa 1: tilemap com `orientation: 'isometric'` nativo do Phaser 3 (`Phaser.Tilemaps.Orientation.ISOMETRIC`). Se o comportamento nativo se mostrar limitado durante a implementação (ex.: dificuldade de alinhar com `ARENA_BOUNDS` cartesiano), fallback documentado: posicionar cada tile como `Image` avulsa via `isometricProjection.toScreen`, do mesmo jeito validado no mockup. Textura do chão passa do placeholder cinza para os tiles reais do pacote `_unused/isometric tileset/` (grama/terra/água), movido de volta para `public/assets/tiles/`. |
| Entidades | `DirectionalSprite.syncPosition` passa a projetar a posição recebida antes de mover o container (`toScreen(pos)`) e usa `screenDepth(pos)` no lugar de `pos.y` — interface pública (`syncPosition`/`syncDirection`/`setTint`) não muda, só o corpo do método. Sprites de player/Assaltante continuam placeholder (blocos coloridos) — sem asset humanoide ainda. |
| Debug overlay | `drawDebugHitboxes` (em `ArenaScene.ts`) passa a projetar os 4 cantos de cada `AABB` via `toScreen` antes de desenhar, usando `Graphics.strokePoints`/`fillPoints` (polígono) em vez de `strokeRect`/`fillRect`. Necessário para que as hitboxes de debug continuem alinhadas visualmente com os sprites projetados — sem isso o overlay de debug perde a utilidade. |

## 3. Arquitetura

```
src/
├── visual/
│   ├── isometricProjection.ts  NOVO — toScreen(pos): Vec2, screenDepth(pos): number
│   ├── directionalSprite.ts    MODIFICADO — syncPosition projeta via isometricProjection
│   ├── groundTilemap.ts        MODIFICADO — chão em losango (nativo Phaser ou fallback manual)
│   ├── assetRegistry.ts        MODIFICADO — chave de textura do chão aponta pro tileset real
│   └── placeholderTextures.ts  MODIFICADO — remove geração da textura de chão (substituída por asset real); player/assaltante seguem placeholder
└── scenes/
    └── ArenaScene.ts           MODIFICADO — drawDebugHitboxes projeta os cantos das hitboxes antes de desenhar

public/assets/
└── tiles/                      tileset isométrico real movido de _unused/ pra cá
```

`isometricProjection.ts` não importa nada de `combat/`/`opportunity/`/`ai/`/`profile/` — recebe apenas `Vec2` primitivos, igual às regras já em vigor pro resto de `src/visual/`.

## 4. Componentes

### `src/visual/isometricProjection.ts`
```ts
export interface IsoConfig {
  tileWorldSize: number;   // tamanho do tile em unidades cartesianas (mesmo valor usado na colisão)
  halfWidth: number;       // metade da largura do losango na tela (px)
  halfHeight: number;      // metade da altura do losango na tela (px)
}

export function toScreen(pos: Vec2, config: IsoConfig): Vec2;
export function screenDepth(pos: Vec2, config: IsoConfig): number;
```
`toScreen` converte `pos.x`/`pos.y` (cartesiano, mesma unidade de `ARENA_BOUNDS`) para coluna/linha (`pos.x / tileWorldSize`, `pos.y / tileWorldSize`) e aplica a fórmula 2:1. `screenDepth` retorna `col + row` (ou `pos.x + pos.y`, equivalente antes de dividir pelo tile — a decidir na implementação qual expressão fica mais legível, sem mudar o resultado). `IsoConfig` é um objeto de configuração único, criado a partir das constantes hoje em `placeholderTextures.ts`, para não espalhar números mágicos.

### `src/visual/directionalSprite.ts`
`syncPosition(pos: Vec2)` passa a chamar `toScreen(pos, config)` e usar o resultado no `container.setPosition`; `setDepth` usa `screenDepth(pos, config)`. `IsoConfig` é injetado no construtor (mesmo padrão de `baseTextureKey`/`width`/`height` já recebidos hoje) — a classe não hardcoda a configuração isométrica, só a aplica.

### `src/visual/groundTilemap.ts`
`createGroundTilemap` passa a receber a textura do tileset real (múltiplos tiles, não mais um `fill(0)` único) e monta a layer em orientação isométrica. Assinatura pode crescer (ex.: um mapa de índices de tile por posição, já que agora há grama/terra/água em vez de um tile único) — detalhe resolvido na implementação, sem afetar quem chama (`ArenaScene.create()`).

### `src/scenes/ArenaScene.ts`
`drawDebugHitboxes`: para cada `AABB` (hurtbox, hitbox de ataque, range de ataque), calcula os cantos cartesianos, projeta cada um com `toScreen`, e desenha via `Graphics.strokePoints`/`fillPoints`. O círculo de `ATTACK_RANGE` (hoje um `strokeCircle` perfeito) vira uma elipse na projeção isométrica — usar `Graphics.strokeEllipse` com os raios ajustados pela mesma proporção 2:1, centrado no ponto projetado.

## 5. Fluxo de dados

Simulação (`encounter.step()`) roda exatamente como antes, em cartesiano, sem saber que existe projeção. `ArenaScene.update()` lê `position`/`facing`/`attackDirection` dos controllers (inalterado) e repassa pro `DirectionalSprite`, que agora projeta internamente antes de desenhar. O chão é montado uma vez em `create()`, já na orientação isométrica, usando os `ARENA_BOUNDS` cartesianos como entrada (convertidos pra número de tiles, não pra pixels de tela diretamente). O debug overlay projeta suas próprias cópias dos `AABB` a cada frame, sem alterar os `AABB` originais usados pela colisão real.

## 6. Testes

- `isometricProjection.ts` ganha suite unitária Vitest: casos de borda (origem, eixos, diagonal) verificando `toScreen`/`screenDepth` contra valores calculados à mão — mesmo padrão determinístico já usado em `collision.test.ts`/`movement.test.ts`.
- `directionalSprite.ts`, `groundTilemap.ts`, `ArenaScene.ts` permanecem fora do Vitest (dependem de canvas/WebGL real), mesma exceção já documentada nos dois specs anteriores — validados por playtest manual.
- Suite herdada de todos os sub-projetos anteriores deve continuar passando sem regressão — nenhuma mudança nesta rodada toca `combat/`, `opportunity/`, `ai/`, `profile/`.

## 7. Critério de pronto

- Chão da arena renderiza em losango, usando os tiles reais (grama/terra/água), sem gaps visíveis entre tiles.
- Jogador e Assaltante (ainda como blocos coloridos) se movem sobre o chão isométrico com y-sort correto: passar um atrás do outro produz a ordem de desenho certa segundo `col+row`.
- Debug overlay (hurtbox, hitbox de ataque, range) continua alinhado visualmente com os sprites, agora em polígonos/elipse projetados em vez de retângulos/círculo retos.
- HUD, overlay de oportunidades e controles continuam funcionando exatamente como antes.
- Todos os testes automatizados herdados continuam passando; `isometricProjection.test.ts` cobre a conversão.

## 8. Próximos sub-projetos (fora deste spec)

1. Sprites humanoides reais para player e Assaltante, no mesmo ângulo isométrico do chão (ainda não fornecidos).
2. Variação de tiles (bordas, decoração) e possivelmente um segundo tileset compatível, se as proporções baterem com o atual — critério já definido: nunca misturar artistas num mesmo piso sem validação visual prévia (como este sub-projeto fez).
3. Perfil do jogador, telemetria, roleta ponderada, PCG e boss — conforme já listado nos specs anteriores.
