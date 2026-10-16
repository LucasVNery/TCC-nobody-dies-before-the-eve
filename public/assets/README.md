# Assets

Pasta `public/` do Vite: tudo aqui é servido como está e copiado para o build, e o Phaser carrega por `this.load.*('/assets/...')` (ver `ArenaScene.preload`).

## Estrutura em uso

```
public/assets/
├── characters/
│   ├── player/      idle.png, walk.png
│   └── assaltante/  idle.png, walk.png
├── tiles/           grass.png, water.png
└── LICENSES.md
```

## Projeção e sprites

- O jogo é **isométrico** (projeção dimétrica 2:1; tile lógico de 64 unidades = 64 x 32 px).
- Personagens: sprites **128 x 128 px em 8 direções**, pré-renderizados no Blender a partir dos modelos KayKit (CC0). **idle** com 1 quadro e **walk** com 6 quadros a 8 fps. O pipeline está em `tools/blender/`.
- Tiles de chão: `grass.png` e `water.png`, em losango 2:1.

## Histórico

`public/assets/_unused/` (pacotes de terceiros isométricos e modelos 3D recebidos em 2026-08-24, sem uso no código) foi removido em 2026-10-16; o conteúdo continua no histórico do git.

Licenças e fontes: ver `LICENSES.md`.
