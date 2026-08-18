# Spec — Esqueleto Visual 2.5D

**Data:** 18/08/2026
**Status:** proposto, aguardando revisão
**Escopo:** terceiro sub-projeto do TCC (ver `docs/superpowers/specs/2026-08-13-nucleo-jogavel-opportunitysystem-design.md` para o primeiro e `docs/superpowers/specs/2026-08-13-sistema-movimento-camera-design.md` para o segundo). Este spec cobre **apenas** a base visual 2.5D — camada de renderização sprite-based com y-sort, chão em tilemap, e um registro central de assets — usando placeholders gerados em runtime. Assets 3D/pré-renderizados reais e animações ficam para quando forem fornecidos; este sub-projeto só prepara a estrutura para recebê-los sem retrabalho.

---

## 1. Por que este recorte

Os dois sub-projetos anteriores validaram a lógica de combate/oportunidade e o movimento livre com câmera, mas a apresentação visual ainda é o placeholder mais cru possível: dois `Phaser.GameObjects.Rectangle` sólidos, sem chão, sem profundidade, sem direção visível. Isso bastou para provar a simulação, mas não é a base sobre a qual dá para plugar assets 3D/animados quando chegarem — trocar retângulos por sprites reais exigiria reescrever a cena do zero.

Este sub-projeto existe para:
- estabelecer a camada visual como um módulo próprio (`src/visual/`), desacoplado de `combat/`/`opportunity/`/`ai/`, seguindo a mesma restrição de arquitetura já travada nos dois specs anteriores;
- implementar y-sort real (profundidade de desenho por posição Y) — needed antes de haver múltiplos objetos que possam se cruzar na tela;
- dar ao jogador e ao Assaltante uma representação com direção visível (placeholder + seta), já que ambos já têm direção de ataque/movimento na lógica (`lastDirection`/`attackDirection`) mas nada disso aparece na tela hoje;
- criar um chão de arena visível (tilemap), delimitando visualmente os `ARENA_BOUNDS` que hoje só existem como limite lógico;
- deixar um ponto único (`assetRegistry.ts`) para trocar cada placeholder por um asset real depois, sem tocar em `ArenaScene.ts` nem nos controllers.

Fora de escopo: qualquer asset 3D real, pré-renderizado ou animado; animações (idle/walk/attack); iluminação, sombras, ou efeitos de partícula; tileset real (o tile do chão continua sendo uma textura placeholder gerada); múltiplas salas/tilesets variados.

## 2. Decisões travadas nesta rodada

| Decisão | Escolha |
|---|---|
| Y-sort | Profundidade de desenho = posição Y da entidade (`container.setDepth(container.y)`), recalculada a cada frame — sem eixo Z real, conforme decisão já travada no projeto. Nenhum sistema de camadas customizado; usa o `depth` nativo do Phaser. |
| Representação de entidades | `Phaser.GameObjects.Container` com dois filhos: imagem base (placeholder colorido) + seta pequena indicando direção. Ambos os filhos trocam de textura junto quando os assets reais chegarem — a interface pública (`syncPosition`/`syncDirection`/`setTint`) não muda. |
| Chão | Tilemap programático do Phaser (`this.make.tilemap` + layer em branco + `fill`), sem Tiled/JSON, do tamanho de `ARENA_BOUNDS`, com um único tile placeholder gerado em runtime. `depth = -1` fixo, sempre atrás das entidades. |
| Pipeline de assets | Registro central (`assetRegistry.ts`) mapeando papel (`player`, `assaltante`, `ground`, `directionArrow`) → chave de textura Phaser. Geração das texturas placeholder isolada em `placeholderTextures.ts`, chamada em `preload()`. |
| Exposição de direção pelos controllers | `PlayerController` ganha `get facing(): Vec2` (retorna o `lastDirection` já existente, hoje privado). `AssaltanteController` ganha `get attackDirection(): Vec2` (idem, sobre o campo já existente). Mesmo padrão do getter `activeRuleId` já commitado no sub-projeto de movimento. |
| Feedback visual de estado | Mantém paridade com o que já existe hoje via `setTint`/cor no lugar de `setFillColor`/`setFillStyle`: i-frames do dash do jogador, estado `attacking` do Assaltante. |

## 3. Arquitetura

```
src/
├── combat/
│   ├── playerController.ts     MODIFICADO — expõe `facing: Vec2` (getter sobre `lastDirection`)
│   └── assaltanteController.ts MODIFICADO — expõe `attackDirection: Vec2` (getter sobre campo já existente)
├── visual/                     NOVO
│   ├── assetRegistry.ts        NOVO — chaves de textura por papel
│   ├── placeholderTextures.ts  NOVO — gera as texturas placeholder via Phaser.Graphics
│   ├── directionalSprite.ts    NOVO — Container (sprite base + seta) com sync de posição/direção/tint
│   └── groundTilemap.ts        NOVO — monta o tilemap de chão programático
└── scenes/
    └── ArenaScene.ts           MODIFICADO — troca os Rectangle por DirectionalSprite, cria o chão, sincroniza posição/direção/tint a cada frame
```

`src/visual/` nunca importa de `combat/`, `opportunity/` ou `ai/` — recebe apenas primitivos (`Vec2`, `number`, `string`) nos seus métodos públicos. `scenes/ArenaScene.ts` continua sendo a única camada que enxerga os dois lados, exatamente como nos dois sub-projetos anteriores.

## 4. Componentes

### `src/visual/assetRegistry.ts`
```ts
export const ASSET_KEYS = {
  player: 'placeholder_player',
  assaltante: 'placeholder_assaltante',
  ground: 'placeholder_ground_tile',
  directionArrow: 'placeholder_direction_arrow',
} as const;
```
Ponto único a editar quando um asset real (spritesheet, atlas, tileset) substituir um placeholder — nem `ArenaScene.ts` nem os controllers mudam.

### `src/visual/placeholderTextures.ts`
- `generatePlaceholderTextures(scene: Phaser.Scene): void` — chamado em `ArenaScene.preload()`. Usa `scene.add.graphics()` + `generateTexture(key, width, height)` para desenhar, sem depender de nenhum arquivo de imagem:
  - `ASSET_KEYS.player`: quadrado verde.
  - `ASSET_KEYS.assaltante`: quadrado vermelho.
  - `ASSET_KEYS.ground`: tile em cor sólida neutra (ex.: cinza escuro), do tamanho do tile do tilemap.
  - `ASSET_KEYS.directionArrow`: triângulo pequeno branco, apontando para +x por padrão (rotacionado depois pelo `DirectionalSprite`).
- A instância de `Graphics` usada para gerar cada textura é destruída (`graphics.destroy()`) após `generateTexture()`, já que só serve para desenhar a textura uma vez.

### `src/visual/directionalSprite.ts`
```ts
export class DirectionalSprite {
  constructor(scene: Phaser.Scene, baseTextureKey: string, width: number, height: number, initialPosition: Vec2);
  syncPosition(pos: Vec2): void;   // container.setPosition(pos.x, pos.y); container.setDepth(pos.y)
  syncDirection(dir: Vec2): void;  // arrowChild.setRotation(Math.atan2(dir.y, dir.x))
  setTint(color: number): void;    // baseChild.setTint(color)
}
```
Internamente monta um `Phaser.GameObjects.Container` com dois filhos: a imagem base (`baseTextureKey`) centralizada, e a seta (`ASSET_KEYS.directionArrow`) deslocada na borda da base. Guardar a referência ao container é privado — nada fora da classe manipula os filhos diretamente.

### `src/visual/groundTilemap.ts`
```ts
export function createGroundTilemap(
  scene: Phaser.Scene,
  bounds: AABB,
  tileSize: number,
): Phaser.Tilemaps.TilemapLayer;
```
Monta um tilemap em branco (`scene.make.tilemap({ tileWidth: tileSize, tileHeight: tileSize, width: Math.ceil(bounds.width / tileSize), height: Math.ceil(bounds.height / tileSize) })`), adiciona um tileset a partir da textura `ASSET_KEYS.ground` (`tilemap.addTilesetImage(...)`), cria uma layer em branco e usa `layer.fill(0)` para preencher com o único tile placeholder. Posiciona a layer em `(bounds.x, bounds.y)` e fixa `layer.setDepth(-1)`.

### `src/combat/playerController.ts`
- Adiciona `get facing(): Vec2 { return { x: this.lastDirection.x, y: this.lastDirection.y }; }` — cópia defensiva, mesmo padrão do `get position()` já existente.

### `src/combat/assaltanteController.ts`
- Adiciona `get attackDirection(): Vec2 { return { x: this.attackDirection.x, y: this.attackDirection.y }; }` (renomeando internamente se necessário para evitar colisão de nome entre o campo privado e o getter público — resolvido no código, não afeta a interface descrita aqui).

### `src/scenes/ArenaScene.ts`
- `preload()`: chama `generatePlaceholderTextures(this)`.
- `create()`: chama `createGroundTilemap(this, ARENA_BOUNDS, TILE_SIZE)`; substitui `this.add.rectangle(...)` por `new DirectionalSprite(this, ASSET_KEYS.player, ...)` e `new DirectionalSprite(this, ASSET_KEYS.assaltante, ...)`; câmera (`startFollow`/`setBounds`) continua igual, agora seguindo o container do `DirectionalSprite` do jogador em vez do `Rectangle`.
- `update()`: troca as chamadas de `setPosition`/`setFillColor`/`setFillStyle` pelos métodos correspondentes de `DirectionalSprite` (`syncPosition`, `syncDirection`, `setTint`), lendo `encounter.player.facing` e `encounter.assaltante.attackDirection`. HUD, overlay de oportunidades e texto de controles não mudam.

## 5. Fluxo de dados

`ArenaScene.preload()` gera as texturas placeholder → `create()` monta o chão (tilemap) e os dois `DirectionalSprite` → a cada `update()`, a simulação (`encounter.step()`) roda como já rodava nos sub-projetos anteriores (inalterada) → `ArenaScene` lê `position`/`facing`/`attackDirection`/estado de cada controller e repassa para o `DirectionalSprite` correspondente via `syncPosition`/`syncDirection`/`setTint` → o `depth` setado em `syncPosition` faz o Phaser desenhar na ordem certa automaticamente; a câmera continua seguindo o container do jogador.

## 6. Testes

- Os dois novos getters (`PlayerController.facing`, `AssaltanteController.attackDirection`) ganham teste unitário Vitest, no mesmo padrão TDD do getter `activeRuleId`: setar uma direção via movimento/ataque e verificar que o getter reflete o valor esperado.
- `assetRegistry.ts`, `placeholderTextures.ts`, `directionalSprite.ts`, `groundTilemap.ts` dependem de um `Phaser.Scene`/canvas real (WebGL/Canvas rendering, geração de textura) — não são testáveis de forma significativa em Vitest headless. Mesma exceção já documentada no sub-projeto 1 (Task 11: "Phaser's canvas/WebGL rendering is out of scope for Vitest"). Validados por playtest manual.
- Suite automatizada herdada dos dois sub-projetos anteriores deve continuar passando sem regressão (nenhuma mudança em `combat/`, `opportunity/`, `ai/` além dos dois getters).

## 7. Critério de pronto

- Chão (tilemap) visível preenchendo os `ARENA_BOUNDS`, no lugar do fundo vazio atual.
- Jogador e Assaltante aparecem como sprite + seta de direção, não mais retângulo sólido.
- A seta do jogador gira conforme a última direção de movimento/dash; a do Assaltante conforme a direção de ataque.
- Y-sort correto: mover o jogador ao redor do Assaltante muda visivelmente quem desenha por cima, de acordo com a posição Y de cada um.
- HUD de debug (contadores de dash, estado do Assaltante) e overlay de oportunidades continuam funcionando exatamente como antes, por cima da nova camada visual.
- Todos os testes automatizados herdados dos dois sub-projetos anteriores continuam passando.

## 8. Próximos sub-projetos (fora deste spec)

1. Substituir os placeholders gerados em runtime por assets 3D/pré-renderizados reais e animações (idle/walk/attack), usando o `assetRegistry.ts` como ponto de troca.
2. Perfil do jogador, telemetria, roleta ponderada, PCG e boss — conforme já listado nos specs dos sub-projetos anteriores.
