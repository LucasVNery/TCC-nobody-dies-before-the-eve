import sys
import bpy

argv = sys.argv
argv = argv[argv.index("--") + 1:]
path = argv[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=path)

print(f"=== Actions in {path} ===")
for action in bpy.data.actions:
    print(f"  action: {action.name!r}  frame_range: {action.frame_range[:]}")

print(f"=== Armatures/Objects in {path} ===")
for obj in bpy.data.objects:
    print(f"  object: {obj.name!r}  type: {obj.type}")
