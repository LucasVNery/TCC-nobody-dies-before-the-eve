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
- **Formato:** PNG, tile quadrado (qualquer tamanho — hoje o código usa 64×64, mas eu ajusto pro tamanho real do tile que vier).

## O que NÃO precisa ainda
- Spritesheets de animação (idle/walk/attack) — o jogo ainda não tem sistema de animação, é o próximo passo depois dos assets estáticos entrarem.
- Múltiplos tiles de chão / variações — um tile só já resolve por enquanto (o tilemap já existe, só troca a textura).

## Depois de colocar os arquivos

Me avise (ou já me diga os nomes dos arquivos/pasta) que eu:
1. Ajusto `src/visual/assetRegistry.ts` e `src/visual/placeholderTextures.ts` pra carregar os arquivos reais em vez de gerar textura por código.
2. Ajusto `ENTITY_SIZE`/`GROUND_TILE_SIZE` pro tamanho real dos arquivos.
3. Confirmo no playtest que nada quebrou (y-sort, seta de direção, colisão).
