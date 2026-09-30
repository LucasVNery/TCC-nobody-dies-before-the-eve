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

## Direction-row convention (calibrated 2026-09-07, wrong three times, root-caused 2026-09-13)

**`image_row_from_top(render_direction) == render_direction`, directly — no flip.** Row index `d` (0-7, top of the sheet = row 0 = render direction 0) corresponds to a Blender-world camera azimuth of `d * 45°`, camera orbiting counter-clockwise (viewed from above) starting from world +X.

This directness is *not* obvious from a first read of `compose_sheet()`: it computes `row_from_bottom = (DIRECTIONS-1) - direction` and writes each direction's frame at that row-block. But `row_from_bottom` is a count of rows **up from the bottom of the final saved PNG** (Blender's `image.pixels` array is bottom-up — pixel-array row 0 always lands at the bottom of whatever gets saved to disk), and converting a "from bottom" count to a normal "from top" row index requires a *second* `(DIRECTIONS-1) - row_from_bottom` flip — which exactly cancels the first one: `(D-1) - ((D-1)-d) == d`. The two flips are real, they're just inverses of each other, so the net effect on `render_character.py`'s own output is no reversal at all.

`src/visual/directionalSprite.ts`'s `spriteRowForDirection()` used to apply only the *second* flip (as `DIRECTION_COUNT-1-rotated`) without realizing the first one had already happened inside `compose_sheet()` — so it was reversing an already-correct order. `ROW_ROTATION_OFFSET = 4` (was `6` until 2026-09-12, briefly `7` for about a day) plus that reversal removed (fixed 2026-09-13) makes `directionBucket`'s screen-space "south" (`{0,1}`) show the character's front (render direction 6 → row 6), "north" (`{0,-1}`) the back (render direction 2 → row 2), "east" (`{1,0}`) the character facing screen-right (render direction 4 → row 4), and "west" (`{-1,0}`) facing screen-left (render direction 0 → row 0).

**Three wrong states before this, in order:**
1. `6`, with the reversal (2026-09-07): calibrated against the T-pose render bug (both idle and walk showed a static bind pose — see the "Mannequin ghost mesh" entry below). A T-pose has almost no visual difference between front and front+45°, so an off-by-one error looked "plausible" at the time.
2. `7`, with the reversal (2026-09-12, lasted about a day): recalibrated right after fixing the T-pose bug, by eyeballing which *row of the composited sheet* looked like an unambiguous back view and counting rows — landed on a value that happened to keep front/back looking approximately right (the reversal preserves any single antipodal pair's own symmetry) while silently swapping which pair of rows lines up with which screen axis, inverting left/right. This is exactly the bug report that triggered the next fix: "mouse on the left, character looks right."
3. **Root-caused 2026-09-13, reversal removed entirely:** the fix isn't a third offset value — no offset can fix a `DIRECTION_COUNT-1-X` reversal that shouldn't be there in the first place. Confirmed two ways: (a) re-deriving `compose_sheet()`'s actual row math by hand, as above; (b) 512px renders of the 4 cardinal render directions, inspected directly (not through the composited sheet), showing unambiguously that render direction 0 = facing screen-left, 4 = screen-right, 2 = back, 6 = front — and the composited `idle.png`'s own row 2 (independently, visually identified as the unambiguous back view — bare cape, zero face) matching render direction 2's row exactly confirmed no flip exists between them.

**Lesson, three times learned:** a `DIRECTION_COUNT-1-X` reversal (or any change to this formula) that only gets checked against front/back will pass review even when broken, because reversing an antipodal pair preserves its own internal symmetry — the axis that actually catches a reversal bug is left/right (or any non-antipodal relationship, like a diagonal bucket). When touching this code again, verify against a **profile** view (screen-left vs. screen-right), not just front/back, and re-derive the compose script's row math from the code rather than trusting an inherited comment about it.

## Bugs found and fixed during this pipeline's first run

- **Action not applying per-frame (walk animation looked static across all sampled frames):** Blender 4.4+'s "layered/slotted Action" redesign requires `armature.animation_data.action_slot` to be assigned explicitly, in addition to `.action` — setting `.action` alone silently evaluates the rest pose every frame with no error. Fixed in `render_character.py` by assigning `action.slots[0]`.
- **Action name collision on the 2nd FBX import:** importing a second FBX whose armature is also named `Rig_Medium` makes Blender rename it (and the action's rig-name prefix) to `Rig_Medium.001`, so a literal `"Rig_Medium|Idle_A"` lookup fails. Fixed by matching on the `|Idle_A` suffix instead of the full name.
- **Renders/composed sheet silently not written to disk:** relative output paths passed to `scene.render.filepath` / `image.filepath_raw` did not resolve to the process's actual working directory as expected. Fixed by resolving every output path via `os.path.abspath()` before use.
- **`BLENDER_EEVEE_NEXT` render engine enum doesn't exist in Blender 5.2** (renamed back to `BLENDER_EEVEE`).
- **Near-black silhouettes on back-lit rotation angles** with a single sun lamp — fixed with a 3-light setup (key + fill from the opposite azimuth + top) plus a flat ambient world background strength, so every one of the 8 rotations stays readable.

## Bug found post-merge (2026-09-12): a second, T-posed "Mannequin" mesh was rendering on top of the character

The committed `idle.png`/`walk.png` for both entities turned out to show the character frozen in a **T-pose in every single frame** — including the "walk" sheet, whose 6 columns per row were all identical. Root cause: the animation-only FBX (e.g. `Rig_Medium_MovementBasic.fbx`) ships its **own bundled reference mesh** (`Mannequin_*`, KayKit's generic preview body) skinned to its **own second armature object** — Blender renames it to `Rig_Medium.001` on import since the name `Rig_Medium` is already taken by the character's armature. `render_animation()` only ever assigns the action to the *character's* armature (`Rig_Medium`), so that mesh does animate correctly (verified by reading `pose.bones[...].rotation_quaternion` across frames — it changes as expected). But the Mannequin's armature never gets an action, stays in its rest pose (a literal T-pose) forever, and both meshes were `visible_get() == True` and rendered in the same frame, overlapping — so every rendered image showed the real, correctly-posed character with a static T-posed mannequin stuck on top of it.

The `action.slots[0]` fix documented above (Blender 4.4+ layered actions) is real and necessary but was never the whole story — it fixed the character's own pose evaluation, while this separate, unrelated bug was what actually made every rendered frame look broken. Both bugs were hiding behind the same symptom ("looks like a static/T-pose render"), which made this one easy to miss without ever assigning the slot at all.

**Fixed** in `render_animation()`: right after the animation FBX import (and locating the action), delete every object that isn't the character's armature and every mesh not skinned to it (checked via each mesh's `ARMATURE` modifier target) — before any rendering happens. Re-verified by rendering both `player` and `assaltante` end to end: the walk sheets now show a genuine 6-frame walk cycle (arms/legs swinging) and idle shows a normal standing pose, no ghost mesh, no duplicate models.

**If re-rendering ever shows a static/doubled character again:** print `bpy.data.objects` right after the animation FBX import and check for an unexpected second mesh+armature pair (any animation-only FBX from this same KayKit pack likely bundles one) — don't assume it's the slot-assignment bug again without checking object count first.

## Regenerating / extending (e.g. adding attack animations later)

Reuse `render_character.py`'s `render_animation`/`compose_sheet` functions with a different `--idle-action`/`--walk-action` pointing at clips from the already-downloaded `tools/blender/source/animations/KayKit_Character_Animations_1.1/` pack (161 clips, includes melee/ranged combat) once weapon-attack sprite work starts — no new download needed for that.
