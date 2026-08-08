"""
bake_city_ao.py — headless Blender: bake a subtle contact-AO lightmap for the
MOBILE city variant (`public/models/city.mobile.glb`).

WHY: the mobile city is a merged, atlas-textured draco mesh with a heavily
tiled/overlapping atlas UV0 (many buildings reuse the same atlas cells), so it
carries NO usable second UV set for a lightmap. This script imports the mobile
glb, throws away the CARS mesh (keeps its COLOR_0 pristine — cars never enter
Blender), generates a fresh NON-OVERLAPPING lightmap UV (→ TEXCOORD_1) on the
BUILDINGS mesh only, bakes bounded ambient occlusion in Cycles, saves the AO
PNG, and re-exports a buildings-only glb that carries
POSITION/NORMAL/TEXCOORD_0(atlas)/TEXCOORD_1(lightmap). The reassembly step
(scripts/gen-city-mobile-ao.mjs) swaps that geometry back into the ORIGINAL
draco glb (keeping the untouched cars + shared material + atlas) and compresses
the AO map. Nothing here touches the desktop city.glb.

The bake is purely GEOMETRIC (no world/sun) — at runtime three multiplies aoMap
into indirect/ambient only, so a neutral occlusion map is exactly right: it adds
contact shadows + depth without fighting the real-time daylight sun.

Invoked by scripts/gen-city-mobile-ao.mjs (or standalone):
    blender --background --python scripts/blender/bake_city_ao.py -- \
        <in.glb> <out_ao.png> <out_buildings.glb>

Defaults (when no `--` args) resolve relative to the repo root so the script can
be run standalone for iteration.

Tested against Blender 5.2.0 LTS (bundled Python 3.13, io_scene_gltf2 addon,
native draco decode).
"""
import os
import sys

import bpy

# ── Tunables ────────────────────────────────────────────────────────────────
AO_RES = 1024            # lightmap resolution (px), overridable via the 4th CLI
                         # arg. 1024 chosen for the MOBILE budget: this is a
                         # per-face lightmap (lightmap_pack ALL_FACES → ~91%
                         # coverage, ~3 texels/face) carrying a SUBTLE, indirect-
                         # only occlusion, so 1024 (KTX2 ~1 MB / ~1 MB VRAM) is
                         # ample. 2048 (pass `... 2048`) quadruples texture size
                         # (~3.5 MB KTX2) for little visible gain on a low-freq map
                         # — inconsistent with why the mobile variant exists.
AO_DISTANCE = 1.0        # AO ray length (model units). The MOBILE city is a
                         # tightly MERGED mesh whose building gaps/streets are
                         # under ~2 units wide, so a longer ray spreads occlusion
                         # far past real crevices: Distance=2.0 over-darkened the
                         # BUILDINGS surface itself (measured at the TEXCOORD_1
                         # sample points, not just the gutter: mean 0.46, ~22%
                         # near-black), reading as a grimy/dingy city on sun-
                         # averted faces where indirect dominates. Distance=10 was
                         # worse still (~0.2 median). 1.0 keeps occlusion in the
                         # genuine base-of-building/narrow-crevice contacts: it
                         # lifts the measured buildings-surface mean 0.46->0.53 and
                         # near-black ~22%->~16%. It can't lift the FULLY-ENCLOSED
                         # interiors/undersides (surrounded within <1 unit → still
                         # ~0 at any distance); that floor is raised at RUNTIME by
                         # the lower aoMapIntensity (0.5 → deepest crevices retain
                         # 50% indirect, avg ~76%), so distance + intensity together
                         # land a SUBTLE map. See CITY_AO_INTENSITY in CityDressing.
AO_NODE_SAMPLES = 16     # occlusion rays per shader eval (AO node internal).
CYCLES_SAMPLES = 64      # render samples on top (× AO_NODE_SAMPLES rays/texel).
BAKE_MARGIN = 6          # px dilation — bleeds island edges outward to kill seam
                         # halos under mip filtering.
# UV: smart_project catastrophically fails on this MERGED city mesh — one
# degenerate giant island forces every other island sub-pixel → ~0.1% rasterized
# coverage (verified; average_islands_scale does not rescue it). lightmap_pack
# (per-face box unwrap) packs the whole mesh evenly → ~91% coverage at
# MARGIN_DIV=0.3, which is what a low-frequency occlusion map wants.
LIGHTMAP_MARGIN_DIV = 0.3  # lightmap_pack margin divisor (higher = tighter/more
                           # coverage; 0.3 leaves gutter room for the bake margin).


def repo_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def parse_args():
    root = repo_root()
    defaults = [
        os.path.join(root, "public/models/city.mobile.glb"),
        os.path.join(root, "scratch_citymobile_ao.png"),
        os.path.join(root, "scratch_city.mobile.buildings.uv2.glb"),
    ]
    if "--" in sys.argv:
        tail = sys.argv[sys.argv.index("--") + 1:]
    else:
        tail = []
    args = list(tail) + defaults[len(tail):]
    res = int(args[3]) if len(args) > 3 else AO_RES
    return args[0], args[1], args[2], res


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def run_uv_op(op, **kwargs):
    """Run a uv operator headless. In --background there is no VIEW_3D area, so
    fall back to a temp_override across any available window/area if the direct
    call rejects the context."""
    try:
        return op(**kwargs)
    except RuntimeError as e:
        wm = bpy.context.window_manager
        for win in wm.windows:
            scr = win.screen
            for area in scr.areas:
                try:
                    with bpy.context.temp_override(window=win, area=area, region=area.regions[-1]):
                        return op(**kwargs)
                except RuntimeError:
                    continue
        raise e


def pick_buildings():
    """Return the BUILDINGS mesh object; delete every other mesh object (the
    CARS mesh). Guard by vertex count + COLOR_0 presence, not name: buildings
    (~315k verts, no COLOR_0) ≫ cars (~32k verts, has COLOR_0)."""
    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    if not mesh_objs:
        raise SystemExit("bake_city_ao: no mesh objects imported")
    buildings = max(mesh_objs, key=lambda o: len(o.data.vertices))
    for o in list(mesh_objs):
        if o is buildings:
            continue
        has_color = len(o.data.color_attributes) > 0
        print(f"[bake_city_ao] deleting '{o.name}' "
              f"({len(o.data.vertices)} verts, COLOR_0={has_color}) — cars, excluded from AO")
        bpy.data.objects.remove(o, do_unlink=True)
    if len(buildings.data.color_attributes) > 0:
        print("[bake_city_ao] WARNING: buildings mesh carries a color attribute "
              "(unexpected) — proceeding anyway")
    print(f"[bake_city_ao] buildings: '{buildings.name}' "
          f"({len(buildings.data.vertices)} verts, {len(buildings.data.polygons)} faces)")
    return buildings


def make_lightmap_uv(obj):
    """Create a fresh non-overlapping 'Lightmap' UV (becomes uv index 1 →
    exports as TEXCOORD_1; the existing atlas UV stays index 0 → TEXCOORD_0).

    IDEMPOTENCY (re-run safety): the reassembly step reads TEXCOORD_1 as the
    lightmap, so the fresh Lightmap MUST land at uv index 1. A plain mobile glb
    imports with one UV (UVMap → index 0), but a glb that ALREADY carries a baked
    lightmap (i.e. re-running this pass on its own output) imports with TWO UVs
    (UVMap + a stale UVMap.001), which would push a newly-created Lightmap to
    index 2 (→ TEXCOORD_2) — a layer the reassembly IGNORES while it pairs the
    fresh bake with the STALE index-1 UV, scrambling the AO. So strip EVERY UV
    layer except the first (the atlas UVMap → TEXCOORD_0) before creating
    Lightmap: it is then guaranteed to be index 1 regardless of how many baked
    lightmaps the input already had.

    NOTE: normals are LEFT AS-IS (no normals_make_consistent). The reassembly
    step takes the exported NORMAL attribute from this mesh, so recalculating
    normals here would change the mobile city's real-time shading — not allowed.
    The runtime renders FrontSide cleanly, so the imported normals are already
    correct for the AO hemisphere too."""
    me = obj.data
    # Keep only uv index 0 (atlas UVMap → TEXCOORD_0); drop any stale extra UV
    # layers so the new Lightmap is guaranteed to become index 1 (→ TEXCOORD_1).
    while len(me.uv_layers) > 1:
        stale = me.uv_layers[len(me.uv_layers) - 1]
        print(f"[bake_city_ao] dropping stale UV layer '{stale.name}' "
              f"(idempotency: lightmap must land at uv index 1 / TEXCOORD_1)")
        me.uv_layers.remove(stale)
    lm = me.uv_layers.new(name="Lightmap")
    # Make Lightmap the active + active_render UV so the unwrap writes into it and
    # Cycles rasterizes the bake into its layout.
    me.uv_layers.active = lm
    lm.active_render = True
    print(f"[bake_city_ao] uv layers (order = TEXCOORD index): "
          f"{[l.name for l in me.uv_layers]} (active_render='Lightmap')")

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    # Re-assert active UV inside edit mode (op target).
    me.uv_layers.active = me.uv_layers["Lightmap"]
    # lightmap_pack (per-face box unwrap) — the ONLY method that packs this merged
    # 165k-face mesh evenly. smart_project yields ~0.1% coverage here (one giant
    # degenerate island); lightmap_pack yields ~91% at MARGIN_DIV=0.3.
    run_uv_op(bpy.ops.uv.lightmap_pack,
              PREF_CONTEXT="ALL_FACES",
              PREF_MARGIN_DIV=LIGHTMAP_MARGIN_DIV)
    bpy.ops.object.mode_set(mode="OBJECT")
    # Re-assert after mode switch.
    me.uv_layers.active = me.uv_layers["Lightmap"]
    me.uv_layers["Lightmap"].active_render = True
    _log_uv_stats(me, "Lightmap")


def _log_uv_stats(me, name):
    """Log the lightmap UV bounding box + occupancy so packing failures are
    visible (islands should roughly fill [0,1])."""
    import numpy as np
    uvl = me.uv_layers[name]
    n = len(uvl.data)
    arr = np.empty(n * 2, dtype=np.float32)
    uvl.data.foreach_get("uv", arr)
    u = arr[0::2]
    v = arr[1::2]
    # coarse occupancy: fraction of a 128x128 grid touched by any uv sample
    G = 128
    gi = np.clip((u * G).astype(np.int32), 0, G - 1)
    gj = np.clip((v * G).astype(np.int32), 0, G - 1)
    touched = np.zeros(G * G, dtype=bool)
    touched[gj * G + gi] = True
    print(f"[bake_city_ao] lightmap UV bbox: u[{u.min():.3f}..{u.max():.3f}] "
          f"v[{v.min():.3f}..{v.max():.3f}] loops={n} "
          f"grid-occupancy≈{touched.mean()*100:.1f}%")


def setup_ao_material(obj, ao_img):
    """Wire the buildings material to EMIT its bounded ambient occlusion, and add
    the (disconnected, selected/active) image-texture bake target. Returns the
    bake-target node. The material content is irrelevant post-bake — the reexport
    uses export_materials='NONE' and the reassembly keeps the ORIGINAL material —
    so we can freely repurpose it as the AO source."""
    if not obj.data.materials:
        raise SystemExit("bake_city_ao: buildings mesh has no material")
    mat = obj.data.materials[0]
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    emit = nodes.new("ShaderNodeEmission")
    emit.location = (400, 0)
    emit.inputs["Strength"].default_value = 1.0
    ao = nodes.new("ShaderNodeAmbientOcclusion")
    ao.location = (150, 0)
    ao.samples = AO_NODE_SAMPLES
    ao.inside = False
    ao.only_local = True
    ao.inputs["Distance"].default_value = AO_DISTANCE
    # White Color input → Color output == pure AO factor (grayscale, R=G=B).
    ao.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    links.new(ao.outputs["Color"], emit.inputs["Color"])
    links.new(emit.outputs["Emission"], out.inputs["Surface"])

    # Bake target: unconnected image-texture node, made active + selected.
    tex = nodes.new("ShaderNodeTexImage")
    tex.location = (150, -300)
    tex.image = ao_img
    tex.select = True
    nodes.active = tex
    return tex


def main():
    in_glb, out_png, out_glb, ao_res = parse_args()
    if not os.path.isfile(in_glb):
        raise SystemExit(f"bake_city_ao: input not found: {in_glb}")
    for p in (out_png, out_glb):
        d = os.path.dirname(p)
        if d:
            os.makedirs(d, exist_ok=True)

    clear_scene()

    print(f"[bake_city_ao] importing {in_glb}")
    bpy.ops.import_scene.gltf(filepath=in_glb)

    buildings = pick_buildings()
    make_lightmap_uv(buildings)

    # AO destination image — Non-Color (linear) so the baked occlusion is not
    # gamma-mangled; three reads .r and multiplies indirect light.
    ao_img = bpy.data.images.new("citymobile_ao", ao_res, ao_res, alpha=False, float_buffer=False)
    ao_img.colorspace_settings.name = "Non-Color"

    setup_ao_material(buildings, ao_img)

    # ── Cycles bake setup ────────────────────────────────────────────────────
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    try:
        scene.cycles.device = "CPU"  # deterministic headless
    except Exception:
        pass
    scene.cycles.samples = CYCLES_SAMPLES
    try:
        scene.cycles.use_denoising = True
    except Exception:
        pass
    scene.render.bake.margin = BAKE_MARGIN
    scene.render.bake.use_clear = True
    scene.render.bake.use_selected_to_active = False

    bpy.ops.object.select_all(action="DESELECT")
    buildings.select_set(True)
    bpy.context.view_layer.objects.active = buildings

    print(f"[bake_city_ao] baking EMIT (bounded AO, dist={AO_DISTANCE}, "
          f"{CYCLES_SAMPLES}x{AO_NODE_SAMPLES} rays/texel) into {ao_res}x{ao_res} ...")
    bpy.ops.object.bake(type="EMIT", use_selected_to_active=False, margin=BAKE_MARGIN, use_clear=True)

    # ── Save AO PNG ──────────────────────────────────────────────────────────
    ao_img.filepath_raw = out_png
    ao_img.file_format = "PNG"
    ao_img.save()
    print(f"[bake_city_ao] saved AO -> {out_png} ({os.path.getsize(out_png)/1024:.1f} KB)")

    # Quick sanity: report mean/min/max of the baked pixels (catch all-black /
    # all-white bakes). Sample a stride for speed.
    px = ao_img.pixels[:]  # RGBA flat, linear floats
    n = len(px) // 4
    stride = max(1, n // 40000)
    vals = [px[i * 4] for i in range(0, n, stride)]
    mn = min(vals)
    mx = max(vals)
    mean = sum(vals) / len(vals)
    print(f"[bake_city_ao] AO stats (R, linear): min={mn:.3f} mean={mean:.3f} max={mx:.3f} "
          f"(sampled {len(vals)} texels)")

    # ── Export buildings-only glb carrying TEXCOORD_0 + TEXCOORD_1 ───────────
    # UNcompressed (gltf-transform owns draco). export_materials='NONE' keeps the
    # scratch glb lean — TEXCOORD_1 export depends only on uv_layers count, not on
    # material references (verified in io_scene_gltf2 primitive_extract.py).
    bpy.ops.object.select_all(action="DESELECT")
    buildings.select_set(True)
    bpy.context.view_layer.objects.active = buildings
    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format="GLB",
        use_selection=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="NONE",
        export_draco_mesh_compression_enable=False,
        export_yup=True,
        export_apply=False,
    )
    print(f"[bake_city_ao] exported buildings glb -> {out_glb} "
          f"({os.path.getsize(out_glb)/1024/1024:.2f} MB)")
    print("[bake_city_ao] done.")


if __name__ == "__main__":
    main()
