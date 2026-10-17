"""
Render the five floor tiles (cold, desaturated dungeon stone slabs) as 128x96 RGBA PNGs.

Usage:
  blender --background --python tools/blender/render_floor_tiles.py -- --out public/assets/tiles/floor

Each tile is rendered in a clean scene: the top face of a side-1 square, scaled 1.02 and
cropped by the camera frame (so every pixel is opaque), with at most RELIEF of relief,
flat shading, one sun plus flat ambient light, and an orthographic camera at azimuth 0
(looking along +Y) and elevation asin(0.75) -- the game draws a tile 64x48 px, ratio 0.75.

The outermost JOINT strip of every tile is flat mortar at z = 0 in the same colour, so the
frame edges of all five tiles match and neighbouring tiles join without visible seams;
the joint between two slabs is that mortar strip seen from both sides.
"""
import sys
import os
import math
import bpy
import bmesh
import mathutils

# ---- Camera / output -------------------------------------------------------
RES_X, RES_Y = 128, 96
ELEVATION_DEG = math.degrees(math.asin(0.75))  # 48.59
# Blender applies ortho_scale to the larger frame dimension (width, 128 px), and at this
# elevation the 96 px height then spans the same ground depth, so the frame shows exactly
# ORTHO_SCALE x ORTHO_SCALE of ground. It must equal the tile side (1), so the 1.02 quad
# overfills the frame and is cropped: with ortho_scale 1.02 the quad edge coincides with
# the frame edge and the anti-aliased border row/column came out semi-transparent
# (223 non-opaque pixels per tile, measured).
PLANE_SIDE = 1.0
ORTHO_SCALE = PLANE_SIDE
PLANE_SCALE = 1.02           # ground quad is side 1 scaled 1.02, cropped by the frame
CAMERA_DISTANCE = 5.0
RENDER_SAMPLES = 32

# ---- Geometry (world units; frame half-width is ORTHO_SCALE / 2) -----------
FRAME_HALF = ORTHO_SCALE / 2
JOINT = 0.024                # flat mortar strip at the frame edge (~3 px at 128 wide)
RELIEF = 0.02                # max height of a slab top (hard limit 0.02)
CHAMFER = 0.035              # horizontal run of the slab chamfer
GROOVE_HALF = 0.022          # floor_a: half width of the mortar groove between the two halves
CORNER_CUT = 0.24            # floor_b: leg of the cut corner
WORN_DEPTH = 0.008           # floor_worn: depth of the shallow depression
CRACK_WIDTH = 0.016          # floor_worn: max crack width (tapers to the tips)
EDGE_RIM = 0.045             # floor_edge: flat rim width before the inner bevel
EDGE_BEVEL = 0.03            # floor_edge: horizontal run of the inner bevel
EDGE_PANEL_DROP = 0.01       # floor_edge: how far the inner panel sits below the rim

# ---- Palette (linear RGB albedo; cold, desaturated, no red/orange) ---------
MORTAR = (0.054, 0.059, 0.070)
SLAB = (0.108, 0.115, 0.132)
SLAB_SIDE = (0.092, 0.099, 0.115)
WORN = (0.088, 0.094, 0.106)
CRACK = (0.050, 0.055, 0.066)
EDGE_SLAB = (0.070, 0.076, 0.090)
EDGE_PANEL = (0.062, 0.068, 0.080)

# ---- Lighting -------------------------------------------------------------
SUN_STRENGTH = 2.8
SUN_ROTATION_DEG = (40.0, 0.0, -135.0)  # light from the far-left (screen top-left)
AMBIENT_STRENGTH = 0.38

TILE_IDS = ["floor_base", "floor_a", "floor_b", "floor_worn", "floor_edge"]


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    args = {}
    i = 0
    while i < len(argv):
        args[argv[i].lstrip("-")] = argv[i + 1]
        i += 2
    return args


def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name, color):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:  # Blender < 5 needs use_nodes; 5.x always has a node tree
        mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Roughness"].default_value = 1.0
    for name_ in ("Specular IOR Level", "Specular"):
        if name_ in bsdf.inputs:
            bsdf.inputs[name_].default_value = 0.0
            break
    mat.diffuse_color = (color[0], color[1], color[2], 1.0)
    return mat


def setup_render(out_path):
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError as err:
        raise RuntimeError(f"EEVEE engine not available: {err}")
    try:
        scene.eevee.taa_render_samples = RENDER_SAMPLES
    except AttributeError:
        pass
    try:
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
    except TypeError:
        pass
    scene.render.film_transparent = True
    scene.render.resolution_x = RES_X
    scene.render.resolution_y = RES_Y
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = out_path


def setup_lighting():
    sun_data = bpy.data.lights.new(name="sun", type="SUN")
    sun_data.energy = SUN_STRENGTH
    sun = bpy.data.objects.new(name="sun", object_data=sun_data)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = tuple(math.radians(a) for a in SUN_ROTATION_DEG)

    world = bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = AMBIENT_STRENGTH


def setup_camera():
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ORTHO_SCALE
    cam_data.sensor_fit = "AUTO"  # ortho_scale -> larger dimension (width, 128 px)
    cam_data.clip_start = 0.01
    cam_data.clip_end = 100.0
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    el = math.radians(ELEVATION_DEG)
    # Azimuth 0: the camera sits on -Y and looks along +Y, tilted down; screen up = far (+Y).
    cam.location = (0.0, -CAMERA_DISTANCE * math.cos(el), CAMERA_DISTANCE * math.sin(el))
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = mathutils.Vector((0.0, math.cos(el), -math.sin(el))).to_track_quat("-Z", "Y")
    bpy.context.scene.camera = cam


def inset_convex(pts, d):
    """Offset a counter-clockwise convex polygon inward by d."""
    n = len(pts)
    lines = []
    for i in range(n):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
        ex, ey = x1 - x0, y1 - y0
        ln = math.hypot(ex, ey)
        nx, ny = -ey / ln, ex / ln  # left normal = inward for CCW
        lines.append(((x0 + nx * d, y0 + ny * d), (ex, ey)))
    out = []
    for i in range(n):
        (p, r), (q, s) = lines[i - 1], lines[i]
        cross = r[0] * s[1] - r[1] * s[0]
        t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / cross
        out.append((p[0] + r[0] * t, p[1] + r[1] * t))
    return out


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def add_ground(bm, mat_index):
    h = PLANE_SIDE * PLANE_SCALE / 2
    vs = [bm.verts.new((x, y, 0.0)) for x, y in rect(-h, -h, h, h)]
    bm.faces.new(vs).material_index = mat_index


def add_slab(bm, footprint, side_mat, top_mat, relief=RELIEF, chamfer=CHAMFER):
    """A slab on the mortar: footprint at z=0, chamfered up to an inset top at `relief`."""
    top_pts = inset_convex(footprint, chamfer)
    lift = 0.0005  # keep the slab's base just above the mortar to avoid coplanar fighting
    bottom = [bm.verts.new((x, y, lift)) for x, y in footprint]
    top = [bm.verts.new((x, y, relief)) for x, y in top_pts]
    n = len(footprint)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([bottom[i], bottom[j], top[j], top[i]]).material_index = side_mat
    top_face = bm.faces.new(top)
    top_face.material_index = top_mat
    return top_face


def inset_face(bm, face, thickness, drop=0.0):
    res = bmesh.ops.inset_region(bm, faces=[face], thickness=thickness, depth=0.0, use_even_offset=True)
    for v in face.verts:
        v.co.z -= drop
    return res["faces"]


def add_crack(bm, points, width, z, mat_index):
    """A thin tapering strip of a few faces lying just above the slab top."""
    n = len(points)
    left, right = [], []
    for i, (x, y) in enumerate(points):
        a = points[max(i - 1, 0)]
        b = points[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy)
        nx, ny = -dy / ln, dx / ln
        taper = math.sin(math.pi * i / (n - 1)) if n > 2 else 1.0
        w = width / 2 * max(taper, 0.15)
        left.append(bm.verts.new((x + nx * w, y + ny * w, z)))
        right.append(bm.verts.new((x - nx * w, y - ny * w, z)))
    for i in range(n - 1):
        bm.faces.new([left[i], right[i], right[i + 1], left[i + 1]]).material_index = mat_index


def slab_half():
    return FRAME_HALF - JOINT


def build_tile(tile_id):
    mats = {
        "mortar": make_material("mortar", MORTAR),
        "slab": make_material("slab", SLAB),
        "slab_side": make_material("slab_side", SLAB_SIDE),
        "worn": make_material("worn", WORN),
        "crack": make_material("crack", CRACK),
        "edge_slab": make_material("edge_slab", EDGE_SLAB),
        "edge_panel": make_material("edge_panel", EDGE_PANEL),
    }
    order = list(mats.keys())
    idx = {k: i for i, k in enumerate(order)}

    bm = bmesh.new()
    add_ground(bm, idx["mortar"])
    s = slab_half()

    if tile_id == "floor_base":
        add_slab(bm, rect(-s, -s, s, s), idx["slab_side"], idx["slab"])
    elif tile_id == "floor_a":
        g = GROOVE_HALF
        add_slab(bm, rect(-s, -s, -g, s), idx["slab_side"], idx["slab"])
        add_slab(bm, rect(g, -s, s, s), idx["slab_side"], idx["slab"])
    elif tile_id == "floor_b":
        c = CORNER_CUT
        footprint = [(-s, -s), (s, -s), (s, s - c), (s - c, s), (-s, s)]  # far-right corner cut
        add_slab(bm, footprint, idx["slab_side"], idx["slab"])
    elif tile_id == "floor_worn":
        top = add_slab(bm, rect(-s, -s, s, s), idx["slab_side"], idx["slab"])
        inset_face(bm, top, 0.08)
        # Reshape the inner face into an off-centre, irregular depression outline.
        outline = [(-0.20, -0.17), (0.10, -0.24), (0.22, -0.02), (-0.06, 0.12)]
        for v, (x, y) in zip(sorted(top.verts, key=lambda v: math.atan2(v.co.y, v.co.x)),
                             sorted(outline, key=lambda p: math.atan2(p[1], p[0]))):
            v.co.x, v.co.y = x, y
        inset_face(bm, top, 0.02, drop=WORN_DEPTH)
        top.material_index = idx["worn"]
        add_crack(bm, [(0.08, 0.40), (0.15, 0.30), (0.12, 0.22), (0.24, 0.12), (0.30, 0.04)],
                  CRACK_WIDTH, RELIEF + 0.0008, idx["crack"])
    elif tile_id == "floor_edge":
        top = add_slab(bm, rect(-s, -s, s, s), idx["slab_side"], idx["edge_slab"])
        inset_face(bm, top, EDGE_RIM)
        bevel = inset_face(bm, top, EDGE_BEVEL, drop=EDGE_PANEL_DROP)
        for f in bevel:
            f.material_index = idx["edge_slab"]
        top.material_index = idx["edge_panel"]
    else:
        raise ValueError(f"unknown tile id {tile_id!r}")

    for f in bm.faces:
        f.smooth = False
    mesh = bpy.data.meshes.new(tile_id)
    bm.to_mesh(mesh)
    bm.free()
    for k in order:
        mesh.materials.append(mats[k])
    obj = bpy.data.objects.new(tile_id, mesh)
    bpy.context.collection.objects.link(obj)

    zs = [v.co.z for v in mesh.vertices]
    if max(zs) > RELIEF + 0.001 or min(zs) < 0.0:
        raise RuntimeError(f"{tile_id}: relief out of range ({min(zs)}..{max(zs)})")


def render_tile(tile_id, out_dir):
    clean_scene()
    out_path = os.path.join(out_dir, f"{tile_id}.png")
    setup_render(out_path)
    setup_lighting()
    setup_camera()
    build_tile(tile_id)
    bpy.ops.render.render(write_still=True)
    return out_path


def main():
    args = parse_args()
    out_dir = os.path.abspath(args.get("out", os.path.join("public", "assets", "tiles", "floor")))
    os.makedirs(out_dir, exist_ok=True)
    written = [render_tile(t, out_dir) for t in TILE_IDS]
    print("wrote floor tiles:")
    for p in written:
        print(f"  {p}")


main()
