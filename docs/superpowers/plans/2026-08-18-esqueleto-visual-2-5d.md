# Esqueleto Visual 2.5D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current solid-rectangle rendering in `ArenaScene` with a sprite-based 2.5D visual layer — direction-aware placeholder sprites, y-sort depth, and a tilemap ground — decoupled from combat logic, so real 3D/animated assets can be swapped in later without touching `ArenaScene.ts` again.

**Architecture:** New `src/visual/` module (asset registry, placeholder texture generation, ground tilemap, a `DirectionalSprite` wrapper around a Phaser `Container`) that never imports `combat/`/`opportunity/`/`ai/`. `scenes/ArenaScene.ts` remains the only layer that reads combat state (position, facing direction, enemy state) and calls into `visual/` to draw it — same rule enforced in the two prior sub-projects. Two small getters are added to existing controllers so `ArenaScene` can read direction, mirroring the already-shipped `activeRuleId` getter pattern.

**Tech Stack:** Phaser 3.80, TypeScript (strict), Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-esqueleto-visual-2-5d-design.md`

## Global Constraints

- No real Z-axis: y-sort is draw-order only (`depth = y`), never collision.
- `src/visual/` never imports from `combat/`, `opportunity/`, or `ai/` — only Phaser and its own types (and `Vec2`/`AABB` type-only imports from `combat/types.ts`, which are pure data shapes, not logic).
- `scenes/ArenaScene.ts` is the only layer allowed to read combat/logic state to draw it.
- TypeScript `strict: true`.
- Placeholder textures are generated at runtime via `Phaser.GameObjects.Graphics.generateTexture` — no image files yet. Swapping to real assets later means only editing `src/visual/assetRegistry.ts` and `src/visual/placeholderTextures.ts` (or replacing the latter's loader), never `ArenaScene.ts` or the controllers.
- Phaser-dependent code (anything touching `Phaser.Scene`, canvas/WebGL texture generation, tilemaps, containers) is not unit-testable in Vitest's node environment — validated by `npm run typecheck` plus the manual playtest checklist in Task 6, same exception already documented in the first sub-project's plan (Task 11).

---

## Task 1: Expose `PlayerController.facing`

**Files:**
- Modify: `src/combat/playerController.ts`
- Test: `src/combat/playerController.test.ts`

**Interfaces:**
- Produces: `get facing(): Vec2` on `PlayerController` — returns a defensive copy of the existing private `lastDirection` field (already updated in `step()` whenever `moveInput` is non-zero; defaults to `{ x: 1, y: 0 }`). Consumed by `scenes/ArenaScene.ts` in Task 6 to rotate the player's `DirectionalSprite`.

- [ ] **Step 1: Write the failing test**

Add to `src/combat/playerController.test.ts`, inside the existing `describe('PlayerController', ...)` block (after the last `it(...)`):

```ts
  it('exposes the last movement direction via facing, for visual/HUD purposes', () => {
    const { player } = makePlayer();
    expect(player.facing).toEqual({ x: 1, y: 0 });
    player.setMoveInput(0, 1);
    player.step(16);
    expect(player.facing).toEqual({ x: 0, y: 1 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: FAIL — `player.facing` is `undefined` (property does not exist on `PlayerController`, TypeScript compile error surfaces as a Vitest failure).

- [ ] **Step 3: Add the getter**

In `src/combat/playerController.ts`, add this getter right after the existing `get position(): Vec2 { ... }` (around line 36):

```ts
  get facing(): Vec2 {
    return { x: this.lastDirection.x, y: this.lastDirection.y };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/combat/playerController.test.ts`
Expected: PASS (17 tests — 16 existing + 1 new)

- [ ] **Step 5: Commit**

```bash
git add src/combat/playerController.ts src/combat/playerController.test.ts
git commit -m "feat: expose PlayerController.facing for visual/HUD consumers"
```

---

## Task 2: Expose `AssaltanteController.attackDirection`

**Files:**
- Modify: `src/combat/assaltanteController.ts`
- Test: `src/combat/assaltanteController.test.ts`

**Interfaces:**
- Produces: `get attackDirection(): Vec2` on `AssaltanteController` — returns a defensive copy of the direction the Assaltante last attacked/is attacking toward (renamed internal field `_attackDirection`, same value previously used only inside `attackHitbox()`; defaults to `{ x: -1, y: 0 }`). Consumed by `scenes/ArenaScene.ts` in Task 6 to rotate the Assaltante's `DirectionalSprite`.

- [ ] **Step 1: Write the failing test**

Add to `src/combat/assaltanteController.test.ts`, inside the existing `describe('AssaltanteController', ...)` block (after the last `it(...)`):

```ts
  it('exposes the current attack direction, for visual/HUD purposes', () => {
    const { enemy } = makeAssaltante();
    expect(enemy.attackDirection).toEqual({ x: -1, y: 0 });
    enemy.step(16, { x: 130, y: 0 }); // player to the right, distance 30 -> attacks
    expect(enemy.attackDirection).toEqual({ x: 1, y: 0 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: FAIL — `enemy.attackDirection` is `undefined`.

- [ ] **Step 3: Rename the private field and add the getter**

In `src/combat/assaltanteController.ts`:

1. Rename the private field declaration (around line 22) from:
```ts
  private attackDirection: Vec2 = { x: -1, y: 0 };
```
to:
```ts
  private _attackDirection: Vec2 = { x: -1, y: 0 };
```

2. Update the two internal usages to match: in `attackHitbox()` (around line 49), change `this.attackDirection` to `this._attackDirection`; in `step()` (around line 64), change `this.attackDirection = distanceToPlayer > 0 ? normalizeVelocity(dx, dy) : this.attackDirection;` to `this._attackDirection = distanceToPlayer > 0 ? normalizeVelocity(dx, dy) : this._attackDirection;`.

3. Add a getter right after the existing `get activeRuleId(): string | null { ... }` (around line 40):
```ts
  get attackDirection(): Vec2 {
    return { x: this._attackDirection.x, y: this._attackDirection.y };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/combat/assaltanteController.test.ts`
Expected: PASS (13 tests — 12 existing + 1 new)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm run test && npm run typecheck`
Expected: both succeed — no other file referenced the old private field name.

- [ ] **Step 6: Commit**

```bash
git add src/combat/assaltanteController.ts src/combat/assaltanteController.test.ts
git commit -m "feat: expose AssaltanteController.attackDirection for visual/HUD consumers"
```

---

## Task 3: Asset registry and placeholder texture generation

**Files:**
- Create: `src/visual/assetRegistry.ts`
- Test: `src/visual/assetRegistry.test.ts`
- Create: `src/visual/placeholderTextures.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ASSET_KEYS` (object with `player`, `assaltante`, `ground`, `directionArrow` string keys) and `GROUND_TILE_SIZE: number` (pixel size of one ground tile, `64`), both from `src/visual/assetRegistry.ts` and `src/visual/placeholderTextures.ts` respectively. `generatePlaceholderTextures(scene: Phaser.Scene): void` from `src/visual/placeholderTextures.ts`. Consumed by `src/visual/groundTilemap.ts` (Task 4), `src/visual/directionalSprite.ts` (Task 5), and `scenes/ArenaScene.ts` (Task 6).

- [ ] **Step 1: Write the failing test for the asset registry**

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
      'placeholder_ground_tile',
      'placeholder_direction_arrow',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/visual/assetRegistry.test.ts`
Expected: FAIL — `Cannot find module './assetRegistry'`

- [ ] **Step 3: Create `src/visual/assetRegistry.ts`**

```ts
// src/visual/assetRegistry.ts
export const ASSET_KEYS = {
  player: 'placeholder_player',
  assaltante: 'placeholder_assaltante',
  ground: 'placeholder_ground_tile',
  directionArrow: 'placeholder_direction_arrow',
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/visual/assetRegistry.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Create `src/visual/placeholderTextures.ts`**

This file draws every placeholder texture at runtime via `Phaser.GameObjects.Graphics`. It requires a real `Phaser.Scene` (canvas/WebGL context), so it has no Vitest test — validated by typecheck now and by the manual playtest in Task 6.

```ts
// src/visual/placeholderTextures.ts
import type Phaser from 'phaser';
import { ASSET_KEYS } from './assetRegistry';

export const GROUND_TILE_SIZE = 64;
const ENTITY_SIZE = 20;
const DIRECTION_ARROW_SIZE = 10;

export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  generateSquareTexture(scene, ASSET_KEYS.player, ENTITY_SIZE, 0x4caf50);
  generateSquareTexture(scene, ASSET_KEYS.assaltante, ENTITY_SIZE, 0xf44336);
  generateSquareTexture(scene, ASSET_KEYS.ground, GROUND_TILE_SIZE, 0x2b2b2b);
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

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/visual/assetRegistry.ts src/visual/assetRegistry.test.ts src/visual/placeholderTextures.ts
git commit -m "feat: add visual asset registry and runtime placeholder texture generation"
```

---

## Task 4: Ground tilemap

**Files:**
- Create: `src/visual/groundTilemap.ts`

**Interfaces:**
- Consumes: `ASSET_KEYS.ground` (Task 3), `AABB` (`src/combat/types.ts`, already exists).
- Produces: `createGroundTilemap(scene: Phaser.Scene, bounds: AABB, tileSize: number): Phaser.Tilemaps.TilemapLayer`. Consumed by `scenes/ArenaScene.ts` in Task 6.

No automated test — requires a real `Phaser.Scene`/tilemap runtime, same exception as Task 3's `placeholderTextures.ts`. Validated by typecheck now and the manual playtest in Task 6.

- [ ] **Step 1: Create `src/visual/groundTilemap.ts`**

```ts
// src/visual/groundTilemap.ts
import type Phaser from 'phaser';
import type { AABB } from '../combat/types';
import { ASSET_KEYS } from './assetRegistry';

export function createGroundTilemap(
  scene: Phaser.Scene,
  bounds: AABB,
  tileSize: number,
): Phaser.Tilemaps.TilemapLayer {
  const widthInTiles = Math.ceil(bounds.width / tileSize);
  const heightInTiles = Math.ceil(bounds.height / tileSize);

  const tilemap = scene.make.tilemap({
    tileWidth: tileSize,
    tileHeight: tileSize,
    width: widthInTiles,
    height: heightInTiles,
  });

  const tileset = tilemap.addTilesetImage(ASSET_KEYS.ground, ASSET_KEYS.ground, tileSize, tileSize);
  if (!tileset) {
    throw new Error(`Failed to load tileset for key "${ASSET_KEYS.ground}"`);
  }

  const layer = tilemap.createBlankLayer('ground', tileset, bounds.x, bounds.y);
  if (!layer) {
    throw new Error('Failed to create ground tilemap layer');
  }

  layer.fill(0);
  layer.setDepth(-1);
  return layer;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/visual/groundTilemap.ts
git commit -m "feat: add programmatic ground tilemap for the arena"
```

---

## Task 5: DirectionalSprite

**Files:**
- Create: `src/visual/directionalSprite.ts`

**Interfaces:**
- Consumes: `ASSET_KEYS.directionArrow` (Task 3), `Vec2` (`src/combat/types.ts`, already exists).
- Produces: `class DirectionalSprite` with constructor `(scene: Phaser.Scene, baseTextureKey: string, width: number, height: number, initialPosition: Vec2)`, and methods `syncPosition(pos: Vec2): void`, `syncDirection(dir: Vec2): void`, `setTint(color: number): void`, and a `get gameObject(): Phaser.GameObjects.Container` (the underlying container, exposed so `scenes/ArenaScene.ts` can pass it to `camera.startFollow()`). Consumed by `scenes/ArenaScene.ts` in Task 6.

No automated test — requires a real `Phaser.Scene` (image/container creation), same exception as Tasks 3 and 4. Validated by typecheck now and the manual playtest in Task 6.

- [ ] **Step 1: Create `src/visual/directionalSprite.ts`**

```ts
// src/visual/directionalSprite.ts
import type Phaser from 'phaser';
import type { Vec2 } from '../combat/types';
import { ASSET_KEYS } from './assetRegistry';

export class DirectionalSprite {
  private readonly container: Phaser.GameObjects.Container;
  private readonly base: Phaser.GameObjects.Image;
  private readonly arrow: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    baseTextureKey: string,
    width: number,
    height: number,
    initialPosition: Vec2,
  ) {
    this.base = scene.add.image(width / 2, height / 2, baseTextureKey).setOrigin(0.5, 0.5);
    this.arrow = scene.add
      .image(width / 2, height / 2, ASSET_KEYS.directionArrow)
      .setOrigin(0, 0.5);
    this.container = scene.add.container(initialPosition.x, initialPosition.y, [this.base, this.arrow]);
  }

  get gameObject(): Phaser.GameObjects.Container {
    return this.container;
  }

  syncPosition(pos: Vec2): void {
    this.container.setPosition(pos.x, pos.y);
    this.container.setDepth(pos.y);
  }

  syncDirection(dir: Vec2): void {
    this.arrow.setRotation(Math.atan2(dir.y, dir.x));
  }

  setTint(color: number): void {
    this.base.setTint(color);
  }
}
```

The base image and arrow are both positioned at the entity's local center `(width/2, height/2)`; the container's `x, y` (set via `syncPosition`) is the entity's top-left corner, matching how `combat/` already represents position (AABB top-left) — the same convention the current `Rectangle`-based rendering uses (`setOrigin(0, 0)` + `setPosition` to the top-left). The arrow's origin `(0, 0.5)` puts its rotation pivot at the entity center, so `syncDirection` makes it behave like a clock hand pointing outward in the facing direction.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/visual/directionalSprite.ts
git commit -m "feat: add DirectionalSprite — container-based placeholder with direction indicator"
```

---

## Task 6: Wire the visual layer into ArenaScene

**Files:**
- Modify: `src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `PlayerController.facing` (Task 1), `AssaltanteController.attackDirection` (Task 2), `ASSET_KEYS`, `generatePlaceholderTextures`, `GROUND_TILE_SIZE` (Task 3), `createGroundTilemap` (Task 4), `DirectionalSprite` (Task 5).
- Produces: the final running scene for this sub-project — no further tasks consume its output. Validated by the full test suite, typecheck, build, and a manual playtest against the spec's "critério de pronto" (§7 of the spec).

- [ ] **Step 1: Add imports**

In `src/scenes/ArenaScene.ts`, replace the existing import block (lines 1-7) with:

```ts
// src/scenes/ArenaScene.ts
import Phaser from 'phaser';
import { Encounter } from '../combat/encounter';
import { OpportunityOverlay } from '../debug/opportunityOverlay';
import { HudState, type HudCounters } from '../debug/hudState';
import { createFixedTimestepLoop } from '../core/fixedTimestepLoop';
import { ARENA_BOUNDS } from '../combat/movementDefs';
import { ASSET_KEYS } from '../visual/assetRegistry';
import { generatePlaceholderTextures, GROUND_TILE_SIZE } from '../visual/placeholderTextures';
import { createGroundTilemap } from '../visual/groundTilemap';
import { DirectionalSprite } from '../visual/directionalSprite';
```

- [ ] **Step 2: Replace the rectangle fields with sprite fields**

Replace:
```ts
  private playerRect!: Phaser.GameObjects.Rectangle;
  private assaltanteRect!: Phaser.GameObjects.Rectangle;
```
with:
```ts
  private playerSprite!: DirectionalSprite;
  private assaltanteSprite!: DirectionalSprite;
```

- [ ] **Step 3: Add `preload()` to generate placeholder textures**

Add this method right before `create(): void {` :

```ts
  preload(): void {
    generatePlaceholderTextures(this);
  }
```

- [ ] **Step 4: Build the ground tilemap and sprites in `create()`**

Replace these two lines:
```ts
    this.playerRect = this.add.rectangle(100, 300, 20, 20, 0x4caf50).setOrigin(0, 0);
    this.assaltanteRect = this.add.rectangle(400, 300, 20, 20, 0xf44336).setOrigin(0, 0);
```
with:
```ts
    createGroundTilemap(this, ARENA_BOUNDS, GROUND_TILE_SIZE);

    this.playerSprite = new DirectionalSprite(this, ASSET_KEYS.player, 20, 20, { x: 100, y: 300 });
    this.assaltanteSprite = new DirectionalSprite(this, ASSET_KEYS.assaltante, 20, 20, { x: 400, y: 300 });
```

- [ ] **Step 5: Point the camera at the player sprite's game object**

Replace:
```ts
    this.cameras.main.startFollow(this.playerRect);
```
with:
```ts
    this.cameras.main.startFollow(this.playerSprite.gameObject);
```

- [ ] **Step 6: Sync sprites instead of rectangles in `update()`**

Replace:
```ts
    const playerPos = this.encounter.player.position;
    const assaltantePos = this.encounter.assaltante.position;
    this.playerRect.setPosition(playerPos.x, playerPos.y);
    this.assaltanteRect.setPosition(assaltantePos.x, assaltantePos.y);

    this.playerRect.setFillStyle(this.encounter.player.isInvulnerable ? 0x8bc34a : 0x4caf50);
    this.assaltanteRect.setFillStyle(
      this.encounter.assaltante.state === 'attacking' ? 0xff9800 : 0xf44336,
    );
```
with:
```ts
    const playerPos = this.encounter.player.position;
    const assaltantePos = this.encounter.assaltante.position;

    this.playerSprite.syncPosition(playerPos);
    this.playerSprite.syncDirection(this.encounter.player.facing);
    this.playerSprite.setTint(this.encounter.player.isInvulnerable ? 0x8bc34a : 0xffffff);

    this.assaltanteSprite.syncPosition(assaltantePos);
    this.assaltanteSprite.syncDirection(this.encounter.assaltante.attackDirection);
    this.assaltanteSprite.setTint(
      this.encounter.assaltante.state === 'attacking' ? 0xff9800 : 0xffffff,
    );
```

`setTint(0xffffff)` (white) applies no color shift, so the base placeholder texture's own color (green for the player, red for the Assaltante) shows through — matching the original rectangle colors exactly. The player's i-frame tint (`0x8bc34a`) and the Assaltante's attacking tint (`0xff9800`) are unchanged from the current behavior.

- [ ] **Step 7: Run the full automated test suite**

Run: `npm run test`
Expected: PASS — all tests pass, including the two new getter tests from Tasks 1-2 (no test in this task touches `ArenaScene.ts` directly, since it's Phaser-runtime code).

- [ ] **Step 8: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 9: Manual playtest**

Run: `npm run dev`, open the printed local URL in a browser.

Verify, per the spec's "critério de pronto" (§7):
- A tiled ground fills the arena where the background used to be empty, up to the `ARENA_BOUNDS` edges (visible as you move the camera by moving the player near an edge).
- The player and the Assaltante render as a colored square with a small white arrow, not a solid rectangle.
- Moving the player (WASD) rotates its arrow to match the movement direction; the Assaltante's arrow points toward the player once it starts attacking.
- Walk the player around the Assaltante in a circle: whichever one has the lower Y value on screen draws on top of the other (y-sort), and this flips correctly as they cross.
- The HUD text (bottom-left: move/dash/boss counters) and the opportunity overlay (top-left) and controls text (top-right) still render and update correctly on top of everything else.
- The player still tints light green during dash i-frames; the Assaltante still tints orange while attacking.

- [ ] **Step 10: Commit**

```bash
git add src/scenes/ArenaScene.ts
git commit -m "feat: wire ground tilemap and direction-aware sprites into ArenaScene"
```

---

## Self-Review Notes

- **Spec coverage:** y-sort via `depth = y` (Task 5's `syncPosition`, spec §2/§4 `directionalSprite.ts`), direction-aware placeholder sprites (Tasks 1, 2, 5, 6), ground tilemap (Task 4, wired in Task 6), central asset registry (Task 3), controller getters mirroring the `activeRuleId` pattern (Tasks 1-2), HUD/overlay untouched (Task 6 Step 6 only touches sprite/tilemap code), manual playtest matching the spec's "critério de pronto" (Task 6 Step 9).
- **Not covered by design, correctly deferred:** real 3D/pre-rendered assets, animations, lighting/shadows/particles, real tilesets, multiple rooms — all explicitly out of scope per the spec's §1 and §8.
- **Type consistency:** `Vec2` (from `combat/types.ts`, unchanged) is the type used consistently across `facing`, `attackDirection`, `DirectionalSprite.syncPosition`/`syncDirection`. `ASSET_KEYS` object shape defined once in Task 3 and reused verbatim in Tasks 4, 5, 6. `DirectionalSprite`'s public method names (`syncPosition`, `syncDirection`, `setTint`, `gameObject`) are consistent from their Task 5 definition through Task 6's usage.
