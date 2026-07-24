"""
import_city.py — headless Blender: import the SimplePoly "Scene_City" FBX
(the prebuilt full-city diorama) and export it as a single +Y-up binary .glb.

The SimplePoly City look comes from small 512×512 color-atlas PNGs (one per
building/vehicle group), NOT vertex colors — so we export materials + textures.
The exported textures embed into the .glb; gen-city.mjs then optimizes it.

Invoked by scripts/gen-city.mjs:
    Blender --background --python scripts/blender/import_city.py -- <src.fbx> <out.glb>

Tested against Blender 5.2.0 LTS (bundled Python 3.13, io_scene_gltf2 addon).
"""
import os
import sys

import bpy


def parse_args():
    argv = sys.argv
    if "--" not in argv:
        raise SystemExit("import_city.py: expected `-- <src.fbx> <out.glb>`")
    tail = argv[argv.index("--") + 1:]
    if len(tail) < 2:
        raise SystemExit("import_city.py: need <src.fbx> <out.glb>")
    return tail[0], tail[1]


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def main():
    src, out = parse_args()
    if not os.path.isfile(src):
        raise SystemExit(f"import_city.py: source not found: {src}")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    clear_scene()

    print(f"[import_city] importing FBX: {src}")
    bpy.ops.import_scene.fbx(filepath=src)

    obj_count = len(bpy.context.scene.objects)
    print(f"[import_city] imported {obj_count} objects")

    # Export the WHOLE scene (all buildings/roads/props/vehicles) as one glb.
    # Textures embed into the binary; gltf-transform (gen-city.mjs) dedups them.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_apply=True,      # bake modifiers/transforms into geometry
        export_yup=True,        # +Y up (three.js convention)
        export_materials="EXPORT",  # embeds the color-atlas PNGs into the .glb
    )
    size = os.path.getsize(out)
    print(f"[import_city] exported -> {out} ({size/1024/1024:.2f} MB)")


if __name__ == "__main__":
    main()
