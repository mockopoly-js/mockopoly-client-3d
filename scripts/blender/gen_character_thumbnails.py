"""
Headless-Blender portrait renderer for the 52 character SKINS (CT4, Part A).

For each source `.gltf` in the character pack it:
  1. imports the rigged model,
  2. poses it by scrubbing the scene to a mid-frame of the **Idle** action (so
     the rig is naturally posed — NOT a stiff T/bind pose),
  3. frames it with a fixed front ~3/4 camera + soft even lighting on a
     TRANSPARENT background,
  4. renders a square PNG portrait to `public/images/characters/<id>.png`.

CONSISTENT FRAMING: the camera, lights, and framing are computed the SAME way
for every character — we measure the posed mesh bounds and dolly a fixed-angle
camera to fit the full body with a uniform margin, so the 52 portraits form a
uniform grid. Native material colors are preserved (Filmic → Standard view
transform, no color grade).

Driven by `scripts/gen-character-thumbnails.mjs` (npm run models:thumbnails),
but runnable directly:

    /Applications/Blender.app/Contents/MacOS/Blender --background \\
        --python scripts/blender/gen_character_thumbnails.py -- \\
        [srcDir] [outDir] [size]

Tested against Blender 5.2.0 LTS (bundled Python, io_scene_gltf2 addon).
"""

import math
import os
import sys

import bpy
from mathutils import Vector

# --------------------------------------------------------------------------- #
# Args (after the `--` separator, Blender ignores its own flags before it)
# --------------------------------------------------------------------------- #

_argv = sys.argv
_extra = _argv[_argv.index("--") + 1 :] if "--" in _argv else []

HOME = os.path.expanduser("~")
SRC = _extra[0] if len(_extra) > 0 else os.path.join(
    HOME, "Downloads", "drive-download-20260724T173400Z-1-001", "glTF"
)
# scripts/blender/ -> project root is two levels up.
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, os.pardir))
OUT = _extra[1] if len(_extra) > 1 else os.path.join(
    PROJECT_ROOT, "public", "images", "characters"
)
SIZE = int(_extra[2]) if len(_extra) > 2 else 320

# Fixed front ~3/4 camera azimuth (deg, around +Z up) and elevation.
CAM_AZIMUTH_DEG = 22.0   # rotate a touch off dead-front for a 3/4 read
CAM_ELEV_DEG = 6.0       # slight downward look; keep near eye level
FRAME_MARGIN = 1.06      # >1 leaves a little breathing room around the body
IDLE_MID_FRAME_FRAC = 0.5  # scrub to the middle of the Idle action


def reset_scene() -> None:
    """Wipe everything so each character renders in a clean scene."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.objects,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.armatures,
        bpy.data.actions,
        bpy.data.images,
    ):
        for datablock in list(coll):
            try:
                coll.remove(datablock)
            except Exception:
                pass


def import_gltf(path: str) -> None:
    bpy.ops.import_scene.gltf(filepath=path)


def pose_to_idle_mid() -> None:
    """
    Scrub the timeline to a mid-frame of the Idle action so the imported rig is
    posed naturally. gltf import assigns actions to the armature; we search the
    armature's animation_data / NLA and the raw actions for one named 'Idle'.
    Falls back to leaving the rig at its imported (rest) pose if no Idle found.
    """
    idle = None
    for act in bpy.data.actions:
        if act.name.lower() == "idle" or act.name.lower().startswith("idle"):
            idle = act
            break
    if idle is None:
        # Any action is better than a rigid rest pose.
        idle = bpy.data.actions[0] if len(bpy.data.actions) else None
    if idle is None:
        return False

    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if arm is None:
        return False

    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = idle

    fstart, fend = idle.frame_range
    mid = int(fstart + (fend - fstart) * IDLE_MID_FRAME_FRAC)
    scene = bpy.context.scene
    scene.frame_start = int(fstart)
    scene.frame_end = int(fend)
    scene.frame_set(mid)
    # Force dependency-graph evaluation so mesh bounds reflect the posed frame.
    bpy.context.view_layer.update()
    return True


def posed_bounds():
    """World-space AABB of every mesh, evaluated at the current (posed) frame."""
    deps = bpy.context.evaluated_depsgraph_get()
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    found = False
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        eval_obj = obj.evaluated_get(deps)
        mesh = eval_obj.to_mesh()
        mw = eval_obj.matrix_world
        for v in mesh.vertices:
            wco = mw @ v.co
            mins.x = min(mins.x, wco.x)
            mins.y = min(mins.y, wco.y)
            mins.z = min(mins.z, wco.z)
            maxs.x = max(maxs.x, wco.x)
            maxs.y = max(maxs.y, wco.y)
            maxs.z = max(maxs.z, wco.z)
            found = True
        eval_obj.to_mesh_clear()
    if not found:
        return None
    return mins, maxs


def setup_camera(mins: Vector, maxs: Vector) -> bpy.types.Object:
    """
    Place a fixed-angle camera dollied out to fit the posed bounds with a
    uniform margin. Same math for every character → consistent framing.
    """
    center = (mins + maxs) * 0.5
    size = maxs - mins
    # Use the largest of height / width as the fit dimension (portrait bias:
    # characters are tall, so height usually dominates → uniform full-body).
    fit = max(size.z, math.hypot(size.x, size.y)) * FRAME_MARGIN

    cam_data = bpy.data.cameras.new("PortraitCam")
    cam_data.lens_unit = "FOV"
    fov = math.radians(38.0)
    cam_data.angle = fov
    cam = bpy.data.objects.new("PortraitCam", cam_data)
    bpy.context.collection.objects.link(cam)

    # Distance so `fit` fills the frame: fit/2 = dist * tan(fov/2).
    dist = (fit * 0.5) / math.tan(fov * 0.5)

    az = math.radians(CAM_AZIMUTH_DEG)
    el = math.radians(CAM_ELEV_DEG)
    # Direction FROM target TO camera. -Y is "front" for these gltf models
    # (they face -Y after +Y-up import); place the camera in front (+... toward
    # the face) and orbit by azimuth.
    dir_h = Vector((math.sin(az), -math.cos(az), 0.0))
    offset = Vector((dir_h.x, dir_h.y, math.sin(el))).normalized() * dist
    cam.location = center + offset

    # Aim at center.
    look = center - cam.location
    cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()

    bpy.context.scene.camera = cam
    return cam


def setup_lights(mins: Vector, maxs: Vector) -> None:
    """Soft, even 3-point-ish lighting so native colors read cleanly."""
    center = (mins + maxs) * 0.5
    span = (maxs - mins).length + 1e-3

    def add_light(name, kind, loc, energy, size=None, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, type=kind)
        ld.energy = energy
        ld.color = color
        if kind == "AREA" and size is not None:
            ld.size = size
        obj = bpy.data.objects.new(name, ld)
        bpy.context.collection.objects.link(obj)
        obj.location = center + Vector(loc) * span
        look = center - obj.location
        obj.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
        return obj

    # Key (front-left), fill (front-right, softer), rim (back-top). Energies
    # bumped so faces on dark skins (near-black baseColor) still read.
    add_light("Key", "AREA", (-0.9, -1.2, 1.0), 1200.0, size=span * 1.6)
    add_light("Fill", "AREA", (1.2, -1.0, 0.4), 600.0, size=span * 2.0)
    add_light("Rim", "AREA", (0.4, 1.2, 1.4), 600.0, size=span * 1.4)
    # Ambient via a soft world so shadowed sides aren't crushed.
    world = bpy.data.worlds.new("PortraitWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is not None:
        bg.inputs["Color"].default_value = (0.34, 0.34, 0.38, 1.0)
        bg.inputs["Strength"].default_value = 0.7
    bpy.context.scene.world = world


def configure_render() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if _has_eevee_next() else "BLENDER_EEVEE"
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True  # transparent background
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    # Native colors: neutral view transform (no filmic contrast crush).
    try:
        scene.view_settings.view_transform = "Standard"
    except Exception:
        pass
    # Modest anti-aliasing / sampling for clean edges on the small portrait.
    try:
        scene.eevee.taa_render_samples = 32
    except Exception:
        pass


def _has_eevee_next() -> bool:
    try:
        return "BLENDER_EEVEE_NEXT" in bpy.types.RenderSettings.bl_rna.properties[
            "engine"
        ].enum_items.keys()
    except Exception:
        return False


def render_to(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main() -> None:
    if not os.path.isdir(SRC):
        print(f"[thumbnails] source dir not found: {SRC}", file=sys.stderr)
        sys.exit(1)
    os.makedirs(OUT, exist_ok=True)

    names = sorted(
        f[:-5] for f in os.listdir(SRC) if f.lower().endswith(".gltf")
    )
    if not names:
        print(f"[thumbnails] no .gltf in {SRC}", file=sys.stderr)
        sys.exit(1)

    print(f"[thumbnails] rendering {len(names)} portraits @ {SIZE}x{SIZE} -> {OUT}")
    failures = []
    posed_count = 0
    for i, name in enumerate(names, 1):
        try:
            reset_scene()
            configure_render()
            import_gltf(os.path.join(SRC, f"{name}.gltf"))
            if pose_to_idle_mid():
                posed_count += 1
            b = posed_bounds()
            if b is None:
                raise RuntimeError("no mesh geometry after import")
            mins, maxs = b
            setup_camera(mins, maxs)
            setup_lights(mins, maxs)
            out_path = os.path.join(OUT, f"{name}.png")
            render_to(out_path)
            print(f"[thumbnails] [{i:2d}/{len(names)}] {name}")
        except Exception as err:  # noqa: BLE001
            failures.append(f"{name}: {err}")
            print(f"[thumbnails] [ERR] {name}: {err}", file=sys.stderr)

    print(
        f"[thumbnails] done — {len(names) - len(failures)}/{len(names)} rendered, "
        f"{posed_count} posed to Idle"
    )
    if failures:
        print(f"[thumbnails] FAILED {len(failures)}:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
