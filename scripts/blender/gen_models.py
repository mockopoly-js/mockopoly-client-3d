"""
Headless Blender asset pipeline for mockopoly-client-3d.

Builds a stylized toy top-hat token (Monopoly-GO look) as a single merged,
smooth low-poly mesh and exports it to public/models/token-tophat.glb.

This REPLACES the old three.js geometry generator (scripts/gen-models.mjs).
The client loading path (src/board/TophatModel.tsx) is unchanged: it loads
'/models/token-tophat.glb', reads the first mesh, and hangs a
`vertexColors: true` MeshStandardMaterial on it. So this script bakes a
COLOR_0 vertex-color attribute (matching HAT_COLOR) in addition to a real
glTF material, and exports with +Y up, modifiers applied, at the same
scale / origin / orientation the component expects:

    footprint radius ~0.32   (brim diameter ~0.64)
    total height     ~0.65
    base rests at local y = 0 (sits on the tile)

Run headless:
    /Applications/Blender.app/Contents/MacOS/Blender \
        --background --python scripts/blender/gen_models.py

Tested against Blender 5.2.0 LTS (bundled Python 3.13, io_scene_gltf2 addon).

Blender 5.x API notes (differs from 4.0 and earlier):
  * Mesh.use_auto_smooth was REMOVED (4.1+). Auto-smooth is now an operator:
    bpy.ops.object.shade_auto_smooth(use_auto_smooth=True, angle=<rad>).
  * Vertex colors live under Mesh.color_attributes (not Mesh.vertex_colors,
    though the old alias still exists). We create a FLOAT_COLOR / POINT
    attribute and mark it active so the glTF exporter emits COLOR_0.
  * export_scene.gltf's export_vertex_color is an ENUM
    ['MATERIAL','ACTIVE','NAME','NONE'] (was a bool in 4.x). We use 'ACTIVE'.
"""

import math
import os

import bmesh
import bpy
from mathutils import Vector

# --------------------------------------------------------------------------- #
# Parameters
# --------------------------------------------------------------------------- #

# Hat color. Module-level constant so 8 player-color variants can be injected
# later (e.g. loop over a palette and call build_tophat(color=...) + export).
# Default: near-black charcoal. Linear-ish RGB in 0..1 (glTF/Blender are linear).
HAT_COLOR = (0.055, 0.055, 0.070)  # charcoal

# Target output relative to the project root (two levels up from this file:
# scripts/blender/gen_models.py -> project root).
_PROJECT_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), os.pardir, os.pardir)
)
OUTPUT_PATH = os.path.join(_PROJECT_ROOT, "public", "models", "token-tophat.glb")

# Geometry dimensions (Blender units == meters == three.js units).
# Chosen to match the footprint/height the existing GLB used so the model
# drops into TophatModel.tsx (scale=3, position=[0,0.15,0]) without edits.
BRIM_RADIUS = 0.320  # outer brim radius  -> diameter 0.64
BRIM_HEIGHT = 0.045  # brim slab thickness
CROWN_BOTTOM_R = 0.210  # crown radius where it meets the brim
CROWN_TOP_R = 0.185  # crown radius at the top (slight taper -> toy look)
CROWN_HEIGHT = 0.560  # crown height (brim top .. crown top)
BAND_RADIUS_EXTRA = 0.012  # how far the band bulges past the crown
BAND_BOTTOM = 0.075  # band lower edge, measured from brim top
BAND_TOP = 0.150  # band upper edge, measured from brim top

RADIAL_SEGMENTS = 24  # ring resolution; kept modest for a low tri budget

# Modifier settings for the smooth toy look.
BEVEL_WIDTH = 0.018
BEVEL_SEGMENTS = 2
SUBSURF_LEVELS = 1
SMOOTH_ANGLE = math.radians(40.0)


# --------------------------------------------------------------------------- #
# Scene helpers
# --------------------------------------------------------------------------- #

def reset_scene() -> None:
    """Wipe everything so the script is idempotent across runs."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.objects,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(coll):
            coll.remove(datablock)


def _add_ring(bm: bmesh.types.BMesh, radius: float, z: float, segments: int):
    """Return a list of new verts forming a horizontal ring at height z."""
    verts = []
    for i in range(segments):
        a = (2.0 * math.pi) * (i / segments)
        verts.append(
            bm.verts.new((radius * math.cos(a), radius * math.sin(a), z))
        )
    return verts


def _bridge(bm: bmesh.types.BMesh, lower, upper) -> None:
    """Connect two equal-length rings with a strip of quads."""
    n = len(lower)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lower[i], lower[j], upper[j], upper[i]))


def _cap(bm: bmesh.types.BMesh, ring, z: float, flip: bool = False):
    """Close a ring with a center vertex fan. Returns the fan of new faces."""
    n = len(ring)
    center = bm.verts.new((0.0, 0.0, z))
    faces = []
    for i in range(n):
        j = (i + 1) % n
        tri = (center, ring[i], ring[j])
        if flip:
            tri = (center, ring[j], ring[i])
        faces.append(bm.faces.new(tri))
    return faces


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #

def build_tophat(color=HAT_COLOR) -> bpy.types.Object:
    """
    Build the stylized top-hat as a single merged mesh with its base at z=0.

    Profile (bottom -> top), all one watertight surface:
        brim bottom disc  (z=0)
        brim outer wall   (0 .. BRIM_HEIGHT)
        brim top annulus  (outer -> crown_bottom radius, at BRIM_HEIGHT)
        crown wall        (BRIM_HEIGHT .. BRIM_HEIGHT + CROWN_HEIGHT),
                          bulging out over [BAND_BOTTOM, BAND_TOP] to form a band
        crown top disc    (top)
    """
    seg = RADIAL_SEGMENTS
    bm = bmesh.new()

    z_brim_top = BRIM_HEIGHT
    z_crown_top = BRIM_HEIGHT + CROWN_HEIGHT

    # --- brim: bottom disc + outer wall ---
    brim_bottom_ring = _add_ring(bm, BRIM_RADIUS, 0.0, seg)
    brim_top_ring = _add_ring(bm, BRIM_RADIUS, z_brim_top, seg)
    _cap(bm, brim_bottom_ring, 0.0, flip=True)  # bottom faces downward
    _bridge(bm, brim_bottom_ring, brim_top_ring)  # outer brim wall

    # --- brim top annulus: brim outer edge -> crown base ---
    crown_base_ring = _add_ring(bm, CROWN_BOTTOM_R, z_brim_top, seg)
    _bridge(bm, brim_top_ring, crown_base_ring)  # flat brim top ring

    # --- crown wall with a raised band ---
    # Sample the crown along z; at each level compute a radius that linearly
    # tapers CROWN_BOTTOM_R -> CROWN_TOP_R, plus a bump over the band range.
    band_lo = z_brim_top + BAND_BOTTOM
    band_hi = z_brim_top + BAND_TOP
    levels = [
        z_brim_top,
        band_lo,
        (band_lo + band_hi) * 0.5,
        band_hi,
        z_crown_top,
    ]

    def crown_radius(z: float) -> float:
        t = (z - z_brim_top) / CROWN_HEIGHT
        base_r = CROWN_BOTTOM_R + (CROWN_TOP_R - CROWN_BOTTOM_R) * t
        if band_lo <= z <= band_hi:
            base_r += BAND_RADIUS_EXTRA
        return base_r

    prev_ring = crown_base_ring
    for z in levels[1:]:
        ring = _add_ring(bm, crown_radius(z), z, seg)
        _bridge(bm, prev_ring, ring)
        prev_ring = ring

    # --- crown top disc ---
    _cap(bm, prev_ring, z_crown_top, flip=False)  # top faces upward

    # Merge coincident verts (the shared rings already reuse verts, but this
    # guarantees a single watertight, welded mesh) and recompute normals.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new("TophatMesh")
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Tophat", mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    _apply_material_and_colors(obj, color)
    _apply_smooth_modifiers(obj)

    return obj


# --------------------------------------------------------------------------- #
# Look: material, vertex colors, modifiers
# --------------------------------------------------------------------------- #

def _apply_material_and_colors(obj: bpy.types.Object, color) -> None:
    """
    Give the hat a real glTF Principled material AND a baked COLOR_0
    vertex-color attribute (both set to `color`).

    TophatModel.tsx builds its own `vertexColors: true` MeshStandardMaterial
    and multiplies it by a `tint`, so the COLOR_0 stream is what actually
    shows in the client. We keep a proper material too so the .glb is valid /
    previews correctly in other tools.
    """
    mesh = obj.data
    r, g, b = color
    rgba = (r, g, b, 1.0)

    # Real material (Principled BSDF).
    mat = bpy.data.materials.new(name="TophatMaterial")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.55
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.0
    mesh.materials.append(mat)

    # Baked vertex colors on the POINT domain -> exported as COLOR_0.
    # (Blender 5.x: Mesh.color_attributes, FLOAT_COLOR type.)
    ca = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for datum in ca.data:
        datum.color = rgba
    mesh.color_attributes.active_color = ca
    mesh.color_attributes.render_color_index = mesh.color_attributes.find(ca.name)


def _apply_smooth_modifiers(obj: bpy.types.Object) -> None:
    """Bevel sharp edges + subsurf + auto-smooth for the rounded toy look."""
    bpy.context.view_layer.objects.active = obj

    bevel = obj.modifiers.new(name="Bevel", type="BEVEL")
    bevel.width = BEVEL_WIDTH
    bevel.segments = BEVEL_SEGMENTS
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(30.0)

    subsurf = obj.modifiers.new(name="Subsurf", type="SUBSURF")
    subsurf.levels = SUBSURF_LEVELS
    subsurf.render_levels = SUBSURF_LEVELS

    # Smooth shading. shade_auto_smooth replaces the removed
    # Mesh.use_auto_smooth flag in Blender 4.1+/5.x.
    bpy.ops.object.shade_smooth()
    bpy.ops.object.shade_auto_smooth(use_auto_smooth=True, angle=SMOOTH_ANGLE)


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #

def export_glb(obj: bpy.types.Object, path: str) -> None:
    """Export the single object as a binary .glb (+Y up, modifiers applied)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)

    # Select only the hat so use_selection gives us exactly one node.
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,  # apply Bevel + Subsurf modifiers
        export_yup=True,  # +Y up (three.js convention)
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",  # emit the active COLOR_0 stream
        export_active_vertex_color_when_no_material=True,
    )


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main() -> None:
    reset_scene()
    hat = build_tophat(HAT_COLOR)
    export_glb(hat, OUTPUT_PATH)
    print(f"[gen_models] exported top-hat -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
