"""
bake_forest_ao.py — headless Blender: render an ISLAND-WIDE, TOP-DOWN forest
ground map for the MOBILE forest variant (`public/models/forest.mobile.glb`) that
carries DIRECTIONAL SUN CAST SHADOWS combined with contact-AO in ONE grayscale
luminance map.

WHY A TOP-DOWN GROUND RENDER (not a per-face lightmap bake like the city):
The forest AO is consumed at runtime as a single GROUND DECAL / overlay sampled
by WORLD XZ — a top-down texture that darkens the terrain under tree/rock/mountain
clusters (and streaks their sun shadows across the clearing floor) while staying
WHITE in the central clearing where the board sits. So the right primitive is a
top-down orthographic render of a white RECEIVER plane lit by (a) a directional
SUN and (b) a uniform white sky, with the trees/rocks/mountains as SHADOW casters
above it — NOT a UV lightmap on the forest mesh. This is:
  * a top-down decal — the output [0,1]^2 maps to a known WORLD XZ rect, which is
    all the runtime wiring needs;
  * SCALE-INVARIANT — frames the island box and renders, so the odd local-unit
    scale of the source (hundreds–thousands of units) never matters;
  * PHYSICAL — the sun (direction matched to GameScene MOBILE_KEY_POSITION) throws
    real directional cast shadows and the white sky is the ambient term the canopy
    occludes into contact-AO, in a SINGLE grayscale luminance map.
The runner (scripts/gen-forest-mobile-ao.mjs) normalizes the white point, keeps a
small offline penumbra blur, clamps a subtle black floor (so shadows stay dark but
never pure-black), protects the board clearing with a white keep-out disc, and
compresses to webp + ktx2. This script writes ONLY the raw luminance PNG + a meta
JSON with the world→UV mapping constants; nothing here (or in the runner) touches
the desktop-frozen `forest.glb` or any mobile material — the map is sampled by the
already-wired mobile ground clip (single texture2D tap + multiply).

SHADOWS ARE BAKED, NOT RUNTIME (iOS-safe): the terrain shadows live in this baked
world-XZ TEXTURE and reach the device as a plain grayscale multiply. The mediump
forest program never enables shadowMap (that crashes iOS = blank forest); its
scene-pass shadow scope is untouched.

OCCLUDERS:
  * trees / birch / rocks — cast the sun shadow AND occlude the sky (contact-AO
    under clusters). visible_camera=False (their tops are never drawn), so only
    their shadow + AO reach the receiver.
  * mountains — trialled as SHADOW-ONLY casters (visible_camera=False,
    visible_shadow=True, visible_diffuse/glossy=False) but DROPPED: this asset's
    mountains are ~73 units tall and ring the whole perimeter, so at the 30.8deg sun
    their ~122-unit shadows merge into one flat mid-gray slab over the outer terrain
    — a heavy frame, not per-cluster streaks. The spec's sanctioned fallback:
    trees/rocks alone already satisfy the brief. Flip INCLUDE_MOUNTAIN_SHADOWS to
    re-trial them.
The flat GROUND FLOOR tiles (meadow / path / lake) are DELETED — they ARE the
ground, replaced by the white RECEIVER plane. Small clutter (grass / flowers /
mushrooms) is dropped too so the map stays a clean, low-frequency shadow+AO and the
central clearing renders white. The `_LOD1`/`_LOD2` decimated siblings (which sit
at the origin) are dropped or they blot the clearing.

FRAMING / MAPPING: the orthographic camera frames the FULL island box (computed
over ALL non-LOD meshes, INCLUDING the floor — the floor defines the horizontal
extent, matching three's `Box3.setFromObject` in ForestEnvironment), so the output
UV maps to the same world rect the runtime forest occupies. This framing + the meta
JSON world→UV constants are UNCHANGED from the coverage-only bake, so the runtime
wiring (AO_ISLAND_* constants) stays byte-identical. glTF is Y-up; Blender is Z-up
(import maps glTF (X,Y,Z) -> Blender (X,-Z,Y)), so the horizontal plane in Blender
is X-Y and the camera looks straight down -Z (top view).

SUN DIRECTION: matched to GameScene MOBILE_KEY_POSITION [7,5.5,6] (three, Y-up).
glTF import maps three (x,y,z) -> Blender (x,-z,y), so the sun's three position maps
to Blender (7,-6,5.5); the ray travels toward the origin = Blender dir (-7,6,-5.5)
(normalized (-0.652,0.559,-0.512)) = elevation ~30.8deg. Projected top-down that
points toward Blender (-X,+Y) = image UPPER-LEFT = world (-X,-Z) — the SAME side the
real board/city KEY shadows fall, so the forest ground shadows read consistent.

Invoked by scripts/gen-forest-mobile-ao.mjs (or standalone):
    blender --background --python scripts/blender/bake_forest_ao.py -- \
        <in.glb> <out_lum.png> <out_meta.json> [res_long]

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
CYCLES_SAMPLES = 256     # the render is now PHYSICAL (direct sun + direct white-sky
                         # sampling → stochastic soft shadow + AO), so raise samples
                         # well above the old flat-emission 16 and denoise (below).
                         # Offline cost only.

# Directional SUN (the cast-shadow source), Blender space, matched to GameScene
# MOBILE_KEY_POSITION [7,5.5,6]. The lamp emits along its local -Z; we point -Z
# along this ray so the shadow falls toward image UPPER-LEFT = world (-X,-Z).
SUN_DIR = mathutils.Vector((-7.0, 6.0, -5.5))   # sun -> scene, Blender space
SUN_ENERGY = 3.0         # sun irradiance (W/m^2). Ratio vs WORLD_STRENGTH sets the
                         # cast-shadow darkness; final white point is normalized in
                         # the runner, so absolute Blender exposure does not matter.
SUN_ANGLE = 0.052        # ~3deg angular size → SOFT reference-style penumbra
                         # (Blender's 0.526deg default is razor-hard).
WORLD_STRENGTH = 0.42    # uniform white SKY = the AMBIENT term the canopy occludes
                         # into contact-AO AND the fill that keeps the shadow a
                         # COLORED (not black) region once the runtime cool-hemi /
                         # ambient / grade light the darkened albedo. With SUN_ENERGY
                         # 3.0 an open receiver lands ~white and a sun-only-blocked
                         # cast-shadow plateau ~0.42 (dark, readable, not black).
RECEIVER_MARGIN = 1.15   # receiver plane scale vs the island box (cover the frame
                         # fully; the ortho camera crops to the box).
RECEIVER_DROP = 0.5      # place the receiver this hair BELOW the occluder foot level.

# OCCLUDERS that cast the sun shadow AND occlude the sky into contact-AO —
# trees / birch / rocks. Matches the runtime type names (see ForestEnvironment /
# forestChunking classifiers).
OCCLUDER_RE = re.compile(r"tree|birch|rock", re.IGNORECASE)
# MOUNTAINS were trialled as SHADOW-ONLY casters (visible_camera=False,
# visible_shadow=True) hoping for long directional streaks with no drawn footprint.
# But this asset's mountains are ~73 units tall and ring the whole perimeter, so at
# the 30.8deg sun their shadows are ~122 units long (wider than the 108-unit island)
# and MERGE into one flat mid-gray slab blanketing the entire outer terrain — a heavy
# frame, not per-cluster streaks. So they are DROPPED (the spec's sanctioned
# fallback: "trees/rocks alone already satisfy the brief"). The tree/rock clusters
# already throw clean directional streaks + contact-AO across the clearing floor.
# Flip INCLUDE_MOUNTAIN_SHADOWS back to True to re-trial them.
MOUNTAIN_RE = re.compile(r"mountain", re.IGNORECASE)
INCLUDE_MOUNTAIN_SHADOWS = False
# The decimated LOD sibling meshes ride at the origin — exclude them or they blot
# the central clearing (catastrophic: the board area must be WHITE).
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


def opaque_diffuse(name, color):
    """A plain OPAQUE diffuse material (kills any leaf-alpha so shadows stay solid
    and readable, not dappled mush)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out_node = nt.nodes.new("ShaderNodeOutputMaterial")
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    dif.inputs["Color"].default_value = color
    dif.inputs["Roughness"].default_value = 1.0
    nt.links.new(dif.outputs["BSDF"], out_node.inputs["Surface"])
    return mat


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
    #    (Z-up) the horizontal plane is X-Y; Z is vertical. UNCHANGED from the
    #    coverage bake so islandMin/islandSize (the runtime AO_ISLAND_* constants)
    #    stay byte-identical.
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

    # 3) Split the non-LOD meshes into shadow casters (trees/rocks + mountains) and
    #    everything else (floor tiles + ground clutter) which is deleted — the white
    #    RECEIVER plane replaces the floor, and clutter would just noise up the map.
    occluders = []   # trees / birch / rocks — cast shadow AND occlude sky (AO)
    mountains = []   # shadow-only casters (only kept if INCLUDE_MOUNTAIN_SHADOWS)
    dropped = 0
    for o in list(non_lod):
        if OCCLUDER_RE.search(o.name):
            occluders.append(o)
        elif MOUNTAIN_RE.search(o.name) and INCLUDE_MOUNTAIN_SHADOWS:
            mountains.append(o)
        else:
            bpy.data.objects.remove(o, do_unlink=True)
            dropped += 1
    print(f"[bake_forest_ao] casters: occluders(tree/birch/rock)={len(occluders)} "
          f"mountains(shadow-only)={len(mountains)}  dropped(floor/clutter/mtn)={dropped}  "
          f"LOD dropped={lod_dropped}")
    if not occluders:
        raise SystemExit("bake_forest_ao: no occluder meshes matched — check names")

    # 4) Occluder foot level = min bound_box Z over the trees/rocks (the CONTACT
    #    occluders; the ground they stand on). The receiver sits a hair below it so
    #    tree/rock bases contact their own cast shadow + AO. (Mountains are excluded
    #    from this min: they are far taller / their feet dip lower and would drop the
    #    receiver away from the tree feet.)
    foot_z = min(
        (o.matrix_world @ mathutils.Vector(c))[2]
        for o in occluders for c in o.bound_box
    )
    receiver_z = foot_z - RECEIVER_DROP
    print(f"[bake_forest_ao] occluder foot Z={foot_z:.2f} → receiver Z={receiver_z:.2f}")

    scene = bpy.context.scene

    # 5) Casters: opaque diffuse (solid shadows), NOT camera-visible. Trees/rocks
    #    also occlude the sky (visible_diffuse) for contact-AO; mountains are
    #    shadow-only (no AO halo / no drawn footprint).
    occ_mat = opaque_diffuse("forest_ao_occluder", (0.5, 0.5, 0.5, 1.0))
    for o in occluders:
        o.data.materials.clear()
        o.data.materials.append(occ_mat)
        o.visible_camera = False
        o.visible_shadow = True
        o.visible_diffuse = True
        o.visible_glossy = True
    for o in mountains:
        o.data.materials.clear()
        o.data.materials.append(occ_mat)
        o.visible_camera = False
        o.visible_shadow = True
        o.visible_diffuse = False
        o.visible_glossy = False

    # 6) White RECEIVER plane (replaces the deleted floor as the shadow catcher) —
    #    the ONLY camera-visible object. Plain white Lambertian; sun + white sky
    #    light it, the casters shadow it.
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(bcenter[0], bcenter[1], receiver_z))
    receiver = bpy.context.active_object
    receiver.scale = (bsize[0] * RECEIVER_MARGIN, bsize[1] * RECEIVER_MARGIN, 1.0)
    receiver.data.materials.append(opaque_diffuse("forest_ao_receiver", (1.0, 1.0, 1.0, 1.0)))
    receiver.visible_camera = True

    # 7) Directional SUN — the cast-shadow source (direction = MOBILE_KEY_POSITION).
    sun_data = bpy.data.lights.new("forest_ao_sun", type="SUN")
    sun_data.energy = SUN_ENERGY
    sun_data.angle = SUN_ANGLE
    sun_obj = bpy.data.objects.new("forest_ao_sun", sun_data)
    scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = SUN_DIR.to_track_quat("-Z", "Y").to_euler()  # local -Z along the ray
    print(f"[bake_forest_ao] sun dir(Blender)={[round(v,3) for v in SUN_DIR.normalized()]} "
          f"elev={math.degrees(math.asin(abs(SUN_DIR.normalized().z))):.1f}deg "
          f"energy={SUN_ENERGY} angle={math.degrees(SUN_ANGLE):.1f}deg")

    # 8) White world = uniform AMBIENT sky (rays that MISS geometry → white/open) AND
    #    the term the canopy occludes into contact-AO. Strength vs sun sets shadow
    #    darkness (final white point normalized in the runner).
    world = bpy.data.worlds.new("forest_ao_world")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = WORLD_STRENGTH

    # 9) Orthographic TOP-DOWN camera framing the full Blender X-Y box exactly
    #    (UNCHANGED from the coverage bake → identical world→UV mapping).
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

    # 10) Cycles: DIRECT sun + DIRECT white-sky sampling yields shadow + AO at 0
    #     bounces (no GI needed); denoise the stochastic soft shadow / AO. Standard
    #     view transform (no AgX/Filmic crush) so luminance maps ~linearly to 8-bit.
    scene.render.engine = "CYCLES"
    try:
        scene.cycles.device = "CPU"
    except Exception:
        pass
    scene.cycles.samples = CYCLES_SAMPLES
    try:
        scene.cycles.use_denoising = True
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    try:
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

    print(f"[bake_forest_ao] rendering top-down shadow+AO {res_x}x{res_y} "
          f"(ortho_scale={cam_data.ortho_scale:.1f}, {CYCLES_SAMPLES} samples, denoised) ...")
    bpy.ops.render.render(write_still=True)
    print(f"[bake_forest_ao] wrote {out_png} ({os.path.getsize(out_png)/1024:.1f} KB)")

    # 11) Derive three-space size/center + world islandMin/islandSize and save meta.
    #     glTF (three) is Y-up; import maps three (x,y,z) -> Blender (x,-z,y), so:
    #     three.x = Blender.x ; three.z = -Blender.y ; three.y(up) = Blender.z.
    #     UNCHANGED from the coverage bake.
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
        # Render content (mapping constants above are UNCHANGED; only the pixels are):
        "render_kind": "directional sun cast shadows + contact-AO (white receiver)",
        "sun_dir_blender": [round(v, 5) for v in SUN_DIR.normalized()],
        "sun_elev_deg": round(math.degrees(math.asin(abs(SUN_DIR.normalized().z))), 2),
        "shadow_falls_toward": "image UPPER-LEFT = world (-X,-Z) (matches board/city KEY)",
        "shadow_casters": (["tree", "birch", "rock"] +
                           (["mountain (shadow-only)"] if INCLUDE_MOUNTAIN_SHADOWS else [])),
        "excluded": (["meadow/path/lake floor (→ white receiver)", "grass/flowers/mushrooms", "_LOD1/_LOD2"] +
                     ([] if INCLUDE_MOUNTAIN_SHADOWS else ["mountains (perimeter shadow slab too heavy)"])),
    }
    with open(out_meta, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"[bake_forest_ao] meta -> {out_meta}")
    print(f"[bake_forest_ao] islandSize(world)={island_size_world} "
          f"islandMin(world)={island_min_world} groupScale={group_scale:.6f}")
    print("[bake_forest_ao] done.")


if __name__ == "__main__":
    main()
