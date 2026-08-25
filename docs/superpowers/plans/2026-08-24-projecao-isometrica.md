# Projeção Isométrica Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a renderização do chão e das entidades de top-down reto (grid cartesiano desenhado 1:1 na tela) para uma projeção isométrica de verdade (losango, offset 2:1), sem tocar em `combat/`, `opportunity/`, `ai/` ou `profile/`.

**Architecture:** Um único módulo novo, `src/visual/isometricProjection.ts`, expõe `toScreen`/`screenDepth` como a única fronteira entre coordenadas cartesianas (usadas por toda a simulação) e coordenadas de tela (usadas só dentro de `src/visual/` e `ArenaScene.drawDebugHitboxes`). O chão passa a ser desenhado tile a tile (imagens posicionadas manualmente via `toScreen`, sem depender do sistema de Tilemap do Phaser), usando os tiles reais do pacote isométrico já validado num mockup HTML solto.

**Tech Stack:** Phaser 3.80 (Canvas/WebGL via `scene.add.image`), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-projecao-isometrica-design.md`

## Global Constraints

- `src/visual/` nunca importa de `combat/`, `opportunity/`, `ai/` ou `profile/` — só recebe `Vec2`/`AABB`/primitivos.
- Nenhuma mudança em `combat/`, `opportunity/`, `ai/`, `profile/` nesta rodada — a suite de testes herdada desses módulos deve continuar passando sem alteração.
- Projeção isométrica 2:1: `screenX = (col − row) × halfWidth`, `screenY = (col + row) × halfHeight`, onde `col = pos.x / tileWorldSize` e `row = pos.y / tileWorldSize`.
- `screenDepth(pos) = pos.x + pos.y` (equivalente a `col + row` na mesma escala) — usado em todo `setDepth` de entidade.
- Tileset do chão: apenas o pacote já validado em `public/assets/_unused/isometric tileset/isometric tileset/separated images/` (`tile_022.png` = grama, `tile_099.png` = água) — nenhum outro pacote/artista é misturado nesta rodada.

---

## Task 1: `isometricProjection.ts`

**Files:**
- Create: `src/visual/isometricProjection.ts`
- Test: `src/visual/isometricProjection.test.ts`

**Interfaces:**
- Produces: `interface IsoConfig { tileWorldSize: number; halfWidth: number; halfHeight: number }`, `function toScreen(pos: Vec2, config: IsoConfig): Vec2`, `function screenDepth(pos: Vec2, config: IsoConfig): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/visual/isometricProjection.test.ts
import { describe, it, expect } from 'vitest';
import { toScreen, screenDepth, type IsoConfig } from './isometricProjection';

const config: IsoConfig = { tileWorldSize: 64, halfWidth: 32, halfHeight: 16 };

describe('toScreen', () => {
  it('maps the world origin to the screen origin', () => {
    expect(toScreen({ x: 0, y: 0 }, config)).toEqual({ x: 0, y: 0 });
  });

  it('maps a point along world +x to the right and down (screen)', () => {
    // col = 64/64 = 1, row = 0 -> screenX = (1-0)*32 = 32, screenY = (1+0)*16 = 16
    expect(toScreen({ x: 64, y: 0 }, config)).toEqual({ x: 32, y: 16 });
  });

  it('maps a point along world +y to the left and down (screen)', () => {
    // col = 0, row = 64/64 = 1 -> screenX = (0-1)*32 = -32, screenY = (0+1)*16 = 16
    expect(toScreen({ x: 0, y: 64 }, config)).toEqual({ x: -32, y: 16 });
  });

  it('maps equal x/y (diagonal) straight down on screen', () => {
    // col = row = 2 -> screenX = 0, screenY = (2+2)*16 = 64
    expect(toScreen({ x: 128, y: 128 }, config)).toEqual({ x: 0, y: 64 });
  });

  it('supports fractional world positions (continuous movement, not grid-locked)', () => {
    // col = 32/64 = 0.5, row = 16/64 = 0.25 -> screenX = (0.5-0.25)*32 = 8, screenY = (0.5+0.25)*16 = 12
    expect(toScreen({ x: 32, y: 16 }, config)).toEqual({ x: 8, y: 12 });
  });
});

describe('screenDepth', () => {
  it('returns 0 at the world origin', () => {
    expect(screenDepth({ x: 0, y: 0 }, config)).toBe(0);
  });

  it('increases as x increases (moving "into" the isometric view)', () => {
    expect(screenDepth({ x: 64, y: 0 }, config)).toBeGreaterThan(screenDepth({ x: 0, y: 0 }, config));
  });

  it('increases as y increases', () => {
    expect(screenDepth({ x: 0, y: 64 }, config)).toBeGreaterThan(screenDepth({ x: 0, y: 0 }, config));
  });

  it('is equal for two points on the same iso diagonal (x+y constant)', () => {
    expect(screenDepth({ x: 64, y: 0 }, config)).toBe(screenDepth({ x: 0, y: 64 }, config));
    expect(screenDepth({ x: 32, y: 32 }, config)).toBe(screenDepth({ x: 64, y: 0 }, config));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- isometricProjection`
Expected: FAIL — `Cannot find module './isometricProjection'` (file doesn't exist yet).

- [ ] **Step 3: Implement `isometricProjection.ts`**

```ts
// src/visual/isometricProjection.ts
import type { Vec2 } from '../combat/types';

export interface IsoConfig {
  tileWorldSize: number;
  halfWidth: number;
  halfHeight: number;
}

export function toScreen(pos: Vec2, config: IsoConfig): Vec2 {
  const col = pos.x / config.tileWorldSize;
  const row = pos.y / config.tileWorldSize;
  return {
    x: (col - row) * config.halfWidth,
    y: (col + row) * config.halfHeight,
  };
}

export function screenDepth(pos: Vec2, _config: IsoConfig): number {
  return pos.x + pos.y;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- isometricProjection`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/visual/isometricProjection.ts src/visual/isometricProjection.test.ts
git commit -m "feat: add cartesian-to-isometric screen projection"
```

---

## Task 2: Real ground tile assets + registry

**Files:**
- Create: `public/assets/tiles/grass.png` (copy of `public/assets/_unused/isometric tileset/isometric tileset/separated images/tile_022.png`)
- Create: `public/assets/tiles/water.png` (copy of `public/assets/_unused/isometric tileset/isometric tileset/separated images/tile_099.png`)
- Modify: `src/visual/assetRegistry.ts`
- Modify: `src/visual/assetRegistry.test.ts`
- Modify: `src/visual/placeholderTextures.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `ASSET_KEYS.groundGrass`, `ASSET_KEYS.groundWater` (texture keys, loaded from real image files via `scene.load.image`, NOT generated at runtime), `ISO_CONFIG: IsoConfig` (from Task 1's `IsoConfig`) exported from `placeholderTextures.ts`.

- [ ] **Step 1: Copy the two tile images into `public/assets/tiles/`**

```bash
cp "public/assets/_unused/isometric tileset/isometric tileset/separated images/tile_022.png" "public/assets/tiles/grass.png"
cp "public/assets/_unused/isometric tileset/isometric tileset/separated images/tile_099.png" "public/assets/tiles/water.png"
```

- [ ] **Step 2: Update the failing registry test first**

```ts
// src/visual/assetRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { ASSET_KEYS } from './assetRegistry';

describe('ASSET_KEYS', () => {
  it('defines a unique texture key for every visual role', () => {
    const keys = Object.values(ASSET_KEYS);
    expect(keys).toEqual([
      'placeholder_player',
      'placeholder_assaltante',
      'ground_grass',
      'ground_water',
      'placeholder_direction_arrow',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- assetRegistry`
Expected: FAIL — actual keys still include `placeholder_ground_tile`, not `ground_grass`/`ground_water`.

- [ ] **Step 4: Update `assetRegistry.ts`**

```ts
export const ASSET_KEYS = {
  player: 'placeholder_player',
  assaltante: 'placeholder_assaltante',
  groundGrass: 'ground_grass',
  groundWater: 'ground_water',
  directionArrow: 'placeholder_direction_arrow',
} as const;
```

- [ ] **Step 5: Update `placeholderTextures.ts`** — remove the runtime-generated ground texture (replaced by the real image files loaded in `ArenaScene.preload()` in Task 3) and add the shared `ISO_CONFIG`

```ts
// src/visual/placeholderTextures.ts
import type Phaser from 'phaser';
import { ASSET_KEYS } from './assetRegistry';
import type { IsoConfig } from './isometricProjection';

export const GROUND_TILE_SIZE = 64;
export const ENTITY_SIZE = 20;
const DIRECTION_ARROW_SIZE = 10;

export const ISO_CONFIG: IsoConfig = {
  tileWorldSize: GROUND_TILE_SIZE,
  halfWidth: 32,
  halfHeight: 16,
};

export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  generateSquareTexture(scene, ASSET_KEYS.player, ENTITY_SIZE, 0x4caf50);
  generateSquareTexture(scene, ASSET_KEYS.assaltante, ENTITY_SIZE, 0xf44336);
  generateArrowTexture(scene, ASSET_KEYS.directionArrow, DIRECTION_ARROW_SIZE);
}

function generateSquareTexture(scene: Phaser.Scene, key: string, size: number, color: number): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(color, 1);
  graphics.fillRect(0, 0, size, size);
  graphics.generateTexture(key, size, size);
  graphics.destroy();
}

function generateArrowTexture(scene: Phaser.Scene, key: string, size: number): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(0xffffff, 1);
  graphics.fillTriangle(0, 0, 0, size, size, size / 2);
  graphics.generateTexture(key, size, size);
  graphics.destroy();
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- assetRegistry`
Expected: PASS.

Run: `npm test`
Expected: PASS for the whole suite except `groundTilemap`-adjacent code, which Task 3 will fix (this task doesn't touch `groundTilemap.ts`, so nothing should currently reference the removed `ASSET_KEYS.ground` — if `npm run typecheck` fails because `groundTilemap.ts` or `ArenaScene.ts` still reference `ASSET_KEYS.ground`, that's expected until Task 3; note it and continue).

- [ ] **Step 7: Commit**

```bash
git add public/assets/tiles/grass.png public/assets/tiles/water.png src/visual/assetRegistry.ts src/visual/assetRegistry.test.ts src/visual/placeholderTextures.ts
git commit -m "feat: load real ground tile textures, add shared IsoConfig"
```

---

## Task 3: Isometric ground rendering

**Files:**
- Modify: `src/visual/groundTilemap.ts`
- Modify: `src/scenes/ArenaScene.ts:47-49,57` (`preload()`/`create()`)

**Interfaces:**
- Consumes: `toScreen` (Task 1), `ASSET_KEYS.groundGrass`/`ASSET_KEYS.groundWater`, `ISO_CONFIG` (Task 2).
- Produces: `createGroundTilemap(scene: Phaser.Scene, bounds: AABB, config: IsoConfig): void` (same name, new signature — drops the `tileSize: number` param since tile size now lives inside `IsoConfig.tileWorldSize`).

- [ ] **Step 1: Rewrite `groundTilemap.ts`** to place real tile images at projected screen positions instead of using `scene.make.tilemap`

```ts
// src/visual/groundTilemap.ts
import type Phaser from 'phaser';
import type { AABB, Vec2 } from '../combat/types';
import { ASSET_KEYS } from './assetRegistry';
import { toScreen, type IsoConfig } from './isometricProjection';

const GROUND_DEPTH_BASE = -100000;

export function createGroundTilemap(scene: Phaser.Scene, bounds: AABB, config: IsoConfig): void {
  const widthInTiles = Math.ceil(bounds.width / config.tileWorldSize);
  const heightInTiles = Math.ceil(bounds.height / config.tileWorldSize);
  const tileDisplaySize = config.halfWidth * 2;

  for (let row = 0; row < heightInTiles; row++) {
    for (let col = 0; col < widthInTiles; col++) {
      const onEdge = row === 0 || row === heightInTiles - 1 || col === 0 || col === widthInTiles - 1;
      const textureKey = onEdge ? ASSET_KEYS.groundWater : ASSET_KEYS.groundGrass;

      const worldPos: Vec2 = {
        x: bounds.x + col * config.tileWorldSize,
        y: bounds.y + row * config.tileWorldSize,
      };
      const screenPos = toScreen(worldPos, config);

      const tile = scene.add.image(screenPos.x, screenPos.y, textureKey);
      tile.setDisplaySize(tileDisplaySize, tileDisplaySize);
      tile.setDepth(GROUND_DEPTH_BASE + row + col);
    }
  }
}
```

- [ ] **Step 2: Update `ArenaScene.ts` to load the real textures and call the new signature**

In `preload()` (`src/scenes/ArenaScene.ts:47-49`), add the two `load.image` calls before/alongside `generatePlaceholderTextures`:

```ts
preload(): void {
  this.load.image(ASSET_KEYS.groundGrass, '/assets/tiles/grass.png');
  this.load.image(ASSET_KEYS.groundWater, '/assets/tiles/water.png');
  generatePlaceholderTextures(this);
}
```

Update the import line (`src/scenes/ArenaScene.ts:9`) to pull `ISO_CONFIG` alongside the existing exports:

```ts
import { generatePlaceholderTextures, GROUND_TILE_SIZE, ENTITY_SIZE, ISO_CONFIG } from '../visual/placeholderTextures';
```

Update the `createGroundTilemap` call (`src/scenes/ArenaScene.ts:57`):

```ts
createGroundTilemap(this, ARENA_BOUNDS, ISO_CONFIG);
```

(`GROUND_TILE_SIZE` stays imported — it's still used as `ISO_CONFIG.tileWorldSize`'s source value and may be referenced elsewhere in the file; do not remove the import if the file still uses it after this change. If unused after this task's edits, remove it from the import list — check with `npm run typecheck`.)

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open the arena in a browser.
Expected: the flat gray floor is gone; a diamond-shaped isometric floor renders instead, grass in the interior, a water border tile ring around the edge, no visible gaps between tiles. Player/Assaltante still render as flat colored squares positioned somewhere on/near the floor (their own projection lands in Task 4 — it's fine if they look misaligned with the ground until then).

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS (no test exercises `groundTilemap.ts`'s Phaser-dependent rendering directly, per the project's established Vitest/Phaser-canvas exception — see spec section 6).

- [ ] **Step 5: Commit**

```bash
git add src/visual/groundTilemap.ts src/scenes/ArenaScene.ts
git commit -m "feat: render arena ground as a real isometric tile grid"
```

---

## Task 4: Project entity positions and depth

**Files:**
- Modify: `src/visual/directionalSprite.ts`
- Modify: `src/scenes/ArenaScene.ts:59-60` (`create()`)

**Interfaces:**
- Consumes: `toScreen`, `screenDepth` (Task 1), `ISO_CONFIG` (Task 2).
- Produces: `DirectionalSprite` constructor gains a required `config: IsoConfig` parameter (last positional argument); `syncPosition`/`syncDirection`/`setTint` signatures unchanged.

- [ ] **Step 1: Update `directionalSprite.ts`**

```ts
// src/visual/directionalSprite.ts
import type Phaser from 'phaser';
import type { Vec2 } from '../combat/types';
import { ASSET_KEYS } from './assetRegistry';
import { toScreen, screenDepth, type IsoConfig } from './isometricProjection';

export class DirectionalSprite {
  private readonly container: Phaser.GameObjects.Container;
  private readonly base: Phaser.GameObjects.Image;
  private readonly arrow: Phaser.GameObjects.Image;
  private readonly config: IsoConfig;

  constructor(
    scene: Phaser.Scene,
    baseTextureKey: string,
    width: number,
    height: number,
    initialPosition: Vec2,
    config: IsoConfig,
  ) {
    this.config = config;
    this.base = scene.add.image(width / 2, height / 2, baseTextureKey).setOrigin(0.5, 0.5);
    this.arrow = scene.add
      .image(width / 2, height / 2, ASSET_KEYS.directionArrow)
      .setOrigin(0, 0.5);
    const initialScreenPos = toScreen(initialPosition, config);
    this.container = scene.add.container(initialScreenPos.x, initialScreenPos.y, [this.base, this.arrow]);
    this.container.setDepth(screenDepth(initialPosition, config));
  }

  get gameObject(): Phaser.GameObjects.Container {
    return this.container;
  }

  syncPosition(pos: Vec2): void {
    const screenPos = toScreen(pos, this.config);
    this.container.setPosition(screenPos.x, screenPos.y);
    this.container.setDepth(screenDepth(pos, this.config));
  }

  syncDirection(dir: Vec2): void {
    this.arrow.setRotation(Math.atan2(dir.y, dir.x));
  }

  setTint(color: number): void {
    this.base.setTint(color);
  }
}
```

- [ ] **Step 2: Update the two `DirectionalSprite` constructor calls in `ArenaScene.ts`** (`src/scenes/ArenaScene.ts:59-60`)

```ts
this.playerSprite = new DirectionalSprite(this, ASSET_KEYS.player, ENTITY_SIZE, ENTITY_SIZE, { x: 100, y: 300 }, ISO_CONFIG);
this.assaltanteSprite = new DirectionalSprite(this, ASSET_KEYS.assaltante, ENTITY_SIZE, ENTITY_SIZE, { x: 400, y: 300 }, ISO_CONFIG);
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`.
Expected: player and Assaltante blocks now sit visually on top of the isometric floor (no longer offset). Moving the player around the Assaltante (WASD) changes which one draws on top, matching whichever is "further into" the diamond (higher `x+y`).

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/visual/directionalSprite.ts src/scenes/ArenaScene.ts
git commit -m "feat: project entity sprites and depth into isometric screen space"
```

---

## Task 5: Project the debug hitbox overlay

**Files:**
- Modify: `src/scenes/ArenaScene.ts:156-187` (`drawDebugHitboxes`), `src/scenes/ArenaScene.ts:62-65` (arena border rectangle)

**Interfaces:**
- Consumes: `toScreen` (Task 1), `ISO_CONFIG` (Task 2), existing `AABB` getters (`encounter.player.hurtbox()`, `attackHitbox()`, etc. — unchanged).

- [ ] **Step 1: Remove the now-misleading straight-line arena border**

The existing `this.add.rectangle(...).setStrokeStyle(2, 0x444444)` in `create()` (`src/scenes/ArenaScene.ts:62-65`) drew a straight rectangle matching `ARENA_BOUNDS` when the floor was also a straight rectangle. The floor is now a diamond (Task 3's water-tile ring already marks the edge visually), so a straight rectangle around it would look wrong and redundant. Delete these lines:

```ts
    this.add
      .rectangle(ARENA_BOUNDS.x, ARENA_BOUNDS.y, ARENA_BOUNDS.width, ARENA_BOUNDS.height)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x444444);

```

- [ ] **Step 2: Add an `AABB`-to-projected-polygon helper and rewrite `drawDebugHitboxes`**

Add a small private helper method to `ArenaScene` and rewrite the body of `drawDebugHitboxes` (`src/scenes/ArenaScene.ts:156-187`) to project every corner before drawing:

```ts
  private drawDebugHitboxes(): void {
    this.debugGraphics.clear();

    const playerHurtbox = this.encounter.player.hurtbox();
    const assaltanteHurtbox = this.encounter.assaltante.hurtbox();
    this.debugGraphics.lineStyle(1, HURTBOX_COLOR, 0.6);
    this.debugGraphics.strokePoints(this.cornersAsPoints(playerHurtbox), true);
    this.debugGraphics.strokePoints(this.cornersAsPoints(assaltanteHurtbox), true);

    const assaltanteCenter: Vec2 = {
      x: this.encounter.assaltante.position.x + ENTITY_SIZE / 2,
      y: this.encounter.assaltante.position.y + ENTITY_SIZE / 2,
    };
    const rangeScreenCenter = toScreen(assaltanteCenter, ISO_CONFIG);
    this.debugGraphics.lineStyle(1, ATTACK_RANGE_COLOR, 0.6);
    this.debugGraphics.strokeEllipse(
      rangeScreenCenter.x,
      rangeScreenCenter.y,
      ATTACK_RANGE * 2,
      ATTACK_RANGE * (ISO_CONFIG.halfHeight / ISO_CONFIG.halfWidth) * 2,
    );

    this.debugGraphics.fillStyle(ATTACK_HITBOX_COLOR, 0.4);
    const playerAttack = this.encounter.player.attackHitbox();
    if (playerAttack) this.debugGraphics.fillPoints(this.cornersAsPoints(playerAttack), true);
    const assaltanteAttack = this.encounter.assaltante.attackHitbox();
    if (assaltanteAttack) this.debugGraphics.fillPoints(this.cornersAsPoints(assaltanteAttack), true);
  }

  private cornersAsPoints(box: AABB): Phaser.Geom.Point[] {
    const corners: Vec2[] = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ];
    return corners.map((corner) => {
      const screen = toScreen(corner, ISO_CONFIG);
      return new Phaser.Geom.Point(screen.x, screen.y);
    });
  }
```

`cornersAsPoints` returns `Phaser.Geom.Point[]`, which is what `Graphics.strokePoints`/`fillPoints` expect.

Add the `Vec2` and `AABB` type imports to `src/scenes/ArenaScene.ts` if not already present, and import `toScreen` from `../visual/isometricProjection` and `ISO_CONFIG` from `../visual/placeholderTextures` (already imported in Task 3/4).

- [ ] **Step 3: Manual verification**

Run: `npm run dev`.
Expected: white hurtbox outlines and yellow attack-hitbox fills now appear as skewed parallelograms (not axis-aligned rectangles) that stay visually centered on the player/Assaltante blocks as they move. The orange attack-range indicator renders as a flattened ellipse (not a circle) centered on the Assaltante. No arena border rectangle remains — the water-tile ring is the only edge marker.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — no test covers `drawDebugHitboxes` directly (Phaser-canvas exception, same as Tasks 3-4).

- [ ] **Step 5: Commit**

```bash
git add src/scenes/ArenaScene.ts
git commit -m "feat: project debug hitbox overlay into isometric screen space"
```

---

## Task 6: Final regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`
Expected: PASS — every test from this plan (Task 1, Task 2) plus every pre-existing test in `combat/`, `opportunity/`, `ai/`, `profile/`, `core/`, `debug/` (untouched by this plan).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Full manual playtest against the spec's "critério de pronto"**

Run: `npm run dev`, play a short encounter (move around, light-attack, dodge).
Verify, matching `docs/superpowers/specs/2026-08-24-projecao-isometrica-design.md` section 7:
- Ground renders in diamond/isometric shape, grass interior + water border, no gaps.
- Player/Assaltante move over the iso floor with correct y-sort (walking behind vs. in front of the Assaltante changes draw order correctly).
- Debug overlay (hurtbox/hitbox/range) stays visually aligned with the sprites.
- HUD, opportunity overlay, and on-screen controls text still work exactly as before.

- [ ] **Step 4: Commit (only if Step 3 required fixes)**

If manual playtest in Step 3 surfaced no issues, there is nothing to commit — this task is verification-only. If it did surface a small fix, make it, re-run Steps 1-3, then:

```bash
git add -A
git commit -m "fix: address issues found in isometric projection playtest"
```
