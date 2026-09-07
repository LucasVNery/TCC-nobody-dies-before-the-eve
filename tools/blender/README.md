# 3D sprite pipeline

Source: KayKit Adventurers (CC0), https://kaylousberg.itch.io/kaykit-adventurers, free tier v2.0.
Characters: see CHARACTERS.md (Knight = player, Barbarian = Assaltante).
Animation: **KayKit Character Animations** (CC0, https://kaylousberg.itch.io/kaykit-character-animations, free tier v1.1) — NOT the Quaternius Universal Animation Library the design spec assumed. Discovered during execution that the Adventurers pack's own `Animations/fbx/Rig_Medium/` folder already ships `Idle_A` (in `Rig_Medium_General.fbx`) and `Walking_A` (in `Rig_Medium_MovementBasic.fbx`), sharing the exact same `Rig_Medium` armature as the characters — so no retargeting step exists or is needed, just a direct action assignment. This is strictly better than the planned approach (no cross-rig retargeting risk at all). The separately-downloaded 161-animation `KayKit_Character_Animations_1.1.zip` was not ultimately needed for this idle+walk slice but is kept under `tools/blender/source/animations/` for future attack-animation sub-projects, since it covers melee/ranged combat clips on the same rig.
Render: Blender 5.2.1, headless, via a purpose-written script (`render_character.py`) rather than the vendored `dbarton-uk/blender-sprite-render` the design spec named — that tool assumes a single self-contained animated model per input file; this pipeline needed to apply an action from a *separate* animation FBX onto a character FBX first, which the generic tool doesn't support out of the box. Writing a ~150-line purpose-built script was more reliable than forking an external one for this shape of problem.

## Pipeline

1. Download KayKit Adventurers (free tier) and KayKit Character Animations (free tier) from itch.io — both CC0, no login. Extract into `tools/blender/source/kaykit/` and `tools/blender/source/animations/` respectively (both git-ignored).
2. Pick 2 characters from `Characters/fbx/` in the Adventurers pack (see CHARACTERS.md).
3. Render + compose in one pass per entity:
   ```
   BLENDER="C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
   BASE="tools/blender/source/kaykit/KayKit_Adventurers_2.0_FREE"
   "$BLENDER" --background --python tools/blender/render_character.py -- \
     --character "$BASE/Characters/fbx/<Character>.fbx" \
     --idle-fbx "$BASE/Animations/fbx/Rig_Medium/Rig_Medium_General.fbx" \
     --idle-action "Rig_Medium|Idle_A" \
     --walk-fbx "$BASE/Animations/fbx/Rig_Medium/Rig_Medium_MovementBasic.fbx" \
     --walk-action "Rig_Medium|Walking_A" \
     --walk-frames 6 \
     --out-key <player|assaltante>
   ```
   This renders 8 directions (45° apart, orthographic, elevation 26.57° to match the game's 2:1 dimetric ground tiles) × 1 frame (idle, mid-cycle frame 17 of the 33-frame `Idle_A` clip) or 6 frames (walk, evenly sampled across the 33-frame `Walking_A` clip) per direction, then composes each (entity, animation) pair into a single grid PNG: 8 rows (one per direction) × N columns (animation frames), written to `public/assets/characters/<entity>/<idle|walk>.png`. Frame size: 128×128px per cell (both idle.png and walk.png share this — required for Phaser's uniform-grid `load.spritesheet`).

## Direction-row convention (needs empirical confirmation during code integration)

Row index `d` (0-7, top of the sheet = row 0 = direction 7, since the compose step writes rows bottom-up to match Blender's own bottom-to-top pixel buffer origin — see `row_from_bottom` in `render_character.py`) corresponds to a Blender-world camera azimuth of `d * 45°`, camera orbiting counter-clockwise (viewed from above) starting from world +X. **This has not yet been pixel-verified against which screen-space game direction ("east", "south", etc.) each row visually represents** — that calibration is deferred to the code-integration task (`spriteDirection.ts` + the final visual check playing the actual game), per the implementation plan's own Task 4 Step 1 / Task 9. Open `public/assets/characters/player/idle.png` in an image viewer to see all 8 rows side by side when doing that calibration.

## Bugs found and fixed during this pipeline's first run

- **Action not applying per-frame (walk animation looked static across all sampled frames):** Blender 4.4+'s "layered/slotted Action" redesign requires `armature.animation_data.action_slot` to be assigned explicitly, in addition to `.action` — setting `.action` alone silently evaluates the rest pose every frame with no error. Fixed in `render_character.py` by assigning `action.slots[0]`.
- **Action name collision on the 2nd FBX import:** importing a second FBX whose armature is also named `Rig_Medium` makes Blender rename it (and the action's rig-name prefix) to `Rig_Medium.001`, so a literal `"Rig_Medium|Idle_A"` lookup fails. Fixed by matching on the `|Idle_A` suffix instead of the full name.
- **Renders/composed sheet silently not written to disk:** relative output paths passed to `scene.render.filepath` / `image.filepath_raw` did not resolve to the process's actual working directory as expected. Fixed by resolving every output path via `os.path.abspath()` before use.
- **`BLENDER_EEVEE_NEXT` render engine enum doesn't exist in Blender 5.2** (renamed back to `BLENDER_EEVEE`).
- **Near-black silhouettes on back-lit rotation angles** with a single sun lamp — fixed with a 3-light setup (key + fill from the opposite azimuth + top) plus a flat ambient world background strength, so every one of the 8 rotations stays readable.

## Regenerating / extending (e.g. adding attack animations later)

Reuse `render_character.py`'s `render_animation`/`compose_sheet` functions with a different `--idle-action`/`--walk-action` pointing at clips from the already-downloaded `tools/blender/source/animations/KayKit_Character_Animations_1.1/` pack (161 clips, includes melee/ranged combat) once weapon-attack sprite work starts — no new download needed for that.
