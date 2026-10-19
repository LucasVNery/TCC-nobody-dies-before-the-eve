# Assets

Pasta `public/` do Vite: tudo aqui é servido como está e copiado para o build, e o Phaser carrega por `this.load.*('/assets/...')` (ver `ArenaScene.preload`).

## Estrutura em uso

```
public/assets/
├── characters/
│   ├── player/      idle.png, walk.png
│   └── assaltante/  idle.png, walk.png
├── tiles/floor/     floor_base, floor_a, floor_b, floor_worn, floor_edge (.png)
└── LICENSES.md
```

## Projeção e sprites

- O jogo usa a **projeção em losango 2:1** (giro de 45°; W/A/S/D girados para ficarem alinhados à tela). Câmera do render a elevação de 30° (`asin(0,5)`); tile lógico de 64 unidades = losango de 64 x 32 px na tela. (17/10/2026: vista retangular 64 x 48, descartada em 19/10/2026.)
- Personagens: sprites **128 x 128 px em 8 direções**, pré-renderizados no Blender a partir dos modelos KayKit (CC0), **re-renderizados em 19/10/2026** para a câmera de 30° (em 17/10 tinham sido feitos a 48,59°, vista descartada). **idle** com 1 quadro e **walk** com 6 quadros a 8 fps. O pipeline está em `tools/blender/`.
- Tiles do piso: `tiles/floor/` (`floor_base`, `floor_a`, `floor_b`, `floor_worn`, `floor_edge`), **128 x 64 px** (losango com cantos transparentes), câmera de 30°, plano a 1,05× e filtro de pixel 1,0 px, gerados por `tools/blender/render_floor_tiles.py`. A arena é composta por eles em tempo de execução (`composeFloor`).

## Histórico

`public/assets/_unused/` (pacotes de terceiros isométricos e modelos 3D recebidos em 2026-08-24, sem uso no código) foi removido em 2026-10-16; o conteúdo continua no histórico do git.

`tiles/grass.png` e `tiles/water.png` (losango 2:1, de terceiros) foram removidos em 17/10/2026, ao fim do E2.

Licenças e fontes: ver `LICENSES.md`.
