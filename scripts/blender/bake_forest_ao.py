"""
bake_forest_ao.py — headless Blender: render an ISLAND-WIDE, TOP-DOWN forest
contact-occlusion coverage map for the MOBILE forest variant
(`public/models/forest.mobile.glb`).

WHY A TOP-DOWN COVERAGE RENDER (not a per-face lightmap bake like the city):
The forest AO is consumed at runtime as a single GROUND DECAL / overlay sampled
by WORLD XZ — a top-down texture that darkens the terrain under tree/rock/mountain
clusters and stays WHITE in the central clearing where the board sits. So the
right primitive is a top-down orthographic projection of the OCCLUDERS' footprint,
NOT a UV lightmap on the forest mesh. This is:
  * ROBUST / deterministic — flat emission render (no ray-distance tuning, no
    plane-height guessing against the rolling terrain, no Cycles GI noise);
  * SCALE-INVARIANT — frames the island box and renders, so the odd local-unit
    scale of the source (hundreds–thousands of units) never matters;
  * exactly a top-down decal — the output [0,1]^2 maps to a known WORLD XZ rect,
    which is all the runtime wiring needs.
The runner (scripts/gen-forest-mobile-ao.mjs) softens this coverage into a smooth
penumbra (offline Gaussian blur — NOT a runtime pass), lifts a subtle black floor,
squares it, and compresses to webp + ktx2. This script writes ONLY the raw
coverage PNG + a meta JSON with the world→UV mapping constants; nothing here (or
in the runner) touches the desktop-frozen `forest.glb` or any mobile material —
the decal is not wired yet.

OCCLUDERS = trees / birch / rocks / mountains ONLY. The flat GROUND FLOOR tiles
(meadow / path / lake) are DELETED before rendering — from the top they cover the
whole island (they ARE the ground), so leaving them in would black out the entire
map. The small ground clutter (grass / flowers / mushrooms) is ALSO dropped so the
map stays a clean, low-frequency occlusion and the central clearing renders pure
white (board area unoccluded). The `_LOD1`/`_LOD2` decimated sibling meshes (which
sit at the origin) are dropped too — leaving them in would blot the clearing.

FRAMING / MAPPING: the orthographic camera frames the FULL island box (computed
over ALL non-LOD meshes, INCLUDING the floor — the floor defines the horizontal
extent, matching three's `Box3.setFromObject` in ForestEnvironment), so the output
UV maps to the same world rect the runtime forest occupies. glTF is Y-up; Blender
is Z-up (import maps glTF (X,Y,Z) -> Blender (X,-Z,Y)), so the horizontal plane in
Blender is X-Y and the camera looks straight down -Z (top view). See the meta JSON
for the derived three-space size/center + world islandMin/islandSize.

Invoked by scripts/gen-forest-mobile-ao.mjs (or standalone):
    blender --background --python scripts/blender/bake_forest_ao.py -- \
        <in.glb> <out_coverage.png> <out_meta.json> [res_long]

Tested against Blender 5.2.0 LTS (bundled Python 3.13, io_scene_gltf2 addon,
native meshopt + EXT_mesh_gpu_instancing import).
"""
import json
import math
import os
import re
import sys

import bpy
import mathutils

# ── Tunables ────────────────────────────────────────────────────────────────
RES_LONG = 2418          # render px on the LONGER island axis (overridable via
                         # the 4th CLI arg). Supersampled: the runner blurs then
                         # downsamples to a 1024^2 square texture, so this is 2x+
                         # oversampling for clean silhouette edges under the blur.
CYCLES_SAMPLES = 16      # AA subpixel samples. The render is FLAT EMISSION (black
                         # occluders, white world) with 0 light bounces, so there
                         # is no noise — samples only anti-alias the silhouette.

# OCCLUDERS: the substantial relief that should ground-shadow the terrain —
# trees / birch / rocks. Matches the runtime type names (see ForestEnvironment /
# forestChunking classifiers). MOUNTAINS are EXCLUDED on purpose: they are the
# distant relief backdrop ringing the whole island edge (beyond the runtime fog
# wall + ring cull), so from a top-down view their silhouette blacks out the
# entire perimeter — a heavy frame, not the "dark under tree/rock CLUSTERS" the
# decal wants. They stay in the FRAMING box (below) so the UV mapping still
# matches three's Box3, but they cast no occlusion into the map.
OCCLUDER_RE = re.compile(r"tree|birch|rock", re.IGNORECASE)
# The decimated LOD sibling meshes ride at the origin — exclude them or they blot
# the central clearing black (catastrophic: the board area must be WHITE).
LOD_RE = re.compile(r"_LOD1|_LOD2", re.IGNORECASE)

# Runtime surround fit (ForestEnvironment.tsx): BOARD_WORLD_SIZE(10) * 4.6 *
# (FOREST_CROP_HALF(16000) / FOREST_CROP_HALF_BASE(8000)) = 92 world units on the
# forest's SHORTER horizontal axis. groupScale = SURROUND_SIZE / shorterAxis.
BOARD_WORLD_SIZE = 10.0
SURROUND_SIZE = BOARD_WORLD_SIZE * 4.6 * (16000.0 / 8000.0)  # 92.0


def parse_args():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    defaults = [
        os.path.join(root, "public/models/forest.mobile.glb"),
        os.path.join(root, "scratch_forest_ao.png"),
        os.path.join(root, "scratch_forest_ao.meta.json"),
    ]
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = list(tail) + defaults[len(tail):]
    res = int(args[3]) if len(args) > 3 else RES_LONG
    return args[0], args[1], args[2], res


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def main():
    in_glb, out_png, out_meta, res_long = parse_args()
    if not os.path.isfile(in_glb):
        raise SystemExit(f"bake_forest_ao: input not found: {in_glb}")
    for p in (out_png, out_meta):
        d = os.path.dirname(p)
        if d:
            os.makedirs(d, exist_ok=True)

    clear_scene()
    print(f"[bake_forest_ao] importing {in_glb}")
    bpy.ops.import_scene.gltf(filepath=in_glb)

    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    if not mesh_objs:
        raise SystemExit("bake_forest_ao: no mesh objects imported")

    # 1) Drop the LOD sibling meshes entirely (they sit at the origin).
    lod_dropped = 0
    non_lod = []
    for o in list(mesh_objs):
        if LOD_RE.search(o.name) or LOD_RE.search(o.data.name):
            bpy.data.objects.remove(o, do_unlink=True)
            lod_dropped += 1
        else:
            non_lod.append(o)

    # 2) FULL island box over ALL non-LOD meshes (floor INCLUDED) — this is three's
    #    Box3.setFromObject frame the runtime forest transform uses. In Blender
    #    (Z-up) the horizontal plane is X-Y; Z is vertical.
    bmin = [math.inf, math.inf, math.inf]
    bmax = [-math.inf, -math.inf, -math.inf]
    for o in non_lod:
        for corner in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                bmin[i] = min(bmin[i], w[i])
                bmax[i] = max(bmax[i], w[i])
    bsize = [bmax[i] - bmin[i] for i in range(3)]
    bcenter = [(bmin[i] + bmax[i]) / 2.0 for i in range(3)]
    print(f"[bake_forest_ao] Blender box min={[round(v,2) for v in bmin]} "
          f"max={[round(v,2) for v in bmax]} size={[round(v,2) for v in bsize]}")

    # 3) Keep ONLY the occluders (trees/birch/rocks/mountains); delete the floor
    #    tiles + ground clutter so the map is a clean occlusion with a white centre.
    kept = 0
    dropped = 0
    for o in list(non_lod):
        if OCCLUDER_RE.search(o.name):
            kept += 1
        else:
            bpy.data.objects.remove(o, do_unlink=True)
            dropped += 1
    print(f"[bake_forest_ao] occluders kept={kept}  non-occluders dropped={dropped}  "
          f"LOD dropped={lod_dropped}")
    if kept == 0:
        raise SystemExit("bake_forest_ao: no occluder meshes matched — check names")

    # 4) Flat render: black-emission occluders on a white world → coverage mask.
    black = bpy.data.materials.new("forest_ao_black")
    black.use_nodes = True
    nt = black.node_tree
    nt.nodes.clear()
    out_node = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    emit.inputs["Strength"].default_value = 1.0
    nt.links.new(emit.outputs["Emission"], out_node.inputs["Surface"])

    scene = bpy.context.scene
    # Override every occluder material with the flat black (one line; no per-object
    # mutation). Fall back to per-object assignment if the API is unavailable.
    try:
        scene.view_layers[0].material_override = black
    except Exception:
        for o in bpy.data.objects:
            if o.type == "MESH":
                o.data.materials.clear()
                o.data.materials.append(black)

    # White world (camera rays that MISS all geometry -> pure white / unoccluded).
    world = bpy.data.worlds.new("forest_ao_world")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = 1.0

    # 5) Orthographic TOP-DOWN camera framing the full Blender X-Y box exactly.
    size_x, size_y = bsize[0], bsize[1]
    res_x = res_long if size_x >= size_y else round(res_long * size_x / size_y)
    res_y = round(res_long * size_y / size_x) if size_x >= size_y else res_long
    cam_data = bpy.data.cameras.new("forest_ao_cam")
    cam_data.type = "ORTHO"
    # sensor_fit + ortho_scale along the LONGER axis; the render aspect (res_x/res_y
    # = size_x/size_y) makes the other axis frame its extent exactly.
    if size_x >= size_y:
        cam_data.sensor_fit = "HORIZONTAL"
        cam_data.ortho_scale = size_x
    else:
        cam_data.sensor_fit = "VERTICAL"
        cam_data.ortho_scale = size_y
    cam_data.clip_start = 0.1
    cam_data.clip_end = (bmax[2] - bmin[2]) + 200.0
    cam_obj = bpy.data.objects.new("forest_ao_cam", cam_data)
    scene.collection.objects.link(cam_obj)
    cam_obj.location = (bcenter[0], bcenter[1], bmax[2] + 50.0)  # above the top
    cam_obj.rotation_euler = (0.0, 0.0, 0.0)  # looks straight down -Z (top view)
    scene.camera = cam_obj

    # 6) Cycles, flat emission, no bounces, no view-transform crush (Standard so
    #    emission 0->black, 1->white map linearly to 8-bit; AgX/Filmic would crush).
    scene.render.engine = "CYCLES"
    try:
        scene.cycles.device = "CPU"
    except Exception:
        pass
    scene.cycles.samples = CYCLES_SAMPLES
    try:
        scene.cycles.use_denoising = False
        scene.cycles.max_bounces = 0
        scene.cycles.diffuse_bounces = 0
        scene.cycles.glossy_bounces = 0
        scene.cycles.transmission_bounces = 0
        scene.cycles.transparent_max_bounces = 0
    except Exception:
        pass
    try:
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
        scene.view_settings.exposure = 0.0
        scene.view_settings.gamma = 1.0
    except Exception:
        pass

    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "BW"
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = out_png

    print(f"[bake_forest_ao] rendering top-down coverage {res_x}x{res_y} "
          f"(ortho_scale={cam_data.ortho_scale:.1f}, {CYCLES_SAMPLES} AA samples) ...")
    bpy.ops.render.render(write_still=True)
    print(f"[bake_forest_ao] wrote {out_png} ({os.path.getsize(out_png)/1024:.1f} KB)")

    # 7) Derive three-space size/center + world islandMin/islandSize and save meta.
    #    glTF (three) is Y-up; import maps three (x,y,z) -> Blender (x,-z,y), so:
    #    three.x = Blender.x ; three.z = -Blender.y ; three.y(up) = Blender.z.
    three_size = [bsize[0], bsize[2], bsize[1]]           # (x, y, z)
    three_center = [bcenter[0], bcenter[2], -bcenter[1]]  # (x, y, z)
    shorter = min(three_size[0], three_size[2])
    group_scale = SURROUND_SIZE / shorter
    # world = groupScale * (local.xz - center.xz); the island is centred at world
    # origin, so islandMin = -islandSize/2 (center maps to 0,0).
    island_size_world = [three_size[0] * group_scale, three_size[2] * group_scale]
    island_min_world = [
        (three_center[0] - three_size[0] / 2.0) * group_scale,
        (three_center[2] - three_size[2] / 2.0) * group_scale,
    ]
    meta = {
        "source_glb": os.path.basename(in_glb),
        "render_px": [res_x, res_y],
        "blender_box_min": [round(v, 4) for v in bmin],
        "blender_box_max": [round(v, 4) for v in bmax],
        "three_size": [round(v, 4) for v in three_size],
        "three_center": [round(v, 4) for v in three_center],
        "surround_size": SURROUND_SIZE,
        "group_scale": round(group_scale, 8),
        "island_size_world": [round(v, 5) for v in island_size_world],
        "island_min_world": [round(v, 5) for v in island_min_world],
        # Axis convention of the rendered PNG (top-down, looking down Blender -Z):
        #   image column u (0->1, left->right)  = world +X  (min.x -> max.x)
        #   image row    (0->1, TOP->BOTTOM)    = world +Z  (min.z -> max.z)
        "uv_convention": {
            "u_is": "worldX from islandMin.x (left) to islandMin.x+islandSize.x (right)",
            "row_top_to_bottom_is": "worldZ from islandMin.z (top) to islandMin.z+islandSize.z (bottom)",
        },
        "occluders": ["tree", "birch", "rock"],
        "excluded": ["mountains (backdrop ring)", "meadow/path/lake floor", "grass/flowers/mushrooms", "_LOD1/_LOD2"],
    }
    with open(out_meta, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"[bake_forest_ao] meta -> {out_meta}")
    print(f"[bake_forest_ao] islandSize(world)={island_size_world} "
          f"islandMin(world)={island_min_world} groupScale={group_scale:.6f}")
    print("[bake_forest_ao] done.")


if __name__ == "__main__":
    main()
