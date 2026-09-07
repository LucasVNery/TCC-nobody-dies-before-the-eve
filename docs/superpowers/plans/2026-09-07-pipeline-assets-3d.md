# Pipeline de Assets 3D Pré-renderizados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: this plan is hybrid — Tasks 1-4 are asset-production runbooks requiring direct access to a live Blender install and a live browser session (Claude in Chrome), and are NOT safely delegable to a freshly-dispatched subagent the way pure-code tasks are (a dispatched subagent has no guaranteed continuity with the controlling session's Chrome tab or local Blender state). Tasks 5-9 are ordinary TypeScript/Vitest work and CAN use superpowers:subagent-driven-development if desired. Recommend running Tasks 1-4 inline (superpowers:executing-plans or directly) and deciding on 5-9 separately once 1-4's artifacts exist. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder colored-rectangle sprites for the player and the Assaltante with pre-rendered 3D sprites (KayKit Adventurers, CC0), covering `idle` and `walk` in 8 directions, with no weapon held.

**Architecture:** An external asset pipeline (download → animate → render → compose) produces two grid sprite sheets per entity (`<entity>_idle.png`, `<entity>_walk.png`), consumed by a rewritten `DirectionalSprite` that picks the correct row (of 8, one per direction) and animates through the columns (animation frames) — using a new pure `directionBucket()` function to convert a screen-projected direction vector into a row index. No change to `combat/`, `opportunity/`, `ai/`, `profile/`.

**Tech Stack:** Blender 5.2.1 (headless CLI, already installed and verified this session at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`), Blender's own bundled Python (used for both rendering AND sprite-sheet compositing — no new Pillow/ImageMagick/npm-image-library dependency needed, since Blender's `bpy` API can composite PNGs via pixel-array copy on its own), Claude in Chrome (KayKit download, Quaternius retarget — both confirmed to need no login), Phaser 3's `scene.load.spritesheet` + `Phaser.Animations`, TypeScript/Vitest for the code portion.

**Spec:** `docs/superpowers/specs/2026-09-07-pipeline-assets-3d-design.md`

## Global Constraints

- No change to `combat/`, `opportunity/`, `ai/`, `profile/` — this plan is entirely `visual/`, `scenes/`, and a new `tools/blender/` directory.
- 8 directions, `idle` + `walk` only — no weapon held, no attack animations (deferred, per spec §2.2).
- No new npm runtime dependency and no new build-tool dependency beyond what's already installed (Blender). Sprite-sheet composition uses Blender's own bundled Python, not a separately-installed Pillow/ImageMagick/Node image library.
- The "critério de pronto" (spec §2.3) is NOT Vitest-driven for the asset-production tasks — it's file/shape verification (counts, dimensions, alpha channel) plus a final manual visual check via Claude in Chrome. Only the pure `directionBucket()` logic (Task 5) gets real Vitest TDD.
- KayKit Adventurers (CC0) and Quaternius Universal Animation Library are both free, no-login — confirmed this session. Document the exact pack/version used in `tools/blender/README.md` for TCC attribution, per spec §6.

---

## File Structure

| File | Responsibility |
|---|---|
| `tools/blender/source/kaykit/` (new, git-ignored — raw downloads) | Raw KayKit FBX/GLTF files as downloaded, before animation. |
| `tools/blender/source/animated/` (new, git-ignored) | The 2 chosen characters' FBX files after Quaternius retarget (idle+walk baked in), renamed to `player.fbx` / `assaltante.fbx`. |
| `tools/blender/blender_batch_render.py` (new, vendored from `dbarton-uk/blender-sprite-render`, MIT license — verify and record exact license text in `tools/blender/README.md`) | Headless Blender render script: FBX in, per-direction/per-frame transparent PNGs out. |
| `tools/blender/renders/<entity>/<animation>/` (new, git-ignored) | Individual rendered PNG frames before composition, e.g. `renders/player/idle/dir0_frame0.png`. |
| `tools/blender/compose_sheet.py` (new) | Blender-headless Python script: reads the individual PNGs for one (entity, animation) pair and writes a single grid sprite sheet PNG (8 rows × N columns) using `bpy.data.images` pixel-array copy — no external image library. |
| `tools/blender/README.md` (new) | Exact pack names/versions/URLs used (KayKit Adventurers, Quaternius library), license text, and the full command sequence to regenerate everything — this is what the TCC text and any future re-run point to. |
| `public/assets/characters/player/idle.png`, `.../player/walk.png`, `.../assaltante/idle.png`, `.../assaltante/walk.png` (new, versioned normally) | Final sprite sheets consumed by Phaser. |
| `src/visual/spriteDirection.ts` (new) | Pure `directionBucket(screenDir: Vec2): number` — the only piece of this plan with real Vitest tests. |
| `src/visual/assetRegistry.ts` (edit) | New `ASSET_KEYS` entries for the 4 new sprite sheets. |
| `src/visual/directionalSprite.ts` (edit — full rewrite of the rendering half, same public interface) | Uses `Sprite` + `Phaser.Animations` instead of a static `Image` + rotating arrow; `syncDirection` now also takes an `isMoving` flag to pick `idle` vs `walk`. |
| `src/scenes/ArenaScene.ts` (edit, small) | `preload()` loads the 4 new spritesheets; `update()` passes `isMoving` to `syncDirection`; placeholder-rectangle generation for player/Assaltante removed (ground tiles' placeholder generation, if any, is untouched). |
| `src/visual/placeholderTextures.ts` (edit, small) | `generateRectTexture` calls for `ASSET_KEYS.player`/`ASSET_KEYS.assaltante` removed; `ISO_CONFIG`, `ENTITY_SIZE`, and the arrow-texture generator stay (arrow kept as an optional debug overlay, per spec §3.5). |

---

### Task 1: Download KayKit Adventurers and choose 2 characters

**Files:** none (produces files under `tools/blender/source/kaykit/`, git-ignored).

**Interfaces:**
- Consumes: nothing.
- Produces: `tools/blender/source/kaykit/<CharacterName>.fbx` (or `.gltf`) for the 2 chosen characters, plus a `tools/blender/CHARACTERS.md` recording which 2 of the pack's 5 characters were picked and why (any visual distinction is fine — e.g. different silhouette/color) — consumed by Task 2.

This is a browser-automation runbook, not code — the exact clicks depend on itch.io's live page, which must be inspected live via Claude in Chrome rather than pre-scripted.

- [ ] **Step 1: Load the tools directory scaffold**

```bash
mkdir -p tools/blender/source/kaykit tools/blender/source/animated tools/blender/renders
```

Add to `.gitignore` (create the entries if not already covered by an existing `_unused`-style ignore):
```
tools/blender/source/
tools/blender/renders/
```

- [ ] **Step 2: Download the free KayKit Adventurers pack via Claude in Chrome**

Navigate to `https://kaylousberg.itch.io/kaykit-adventurers`. Use the page's own download flow for the free tier (no login, no payment) to fetch the archive. Extract it — it will contain 5 or more character model files (FBX and/or GLTF) plus prop files (weapons/shields, out of scope — ignore those for this plan). Move the downloaded archive's contents into `tools/blender/source/kaykit/`.

- [ ] **Step 3: Pick 2 characters and record the choice**

Open the extracted files (filenames alone are usually descriptive — e.g. `Knight.fbx`, `Rogue.fbx`) and pick 2 that read as visually distinct at a glance (different silhouette, not just different color, since the sprite sheet is grayscale-tintable via Phaser's existing `setTint`). Rename or reference them clearly. Write `tools/blender/CHARACTERS.md`:

```markdown
# Characters used

- Player: <exact filename>, chosen because <one line — silhouette/read at a glance>
- Assaltante: <exact filename>, chosen because <one line>

Source: KayKit Adventurers, https://kaylousberg.itch.io/kaykit-adventurers, free tier, CC0.
Downloaded: 2026-09-07.
```

- [ ] **Step 4: Verify**

```bash
ls tools/blender/source/kaykit/
```
Expected: at least the 2 chosen character model files present, non-zero size. `tools/blender/CHARACTERS.md` exists and names them.

- [ ] **Step 5: Commit** (the `.gitignore` change and `CHARACTERS.md` — NOT the raw downloaded models, which are git-ignored per Step 1)

```bash
git add .gitignore tools/blender/CHARACTERS.md
git commit -m "chore: pick 2 KayKit Adventurers characters for player/Assaltante sprites"
```

---

### Task 2: Retarget `idle` + `walk` animations via Quaternius Universal Animation Library

**Files:** none (produces files under `tools/blender/source/animated/`, git-ignored).

**Interfaces:**
- Consumes: the 2 character files from Task 1.
- Produces: `tools/blender/source/animated/player.fbx`, `tools/blender/source/animated/assaltante.fbx` — each containing both an `Idle` and a `Walk` animation clip baked onto the KayKit model's skeleton — consumed by Task 3.

Also a browser-automation runbook. Per spec §3.2/§6, test with ONE character all the way through before repeating for the second — if the tool doesn't cleanly support programmatic export (e.g. the download lands in the OS Downloads folder rather than a location Claude in Chrome can name directly), that's expected friction to solve here, not a sign to abandon the approach; move the file with a normal shell command once it lands.

- [ ] **Step 1: Retarget the first character (player)**

Navigate to the Quaternius Universal Animation Library's web retargeting tool (search `quaternius universal animation library` if the exact URL isn't already known from prior research this session). Upload/drop `tools/blender/source/kaykit/<player character file>`. Apply the `Idle` clip, preview it renders correctly on the model, then apply `Walk` similarly. Export/download the result as an animated FBX containing both clips.

- [ ] **Step 2: Move the exported file into place**

```bash
mv <wherever it downloaded to> tools/blender/source/animated/player.fbx
```

- [ ] **Step 3: Repeat Step 1-2 for the second character (Assaltante)**, producing `tools/blender/source/animated/assaltante.fbx`.

- [ ] **Step 4: Verify**

```bash
ls -la tools/blender/source/animated/
```
Expected: `player.fbx` and `assaltante.fbx`, both non-zero size. If you have a quick way to confirm animation clips are embedded (e.g. Blender's own FBX import preview, or the retargeting tool's own preview before export), use it — this is worth confirming now, since Task 3's render step is the expensive one to redo if the animation didn't actually bake in.

- [ ] **Step 5: Commit** — nothing to commit (animated FBX files are git-ignored per Task 1's `.gitignore` entry). Skip.

---

### Task 3: Render 8-direction frames via headless Blender

**Files:**
- Create: `tools/blender/blender_batch_render.py` (vendored)
- Create: `tools/blender/README.md`

**Interfaces:**
- Consumes: `tools/blender/source/animated/player.fbx`, `tools/blender/source/animated/assaltante.fbx` (Task 2).
- Produces: `tools/blender/renders/<entity>/<animation>/dir<0-7>_frame<N>.png` (transparent background) for `entity` ∈ `{player, assaltante}`, `animation` ∈ `{idle, walk}` — consumed by Task 4. Direction index 0-7 must correspond to the render tool's own camera-rotation order (whatever it documents/produces) — Task 4/5 do not assume a specific mapping ahead of verifying it against actual output (see Task 4 Step 1).

- [ ] **Step 1: Fetch and inspect the render script**

```bash
git clone --depth 1 https://github.com/dbarton-uk/blender-sprite-render.git /tmp/blender-sprite-render
cp /tmp/blender-sprite-render/blender_batch_render.py tools/blender/blender_batch_render.py
cat /tmp/blender-sprite-render/LICENSE 2>&1 | head -5
```

Read the copied script's `--rotations` handling (search for `rotations` in the file). If it only accepts the literal value `4` (hardcoded, not a generic step count), adjust the copied `tools/blender/blender_batch_render.py` locally to compute the per-frame camera angle as `360 / rotations` degrees generically for any `rotations` value — this is a small, self-contained edit to one function; do not restructure the rest of the script. Record what you found and changed (or didn't need to) in `tools/blender/README.md`'s pipeline section (Step 4 below).

- [ ] **Step 2: Run the render for both entities**

```bash
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tools/blender/blender_batch_render.py -- \
  --input tools/blender/source/animated \
  --output tools/blender/renders \
  --rotations 8
```

If the script requires animation names or frame-range flags not shown in its `--help` output, run `"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tools/blender/blender_batch_render.py -- --help` first and adapt the command accordingly — record the final working command in `tools/blender/README.md`.

- [ ] **Step 3: Verify output shape**

```bash
find tools/blender/renders -name "*.png" | wc -l
```
Expected: for `idle` (1 frame per direction) × 2 entities × 8 directions = 16 files, plus `walk` (aim for ~6 frames per direction, per spec §3.4 — exact count depends on what the retargeted Walk clip's frame range actually samples to at whatever frame-step the render used) × 2 × 8. If the walk frame count differs from ~6, that's fine — record the actual count, it just needs to be consistent per entity.

Spot-check one PNG has an alpha channel (transparent background), e.g. open one in any image viewer or check its color type is RGBA.

- [ ] **Step 4: Write `tools/blender/README.md`**

```markdown
# 3D sprite pipeline

Source: KayKit Adventurers (CC0), https://kaylousberg.itch.io/kaykit-adventurers, free tier.
Characters: see CHARACTERS.md.
Animation: Quaternius Universal Animation Library (free, no login), Idle + Walk clips retargeted per character.
Render: Blender 5.2.1, headless, via blender_batch_render.py (vendored from https://github.com/dbarton-uk/blender-sprite-render, <license found in Step 1>).

## Regenerating

1. Download KayKit Adventurers free tier, extract into tools/blender/source/kaykit/.
2. Retarget Idle + Walk via the Quaternius web tool, export as tools/blender/source/animated/<entity>.fbx.
3. Render: <exact final command from Step 2/adjusted per Step 1's --help findings>
4. Compose: <filled in by Task 4>

## Notes

<whatever you found/changed about --rotations in Step 1, and the actual walk frame count from Step 3>
```

- [ ] **Step 5: Commit**

```bash
git add tools/blender/blender_batch_render.py tools/blender/README.md
git commit -m "feat: add headless Blender batch-render script and pipeline docs"
```

---

### Task 4: Compose rendered frames into sprite sheets

**Files:**
- Create: `tools/blender/compose_sheet.py`
- Modify: `tools/blender/README.md` (fill in the "Compose" step left open in Task 3)

**Interfaces:**
- Consumes: `tools/blender/renders/<entity>/<animation>/dir<N>_frame<M>.png` (Task 3).
- Produces: `public/assets/characters/<entity>/<animation>.png` (a grid: 8 rows, one per direction, columns = animation frame count) for `entity` ∈ `{player, assaltante}`, `animation` ∈ `{idle, walk}` — consumed by Task 6/7. Also finalizes the direction-index-to-row mapping that `src/visual/spriteDirection.ts` (Task 5) must match.

- [ ] **Step 1: Confirm the direction-index convention against real output**

Open `tools/blender/renders/player/idle/dir0_frame0.png` through `dir7_frame0.png` in an image viewer, in order. Confirm (and write down in `tools/blender/README.md`) which real-world direction each index shows — e.g. "dir0 = facing screen-right (east), dir1 = facing down-right (southeast), going clockwise" or whatever the render tool actually produced. This determines the row order in Step 2 and MUST match `directionBucket()`'s convention in Task 5 (that task defines `directionBucket` assuming index 0 = east/`{1,0}`, increasing clockwise as screen-y increases — if the render tool's actual dir0 doesn't match "east," either relabel rows when composing here, or flag the mismatch so Task 5's convention gets adjusted to match reality instead of the other way around).

- [ ] **Step 2: Write `tools/blender/compose_sheet.py`**

```python
# tools/blender/compose_sheet.py
# Run via: blender --background --python tools/blender/compose_sheet.py -- <entity> <animation> <frame_count>
# Composes tools/blender/renders/<entity>/<animation>/dir<0-7>_frame<0..frame_count-1>.png
# into public/assets/characters/<entity>/<animation>.png, an 8-row x frame_count-column grid,
# row order = direction index as confirmed in Task 4 Step 1.

import sys
import os
import bpy

def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:]
    entity, animation, frame_count = argv[0], argv[1], int(argv[2])
    return entity, animation, frame_count

def load_frame(path):
    img = bpy.data.images.load(path)
    img.pixels[:]  # force pixel data to load
    return img

def main():
    entity, animation, frame_count = parse_args()
    render_dir = os.path.join("tools", "blender", "renders", entity, animation)
    out_dir = os.path.join("public", "assets", "characters", entity)
    os.makedirs(out_dir, exist_ok=True)

    first = load_frame(os.path.join(render_dir, "dir0_frame0.png"))
    frame_w, frame_h = first.size[0], first.size[1]
    sheet_w, sheet_h = frame_w * frame_count, frame_h * 8

    sheet = bpy.data.images.new(
        name=f"{entity}_{animation}_sheet",
        width=sheet_w,
        height=sheet_h,
        alpha=True,
    )
    sheet_pixels = [0.0] * (sheet_w * sheet_h * 4)

    for direction in range(8):
        for frame in range(frame_count):
            src_path = os.path.join(render_dir, f"dir{direction}_frame{frame}.png")
            src = bpy.data.images.load(src_path) if not (direction == 0 and frame == 0) else first
            src_pixels = list(src.pixels)
            # Blender images are stored bottom-to-top; the row for this direction
            # occupies rows [direction*frame_h, (direction+1)*frame_h) counted from
            # the BOTTOM of the sheet to match Blender's own pixel origin, which we
            # then flip to top-to-bottom on save via Blender's own PNG writer (default).
            row_from_bottom = 7 - direction
            for y in range(frame_h):
                src_row_start = y * frame_w * 4
                dst_y = row_from_bottom * frame_h + y
                dst_row_start = (dst_y * sheet_w + frame * frame_w) * 4
                sheet_pixels[dst_row_start:dst_row_start + frame_w * 4] = \
                    src_pixels[src_row_start:src_row_start + frame_w * 4]
            if src is not first:
                bpy.data.images.remove(src)

    sheet.pixels[:] = sheet_pixels
    sheet.filepath_raw = os.path.join(out_dir, f"{animation}.png")
    sheet.file_format = 'PNG'
    sheet.save()
    print(f"Wrote {sheet.filepath_raw} ({sheet_w}x{sheet_h}, {frame_count} frames x 8 directions)")

main()
```

- [ ] **Step 3: Run it for all 4 (entity, animation) pairs**

```bash
BLENDER="C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
"$BLENDER" --background --python tools/blender/compose_sheet.py -- player idle 1
"$BLENDER" --background --python tools/blender/compose_sheet.py -- player walk <actual walk frame count from Task 3 Step 3>
"$BLENDER" --background --python tools/blender/compose_sheet.py -- assaltante idle 1
"$BLENDER" --background --python tools/blender/compose_sheet.py -- assaltante walk <actual walk frame count>
```

- [ ] **Step 4: Verify**

```bash
ls -la public/assets/characters/player/ public/assets/characters/assaltante/
```
Expected: `idle.png` and `walk.png` present under both, non-zero size. Open each in an image viewer — 8 visually distinct rows, each row showing the character facing a different direction; confirm no row is blank/black (a blank row usually means a frame path was wrong in Step 2/3).

- [ ] **Step 5: Fill in `tools/blender/README.md`'s "Compose" step** with the exact commands from Step 3 (including the real frame counts, not the placeholder `<...>` above), and the direction-order finding from Step 1.

- [ ] **Step 6: Commit**

```bash
git add tools/blender/compose_sheet.py tools/blender/README.md public/assets/characters/
git commit -m "feat: compose rendered frames into 8-direction sprite sheets for player and Assaltante"
```

---

### Task 5: `visual/spriteDirection.ts` — pure direction-bucketing

**Files:**
- Create: `src/visual/spriteDirection.ts`
- Create: `src/visual/spriteDirection.test.ts`

**Interfaces:**
- Consumes: `Vec2` (`src/combat/types.ts`, already exists).
- Produces: `DIRECTION_COUNT = 8`, `directionBucket(screenDir: Vec2): number` (returns 0-7) — consumed by Task 7 (`DirectionalSprite`).

Convention (must match what Task 4 Step 1 found in the real rendered output — if Task 4 found a different real-world mapping for `dir0`, adjust the doc comment and the test's expected values here to match reality, not the other way around): index 0 = facing screen `{x:1, y:0}` (east/right), index increases going clockwise as seen on screen (screen `y` grows downward), in steps of 45°, so index 2 = screen `{x:0, y:1}` (south/down), index 4 = screen `{x:-1, y:0}` (west/left), index 6 = screen `{x:0, y:-1}` (north/up).

- [ ] **Step 1: Write the failing tests**

```ts
// src/visual/spriteDirection.test.ts
import { describe, it, expect } from 'vitest';
import { directionBucket, DIRECTION_COUNT } from './spriteDirection';

describe('directionBucket', () => {
  it('DIRECTION_COUNT is 8', () => {
    expect(DIRECTION_COUNT).toBe(8);
  });

  it('buckets due east (1,0) as 0', () => {
    expect(directionBucket({ x: 1, y: 0 })).toBe(0);
  });

  it('buckets due south on screen (0,1) as 2', () => {
    expect(directionBucket({ x: 0, y: 1 })).toBe(2);
  });

  it('buckets due west (-1,0) as 4', () => {
    expect(directionBucket({ x: -1, y: 0 })).toBe(4);
  });

  it('buckets due north on screen (0,-1) as 6', () => {
    expect(directionBucket({ x: 0, y: -1 })).toBe(6);
  });

  it('buckets a diagonal (1,1) as 1 (between east and south)', () => {
    expect(directionBucket({ x: 1, y: 1 })).toBe(1);
  });

  it('buckets a diagonal (-1,-1) as 5 (between west and north)', () => {
    expect(directionBucket({ x: -1, y: -1 })).toBe(5);
  });

  it('is insensitive to vector magnitude (does not require normalization)', () => {
    expect(directionBucket({ x: 50, y: 0 })).toBe(0);
    expect(directionBucket({ x: 0.001, y: 0 })).toBe(0);
  });

  it('a vector just past a 45-degree boundary rounds to the nearer bucket', () => {
    // 30 degrees from east (within the 0..45 sector, closer to 0 than to 1)
    const x = Math.cos(Math.PI / 6);
    const y = Math.sin(Math.PI / 6);
    expect(directionBucket({ x, y })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/visual/spriteDirection.test.ts`
Expected: FAIL — `Cannot find module './spriteDirection'`.

- [ ] **Step 3: Implement `src/visual/spriteDirection.ts`**

```ts
// src/visual/spriteDirection.ts
import type { Vec2 } from '../combat/types';

export const DIRECTION_COUNT = 8;

/**
 * Buckets a screen-space direction vector into one of 8 sprite-sheet rows.
 * Index 0 = east ({1,0}), increasing clockwise on screen (y grows downward)
 * in 45-degree steps: 2 = south, 4 = west, 6 = north. Magnitude doesn't
 * matter — only angle. Verified against the actual rendered sprite sheet's
 * row order in tools/blender/README.md; if that ever changes, this
 * convention (and these tests) must be updated to match, not the reverse.
 */
export function directionBucket(screenDir: Vec2): number {
  const angle = Math.atan2(screenDir.y, screenDir.x);
  const sector = Math.round(angle / (Math.PI / 4));
  return ((sector % DIRECTION_COUNT) + DIRECTION_COUNT) % DIRECTION_COUNT;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/visual/spriteDirection.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/visual/spriteDirection.ts src/visual/spriteDirection.test.ts
git commit -m "feat: add directionBucket, a pure 8-way screen-direction bucketer"
```

---

### Task 6: `visual/assetRegistry.ts` — new sprite sheet keys

**Files:**
- Modify: `src/visual/assetRegistry.ts`
- Modify: `src/visual/assetRegistry.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ASSET_KEYS.playerIdle`, `ASSET_KEYS.playerWalk`, `ASSET_KEYS.assaltanteIdle`, `ASSET_KEYS.assaltanteWalk` — consumed by Task 7 (`DirectionalSprite`) and Task 8 (`ArenaScene.preload`).

- [ ] **Step 1: Write the failing test** — replace the existing test's expected array in `src/visual/assetRegistry.test.ts`:

```ts
// src/visual/assetRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { ASSET_KEYS } from './assetRegistry';

describe('ASSET_KEYS', () => {
  it('defines a unique texture key for every visual role', () => {
    const keys = Object.values(ASSET_KEYS);
    expect(keys).toEqual([
      'player_idle',
      'player_walk',
      'assaltante_idle',
      'assaltante_walk',
      'ground_grass',
      'ground_water',
      'placeholder_direction_arrow',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/visual/assetRegistry.test.ts`
Expected: FAIL — actual array still has the old `placeholder_player`/`placeholder_assaltante` keys.

- [ ] **Step 3: Update `src/visual/assetRegistry.ts`**

```ts
export const ASSET_KEYS = {
  playerIdle: 'player_idle',
  playerWalk: 'player_walk',
  assaltanteIdle: 'assaltante_idle',
  assaltanteWalk: 'assaltante_walk',
  groundGrass: 'ground_grass',
  groundWater: 'ground_water',
  directionArrow: 'placeholder_direction_arrow',
} as const;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/visual/assetRegistry.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: errors in `src/visual/placeholderTextures.ts` and `src/scenes/ArenaScene.ts` (both reference the now-removed `ASSET_KEYS.player`/`ASSET_KEYS.assaltante`) — fixed in Tasks 7-8, not this one.

- [ ] **Step 6: Commit**

```bash
git add src/visual/assetRegistry.ts src/visual/assetRegistry.test.ts
git commit -m "refactor!: replace single player/assaltante placeholder keys with idle/walk sprite sheet keys"
```

---

### Task 7: `visual/directionalSprite.ts` — animated, direction-aware rewrite

**Files:**
- Modify: `src/visual/directionalSprite.ts`
- Modify: `src/visual/placeholderTextures.ts`

**Interfaces:**
- Consumes: `directionBucket`/`DIRECTION_COUNT` (Task 5), `ASSET_KEYS.playerIdle`/`playerWalk`/`assaltanteIdle`/`assaltanteWalk` (Task 6).
- Produces: `DirectionalSprite` constructor gains an `idleTextureKey`/`walkTextureKey` pair (replacing the single `baseTextureKey`) and `walkFrameCount: number`; `syncDirection(dir: Vec2, isMoving: boolean): void` (adds the `isMoving` parameter) — consumed by Task 8 (`ArenaScene`).

No Vitest test for this file (same as before this plan — it's Phaser-`Scene`-dependent, matching the pre-existing untested state of this file). Verified via Task 9's visual check instead.

- [ ] **Step 1: Update `src/visual/directionalSprite.ts`**

```ts
import type Phaser from 'phaser';
import type { Vec2 } from '../combat/types';
import { toScreen, screenDepth, type IsoConfig } from './isometricProjection';
import { directionBucket, DIRECTION_COUNT } from './spriteDirection';

export interface DirectionalSpriteTextures {
  idleTextureKey: string;
  walkTextureKey: string;
  walkFrameCount: number;
}

export class DirectionalSprite {
  private readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly config: IsoConfig;
  private readonly textures: DirectionalSpriteTextures;
  private readonly scene: Phaser.Scene;
  private currentAnimKey = '';

  constructor(
    scene: Phaser.Scene,
    textures: DirectionalSpriteTextures,
    width: number,
    height: number,
    initialPosition: Vec2,
    config: IsoConfig,
  ) {
    this.scene = scene;
    this.config = config;
    this.textures = textures;
    this.registerAnimations();

    const centerOffset = toScreen({ x: width / 2, y: height / 2 }, config);
    this.sprite = scene.add.sprite(centerOffset.x, centerOffset.y, textures.idleTextureKey).setOrigin(0.5, 0.5);
    const initialScreenPos = toScreen(initialPosition, config);
    this.container = scene.add.container(initialScreenPos.x, initialScreenPos.y, [this.sprite]);
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

  syncDirection(dir: Vec2, isMoving: boolean): void {
    // toScreen is linear (no additive offset), so projecting a direction
    // vector directly gives the correct on-screen angle.
    const screenDir = toScreen(dir, this.config);
    const row = directionBucket(screenDir);
    const animKey = `${isMoving ? this.textures.walkTextureKey : this.textures.idleTextureKey}_${row}`;
    if (animKey !== this.currentAnimKey) {
      this.sprite.play(animKey);
      this.currentAnimKey = animKey;
    }
  }

  setTint(color: number): void {
    this.sprite.setTint(color);
  }

  private registerAnimations(): void {
    for (let row = 0; row < DIRECTION_COUNT; row++) {
      const idleKey = `${this.textures.idleTextureKey}_${row}`;
      if (!this.scene.anims.exists(idleKey)) {
        this.scene.anims.create({
          key: idleKey,
          frames: this.scene.anims.generateFrameNumbers(this.textures.idleTextureKey, {
            start: row * 1,
            end: row * 1,
          }),
          frameRate: 1,
          repeat: -1,
        });
      }

      const walkKey = `${this.textures.walkTextureKey}_${row}`;
      if (!this.scene.anims.exists(walkKey)) {
        this.scene.anims.create({
          key: walkKey,
          frames: this.scene.anims.generateFrameNumbers(this.textures.walkTextureKey, {
            start: row * this.textures.walkFrameCount,
            end: row * this.textures.walkFrameCount + (this.textures.walkFrameCount - 1),
          }),
          frameRate: 8,
          repeat: -1,
        });
      }
    }
  }
}
```

Note on frame indexing: Phaser's `load.spritesheet` with a fixed `frameWidth`/`frameHeight` indexes frames row-major, left-to-right then top-to-bottom, starting at 0 — so row `r`, column `c` is frame index `r * columnsPerRow + c`. `idle.png` has 1 column (so row `r` = frame `r`); `walk.png` has `walkFrameCount` columns (so row `r` starts at frame `r * walkFrameCount`), matching the sheet layout Task 4 produced.

- [ ] **Step 2: Update `src/visual/placeholderTextures.ts`** — remove the two calls generating player/Assaltante rectangles from `generatePlaceholderTextures`, keep the arrow generator:

```ts
export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  generateArrowTexture(scene, ASSET_KEYS.directionArrow, DIRECTION_ARROW_SIZE, DIRECTION_ARROW_COLOR);
}
```

(Leave `generateRectTexture`, `ENTITY_VISUAL_WIDTH`/`ENTITY_VISUAL_HEIGHT`/`ISO_CONFIG`/`ENTITY_SIZE` and the arrow generator function itself untouched — `generateRectTexture` becomes unused by this file but stays, since nothing in this plan requires removing it and a future placeholder need might reuse it; if `npm run typecheck`/lint flags it as a genuinely unused export, remove it then, not preemptively here.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: errors only in `src/scenes/ArenaScene.ts` (still constructs `DirectionalSprite` with the old constructor signature and calls the old `syncDirection(dir)` with one argument) — fixed in Task 8.

- [ ] **Step 4: Commit**

```bash
git add src/visual/directionalSprite.ts src/visual/placeholderTextures.ts
git commit -m "refactor: DirectionalSprite plays direction-bucketed idle/walk animations instead of a static rect + rotating arrow"
```

---

### Task 8: `scenes/ArenaScene.ts` — wire the new sprite sheets

**Files:**
- Modify: `src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `ASSET_KEYS.playerIdle`/`playerWalk`/`assaltanteIdle`/`assaltanteWalk` (Task 6), `DirectionalSprite`'s new constructor/`syncDirection` signature (Task 7).
- Produces: nothing new downstream — final wiring task.

- [ ] **Step 1: Update `preload()`** — replace the two `generatePlaceholderTextures`-covered rectangle textures with real spritesheet loads. Add near the existing `this.load.image(...)` calls for ground tiles:

```ts
  preload(): void {
    this.load.image(ASSET_KEYS.groundGrass, '/assets/tiles/grass.png');
    this.load.image(ASSET_KEYS.groundWater, '/assets/tiles/water.png');
    this.load.spritesheet(ASSET_KEYS.playerIdle, '/assets/characters/player/idle.png', {
      frameWidth: ENTITY_VISUAL_WIDTH,
      frameHeight: ENTITY_VISUAL_HEIGHT,
    });
    this.load.spritesheet(ASSET_KEYS.playerWalk, '/assets/characters/player/walk.png', {
      frameWidth: ENTITY_VISUAL_WIDTH,
      frameHeight: ENTITY_VISUAL_HEIGHT,
    });
    this.load.spritesheet(ASSET_KEYS.assaltanteIdle, '/assets/characters/assaltante/idle.png', {
      frameWidth: ENTITY_VISUAL_WIDTH,
      frameHeight: ENTITY_VISUAL_HEIGHT,
    });
    this.load.spritesheet(ASSET_KEYS.assaltanteWalk, '/assets/characters/assaltante/walk.png', {
      frameWidth: ENTITY_VISUAL_WIDTH,
      frameHeight: ENTITY_VISUAL_HEIGHT,
    });
    generatePlaceholderTextures(this);
  }
```

**Note for whoever executes this task:** `ENTITY_VISUAL_WIDTH`/`ENTITY_VISUAL_HEIGHT` (20×32, from `placeholderTextures.ts`) were sized for the flat rectangle placeholder. The actual rendered sprite frame dimensions from Task 3/4 are almost certainly different (a pre-rendered 3D character frame is not going to be exactly 20×32px). Before finalizing this step, check the real dimensions of `public/assets/characters/player/idle.png` (e.g. `identify` if ImageMagick is ever available, or any image viewer's properties panel, or just `file public/assets/characters/player/idle.png` for a rough read) divided by (1 column, 8 rows) for `idle.png` and by (`walkFrameCount` columns, 8 rows) for `walk.png`, and use THAT as `frameWidth`/`frameHeight` here — both spritesheets for one entity must share the same per-frame dimensions for this to work, which Task 4's compose script already guarantees (both are built from the same rendered frame size). Update the constant used above accordingly if it doesn't match 20×32 — this is a one-line correction, not a design change.

- [ ] **Step 2: Update `create()`** — replace the two `DirectionalSprite` construction calls:

```ts
    this.playerSprite = new DirectionalSprite(
      this,
      { idleTextureKey: ASSET_KEYS.playerIdle, walkTextureKey: ASSET_KEYS.playerWalk, walkFrameCount: <actual count from Task 3/4> },
      ENTITY_VISUAL_WIDTH,
      ENTITY_VISUAL_HEIGHT,
      { x: 100, y: 300 },
      ISO_CONFIG,
    );
    this.assaltanteSprite = new DirectionalSprite(
      this,
      { idleTextureKey: ASSET_KEYS.assaltanteIdle, walkTextureKey: ASSET_KEYS.assaltanteWalk, walkFrameCount: <actual count from Task 3/4> },
      ENTITY_VISUAL_WIDTH,
      ENTITY_VISUAL_HEIGHT,
      { x: 400, y: 300 },
      ISO_CONFIG,
    );
```

- [ ] **Step 3: Update `update()`** — the two `syncDirection` calls now need an `isMoving` flag. The player's own movement input already exists as `this.lastMoveInput`; the Assaltante's "is it moving" is true whenever its state is `'chasing'` (per `combat/types.ts`'s `EnemyState`):

```ts
    this.playerSprite.syncPosition(playerPos);
    this.playerSprite.syncDirection(
      this.encounter.player.facing,
      this.lastMoveInput.dx !== 0 || this.lastMoveInput.dy !== 0,
    );
    this.playerSprite.setTint(this.encounter.player.isInvulnerable ? 0x8bc34a : 0xffffff);

    this.assaltanteSprite.syncPosition(assaltantePos);
    this.assaltanteSprite.syncDirection(
      this.encounter.assaltante.attackDirection,
      this.encounter.assaltante.state === 'chasing',
    );
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm run typecheck`
Expected: clean, 0 errors.

Run: `npm test`
Expected: same total pass count as before this plan (this task and Task 7 add no new Vitest tests — `ArenaScene`/`DirectionalSprite` remain untested by Vitest, same as their pre-existing state).

- [ ] **Step 5: Commit**

```bash
git add src/scenes/ArenaScene.ts
git commit -m "feat: load and wire the 3D-rendered idle/walk sprite sheets in ArenaScene"
```

---

### Task 9: Visual verification + final full-suite check

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background) and note the local URL it prints.

- [ ] **Step 2: Visual check via Claude in Chrome**

Navigate to the dev server URL. Take a screenshot confirming: the player and Assaltante render as 3D-looking sprites, not flat colored rectangles. Move the player (WASD) in at least 4 distinct directions (e.g. up, down, left, a diagonal) and screenshot each, confirming the sprite's facing visibly changes and roughly matches the movement direction. Let the player sit still for a moment and screenshot, confirming it settles into a distinct idle pose (not stuck mid-walk-cycle).

If any direction looks wrong (e.g. facing the opposite way, or two directions look identical), that almost always means Task 4 Step 1's direction-order finding and Task 5's `directionBucket` convention disagree — go back and reconcile them (adjust whichever is wrong; the render output's real order is authoritative, per Task 5's own doc comment) rather than special-casing it in `ArenaScene`.

- [ ] **Step 3: Full-suite verification**

Run: `npm test`
Expected: PASS, same file/test count as `master` had before this plan started, plus the 9 new `spriteDirection.test.ts` tests and the updated `assetRegistry.test.ts` assertion (still 1 test, new expected values).

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 4: If anything fails**

Re-open the specific task above whose file caused the failure, fix it there, then re-run Steps 2-3.

- [ ] **Step 5: Final commit** (only if Step 4 required changes; otherwise this task produces no diff)

---

## Self-Review Notes

**Spec coverage:**
- §3.1 download → Task 1. §3.2 retarget → Task 2. §3.3 render → Task 3. §3.4 composition → Task 4. §3.5 `DirectionalSprite` rewrite → Task 7.
- §4 file structure → matches this plan's File Structure table exactly (`tools/blender/`, `public/assets/characters/`, the 4 edited/created `src/visual/*` files, `ArenaScene.ts`).
- §5 verification strategy → Task 9 (visual) + each task's own file/shape checks (Tasks 1-4) + Task 5's real Vitest tests + Task 8's typecheck/full-suite.
- §2.3 critério de pronto: item 1 (sprite sheets exist) → Task 4. Item 2 (loads without error) → Task 8 Step 4. Item 3 (visual check) → Task 9. Item 4 (tests/typecheck stay green) → Task 8 Step 4 + Task 9 Step 3.
- §6 risk table → the `--rotations 8` risk is handled in Task 3 Step 1; the Quaternius automation risk is handled by Task 2's "test one character first" framing; the raw-asset-repo-size risk is handled by Task 1's `.gitignore` entries (only final sprite sheets are versioned, per the spec's own §4 resolution).

**Placeholder scan:** the browser-automation tasks (1, 2) and the live-tool-inspection steps (Task 3 Step 1, Task 4 Step 1) are deliberately written as runbooks with explicit goals and verification commands rather than fabricated literal code — genuine interactive/external-tool steps have no pre-existing "correct code" to write ahead of touching the live page/file, unlike the TypeScript tasks (5-8), which do have complete literal code throughout. This is a deliberate deviation from the plan template's usual "always show literal code" rule, scoped only to the parts of this plan that are not source code.

**Type consistency:** `directionBucket`/`DIRECTION_COUNT` (Task 5) match Task 7's import exactly. `ASSET_KEYS.playerIdle`/`playerWalk`/`assaltanteIdle`/`assaltanteWalk` (Task 6) match Task 7's `DirectionalSpriteTextures` usage and Task 8's `preload()`/`create()` calls. `DirectionalSprite`'s constructor and `syncDirection(dir, isMoving)` signatures (Task 7) match exactly what Task 8 calls.

**Known open value:** `walkFrameCount` (used in Tasks 4, 7, 8) is a concrete number only once Task 3's render actually runs — every later task references it as "the actual count from Task 3/4" rather than guessing a number now and risking it being wrong. This is the one deliberately-late-bound value in the plan, and it's load-bearing in exactly 3 places (Task 4's compose command, Task 7's `registerAnimations` frame-count usage — already parameterized via the constructor, no hardcoding needed there — and Task 8's `DirectionalSprite` construction calls) — whoever runs Task 4 should write the real number down in `tools/blender/README.md` (Task 4 Step 5) so Task 8 doesn't have to re-derive it.

---

Plan complete and saved to `docs/superpowers/plans/2026-09-07-pipeline-assets-3d.md`.

**Execution note (per the header):** Tasks 1-4 need direct access to this session's live Blender install and Chrome browser session — they are not good candidates for a freshly-dispatched subagent (no guaranteed continuity of that state). Tasks 5-9 are ordinary code/verification work.

**Which would you like:**

1. **Run Tasks 1-4 inline right now** (I execute them directly in this session, using `superpowers:executing-plans` as the tracking discipline), then decide separately how to run Tasks 5-9 once the real sprite sheets exist.
2. **Something else** — tell me and I'll adjust.
