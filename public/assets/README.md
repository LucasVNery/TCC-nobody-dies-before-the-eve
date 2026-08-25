# Assets — onde colocar os arquivos

Pasta gerada automaticamente pelo Vite (`public/`) — tudo aqui é servido do jeito que está e copiado pro build sem processamento, exatamente como o Phaser precisa carregar imagens via `this.load.image(key, '/assets/...')`.

## Estrutura já criada

```
public/assets/
├── sprites/   ← personagens (player, Assaltante)
└── tiles/     ← chão/tileset da arena
```

Pode simplesmente arrastar os arquivos pra dentro dessas duas pastas. Se preferir jogar tudo numa pasta só (`public/assets/`) sem separar, também funciona — eu reorganizo na hora de integrar.

## O que precisamos (lista de requisitos)

### 1. Player (sprite estático, top-down)
- **Papel:** protagonista jogável.
- **Sugestão de fonte:** [Kenney — Roguelike Characters](https://kenney.nl/assets/roguelike-characters) (CC0) — personagem tipo "aventureiro"/"rogue".
- **Formato:** PNG, fundo transparente, vista de cima (top-down), sem rotação pré-renderizada — a direção é feita em código (seta indicadora já existe, animação de virar o personagem fica pra depois).
- **Tamanho:** qualquer tamanho consistente (ex: 16×16, 32×32) — eu ajusto o `ENTITY_SIZE` no código pra bater com o que vier. Só preciso saber o tamanho nativo do arquivo.

### 2. Assaltante (sprite estático, top-down)
- **Papel:** inimigo (arquétipo "assaltante"/ladrão).
- **Sugestão de fonte:** [Kenney — Roguelike/RPG pack](https://kenney.nl/assets/roguelike-rpg-pack) (CC0) — tem sprites de inimigos/bandidos prontos.
- **Formato/tamanho:** mesmas regras do player — mesmo tamanho de tile do player, de preferência, pra manter proporção.

### 3. Chão da arena (tile único ou pequeno tileset)
- **Papel:** substitui o tile cinza gerado por código hoje.
- **Sugestão de fonte:** mesmo pack Roguelike/RPG (tiles de masmorra/piso).
- **Formato:** PNG, **top-down reto** (visão de cima, sem projeção isométrica/losango), tile **quadrado**, "seamless" (encaixa borda-a-borda sem gaps). Qualquer tamanho — hoje o código usa 64×64, mas eu ajusto pro tamanho real do tile que vier.
- **Importante:** tiles em formato de losango/bloco isométrico (topo em rombo) **não servem** aqui — o jogo usa câmera top-down estilo Hades com grid cartesiano reto, não isometria de verdade. Um tile em losango deixa espaço transparente em xadrez quando colocado num grid quadrado. Ver `_unused/` abaixo.

## Pasta `_unused/`
Chegaram pacotes em 2026-08-24 que **não servem** pro pipeline atual e foram movidos pra cá pra não confundir a integração:
- `isometric tileset/` — tileset em losango de verdade (isometria clássica), incompatível com o grid cartesiano top-down do jogo.
- `Essential_Isometric_3D_Block_Pack_.../` e `treeSet_pine_demo/` — modelos 3D (`.fbx`/`.obj`/`.dae`). Phaser é 2D, não carrega esses formatos direto.
- `critters/` — sprites isométricos de animais (lobo, javali, texugo, cervo), quadrúpedes. Não substituem player/Assaltante (humanoides), mas podem virar inimigo/decoração numa fase futura se a arte servir.

Nada aqui é referenciado em `src/visual/assetRegistry.ts`. Se algum dia migrarmos pra isometria de verdade, esses arquivos voltam à mesa.

## O que NÃO precisa ainda
- Spritesheets de animação (idle/walk/attack) — o jogo ainda não tem sistema de animação, é o próximo passo depois dos assets estáticos entrarem.
- Múltiplos tiles de chão / variações — um tile só já resolve por enquanto (o tilemap já existe, só troca a textura).

## Depois de colocar os arquivos

Me avise (ou já me diga os nomes dos arquivos/pasta) que eu:
1. Ajusto `src/visual/assetRegistry.ts` e `src/visual/placeholderTextures.ts` pra carregar os arquivos reais em vez de gerar textura por código.
2. Ajusto `ENTITY_SIZE`/`GROUND_TILE_SIZE` pro tamanho real dos arquivos.
3. Confirmo no playtest que nada quebrou (y-sort, seta de direção, colisão).
