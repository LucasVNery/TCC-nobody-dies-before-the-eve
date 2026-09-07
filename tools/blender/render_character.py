"""
Render a KayKit character in 8 isometric directions for idle and walk,
and compose the results into two grid sprite sheets.

Usage:
  blender --background --python tools/blender/render_character.py -- \
    --character tools/blender/source/kaykit/.../Characters/fbx/Knight.fbx \
    --idle-fbx tools/blender/source/kaykit/.../Animations/fbx/Rig_Medium/Rig_Medium_General.fbx \
    --idle-action "Rig_Medium|Idle_A" \
    --walk-fbx tools/blender/source/kaykit/.../Animations/fbx/Rig_Medium/Rig_Medium_MovementBasic.fbx \
    --walk-action "Rig_Medium|Walking_A" \
    --walk-frames 6 \
    --out-key player
"""
import sys
import os
import math
import bpy
import mathutils

DIRECTIONS = 8
FRAME_SIZE = 128  # render resolution per frame, square, cropped later if needed
ELEVATION_DEG = 26.57  # matches the game's 2:1 dimetric ground tile projection


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:]
    args = {}
    i = 0
    while i < len(argv):
        key = argv[i].lstrip("-")
        args[key] = argv[i + 1]
        i += 2
    return args


def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    bpy.ops.import_scene.fbx(filepath=path)


def find_armature():
    for obj in bpy.data.objects:
        if obj.type == 'ARMATURE':
            return obj
    raise RuntimeError("no armature found after import")


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.film_transparent = True
    scene.render.resolution_x = FRAME_SIZE
    scene.render.resolution_y = FRAME_SIZE
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'


def setup_lighting():
    # Key + fill (opposite azimuth) so no rotation angle ends up a near-black
    # silhouette, plus flat ambient world light for a readable "icon" look
    # rather than dramatic single-source shading.
    key_data = bpy.data.lights.new(name="key", type='SUN')
    key_data.energy = 3.5
    key_obj = bpy.data.objects.new(name="key", object_data=key_data)
    bpy.context.collection.objects.link(key_obj)
    key_obj.rotation_euler = (math.radians(55), 0, math.radians(35))

    fill_data = bpy.data.lights.new(name="fill", type='SUN')
    fill_data.energy = 2.0
    fill_obj = bpy.data.objects.new(name="fill", object_data=fill_data)
    bpy.context.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(55), 0, math.radians(35 + 180))

    top_data = bpy.data.lights.new(name="top", type='SUN')
    top_data.energy = 1.5
    top_obj = bpy.data.objects.new(name="top", object_data=top_data)
    bpy.context.collection.objects.link(top_obj)
    top_obj.rotation_euler = (0, 0, 0)

    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (1, 1, 1, 1)
        bg.inputs[1].default_value = 0.6


def setup_camera(target_center, distance):
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = distance
    cam_obj = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj
    return cam_obj


def position_camera(cam_obj, target_center, azimuth_deg, elevation_deg, distance):
    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    x = target_center[0] + distance * math.cos(el) * math.cos(az)
    y = target_center[1] + distance * math.cos(el) * math.sin(az)
    z = target_center[2] + distance * math.sin(el)
    cam_obj.location = (x, y, z)
    direction = (target_center[0] - x, target_center[1] - y, target_center[2] - z)
    # Point camera at target: build a rotation via track-to
    cam_obj.rotation_mode = 'QUATERNION'
    import mathutils
    dir_vec = mathutils.Vector(direction)
    cam_obj.rotation_quaternion = dir_vec.to_track_quat('-Z', 'Y')


def bounding_center_and_radius(armature_obj):
    min_co = [math.inf, math.inf, math.inf]
    max_co = [-math.inf, -math.inf, -math.inf]
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                min_co[i] = min(min_co[i], world[i])
                max_co[i] = max(max_co[i], world[i])
    center = [(min_co[i] + max_co[i]) / 2 for i in range(3)]
    radius = max(max_co[i] - min_co[i] for i in range(3)) / 2
    return center, max(radius, 0.1)


def render_direction_frame(cam_obj, out_path):
    bpy.context.scene.render.filepath = os.path.abspath(out_path)
    bpy.ops.render.render(write_still=True)


def render_animation(character_fbx, anim_fbx, action_name, frame_numbers, out_dir, entity, anim_name):
    os.makedirs(os.path.abspath(out_dir), exist_ok=True)

    clean_scene()
    import_fbx(character_fbx)
    armature = find_armature()

    import_fbx(anim_fbx)
    # Blender suffixes the armature (and thus the action name's rig prefix,
    # e.g. "Rig_Medium.001|Idle_A") when a second FBX import collides with an
    # existing datablock name — match on the suffix after "|" instead of the
    # full name, since that part is stable across imports.
    wanted_suffix = "|" + action_name.split("|", 1)[-1]
    action = next((a for a in bpy.data.actions if a.name.endswith(wanted_suffix)), None)
    if action is None:
        available = [a.name for a in bpy.data.actions]
        raise RuntimeError(f"no action ending in {wanted_suffix!r}; available: {available}")

    if armature.animation_data is None:
        armature.animation_data_create()
    # FBX import sometimes leaves an NLA track around, which can take
    # priority over a directly-assigned .action during evaluation — clear
    # any tracks so the action we set is unambiguously what plays.
    for track in list(armature.animation_data.nla_tracks):
        armature.animation_data.nla_tracks.remove(track)
    armature.animation_data.action = action
    # Blender 4.4+'s layered/slotted Action system requires the slot to be
    # assigned explicitly too — setting .action alone leaves evaluation
    # unbound (silently renders the rest pose every frame, no error raised).
    if action.slots:
        armature.animation_data.action_slot = action.slots[0]

    center, radius = bounding_center_and_radius(armature)
    distance = radius * 3
    setup_render()
    setup_lighting()
    cam_obj = setup_camera(center, radius * 2.2)

    for direction in range(DIRECTIONS):
        azimuth = direction * (360.0 / DIRECTIONS)
        position_camera(cam_obj, center, azimuth, ELEVATION_DEG, distance)
        for i, frame in enumerate(frame_numbers):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            out_path = os.path.join(out_dir, f"dir{direction}_frame{i}.png")
            render_direction_frame(cam_obj, out_path)
            print(f"rendered {entity}/{anim_name} dir{direction} frame{i} (source frame {frame}) -> {out_path}")


def compose_sheet(render_dir, out_path, frame_count):
    render_dir = os.path.abspath(render_dir)
    first = bpy.data.images.load(os.path.join(render_dir, "dir0_frame0.png"))
    first.pixels[:]
    frame_w, frame_h = first.size[0], first.size[1]
    sheet_w, sheet_h = frame_w * frame_count, frame_h * DIRECTIONS

    sheet = bpy.data.images.new(name="sheet", width=sheet_w, height=sheet_h, alpha=True)
    sheet_pixels = [0.0] * (sheet_w * sheet_h * 4)

    for direction in range(DIRECTIONS):
        for frame in range(frame_count):
            src_path = os.path.join(render_dir, f"dir{direction}_frame{frame}.png")
            src = first if (direction == 0 and frame == 0) else bpy.data.images.load(src_path)
            src_pixels = list(src.pixels)
            row_from_bottom = (DIRECTIONS - 1) - direction
            for y in range(frame_h):
                src_row_start = y * frame_w * 4
                dst_y = row_from_bottom * frame_h + y
                dst_row_start = (dst_y * sheet_w + frame * frame_w) * 4
                sheet_pixels[dst_row_start:dst_row_start + frame_w * 4] = \
                    src_pixels[src_row_start:src_row_start + frame_w * 4]
            if src is not first:
                bpy.data.images.remove(src)

    sheet.pixels[:] = sheet_pixels
    abs_out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(abs_out_path), exist_ok=True)
    sheet.filepath_raw = abs_out_path
    sheet.file_format = 'PNG'
    sheet.save()
    print(f"cwd={os.getcwd()} composed {abs_out_path} ({sheet_w}x{sheet_h}, {frame_count} cols x {DIRECTIONS} rows)")


def main():
    args = parse_args()
    entity = args["out-key"]
    renders_root = os.path.join("tools", "blender", "renders", entity)
    sheets_root = os.path.join("public", "assets", "characters", entity)

    idle_frames = [17]  # mid-pose of the 33-frame Idle_A cycle
    render_animation(
        args["character"], args["idle-fbx"], args["idle-action"], idle_frames,
        os.path.join(renders_root, "idle"), entity, "idle",
    )
    compose_sheet(os.path.join(renders_root, "idle"), os.path.join(sheets_root, "idle.png"), len(idle_frames))

    walk_frame_count = int(args.get("walk-frames", "6"))
    # Walking_A is 33 frames (1..33 inclusive per Blender's reported range); sample evenly.
    walk_frames = [1 + round(i * 32 / (walk_frame_count - 1)) for i in range(walk_frame_count)]
    render_animation(
        args["character"], args["walk-fbx"], args["walk-action"], walk_frames,
        os.path.join(renders_root, "walk"), entity, "walk",
    )
    compose_sheet(os.path.join(renders_root, "walk"), os.path.join(sheets_root, "walk.png"), walk_frame_count)


main()
