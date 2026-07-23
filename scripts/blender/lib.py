"""
Shared headless-Blender helpers for the mockopoly-client-3d asset pipeline.

Every category generator (gen_tokens.py, gen_buildings.py, gen_city.py) imports
this module for scene setup, bmesh primitives, vertex-color/material baking,
smooth-look modifiers, and .glb export.

Import from a sibling script with:

    import os, sys
    sys.path.append(os.path.dirname(__file__))
    import lib

Tested against Blender 5.2.0 LTS (bundled Python 3.13, io_scene_gltf2 addon).

Blender 5.x API notes (differ from 4.0 and earlier — this codebase targets 5.x):
  * Mesh.use_auto_smooth was REMOVED (4.1+). Auto-smooth is now an operator:
    bpy.ops.object.shade_auto_smooth(use_auto_smooth=True, angle=<rad>).
  * Vertex colors live under Mesh.color_attributes (not Mesh.vertex_colors).
    We create a FLOAT_COLOR / POINT attribute and mark it active so the glTF
    exporter emits COLOR_0.
  * export_scene.gltf's export_vertex_color is an ENUM
    ['MATERIAL','ACTIVE','NAME','NONE'] (was a bool in 4.x). We use 'ACTIVE'.
"""

import math
import os

import bmesh
import bpy

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #

# scripts/blender/lib.py -> project root is two levels up.
PROJECT_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), os.pardir, os.pardir)
)
MODELS_DIR = os.path.join(PROJECT_ROOT, "public", "models")


def model_path(*parts: str) -> str:
    """Absolute path under public/models/, e.g. model_path('tokens', 'car.glb')."""
    return os.path.join(MODELS_DIR, *parts)


# --------------------------------------------------------------------------- #
# Scene helpers
# --------------------------------------------------------------------------- #

def reset_scene() -> None:
    """Wipe everything so a script run is idempotent."""
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


# --------------------------------------------------------------------------- #
# bmesh primitives
# --------------------------------------------------------------------------- #

def add_ring(bm: bmesh.types.BMesh, radius: float, z: float, segments: int):
    """Return a list of new verts forming a horizontal ring at height z."""
    verts = []
    for i in range(segments):
        a = (2.0 * math.pi) * (i / segments)
        verts.append(
            bm.verts.new((radius * math.cos(a), radius * math.sin(a), z))
        )
    return verts


def bridge(bm: bmesh.types.BMesh, lower, upper) -> None:
    """Connect two equal-length rings with a strip of quads."""
    n = len(lower)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lower[i], lower[j], upper[j], upper[i]))


def cap(bm: bmesh.types.BMesh, ring, z: float, flip: bool = False):
    """Close a ring with a center-vertex fan. Returns the new faces."""
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


def finalize_bmesh(bm: bmesh.types.BMesh, name: str) -> bpy.types.Object:
    """
    Weld coincident verts, recompute normals, turn a bmesh into a linked,
    active+selected object, and return it. Common tail of every builder.
    """
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    return obj


# --------------------------------------------------------------------------- #
# Look: material + vertex colors
# --------------------------------------------------------------------------- #

def apply_material_and_colors(obj: bpy.types.Object, color) -> None:
    """
    Give `obj` a real glTF Principled material AND a baked COLOR_0 vertex-color
    attribute, so the client's `vertexColors: true` MeshStandardMaterial shows
    the baked color and the .glb also previews correctly in other tools.

    `color` may be either:
      * a single (r, g, b) tuple  -> uniform COLOR_0 across all vertices, and
        the material base color is set to it; or
      * a callable  fn(co) -> (r, g, b)  where `co` is a mathutils.Vector of the
        vertex local position -> per-region COLOR_0 (multi-color bake). The
        material base color is left white (0.8 default) since color comes from
        the vertex stream.

    All RGB values are linear 0..1 (glTF/Blender are linear).
    """
    mesh = obj.data
    per_vertex = callable(color)

    # --- Real Principled material ---
    mat = bpy.data.materials.new(name=f"{obj.name}Material")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        if not per_vertex:
            r, g, b = color
            bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.55
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.0
    mesh.materials.append(mat)

    # --- Baked vertex colors on the POINT domain -> exported as COLOR_0 ---
    ca = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    if per_vertex:
        # POINT domain: one datum per mesh vertex, in vertex order.
        for i, vert in enumerate(mesh.vertices):
            r, g, b = color(vert.co)
            ca.data[i].color = (r, g, b, 1.0)
    else:
        r, g, b = color
        rgba = (r, g, b, 1.0)
        for datum in ca.data:
            datum.color = rgba
    mesh.color_attributes.active_color = ca
    mesh.color_attributes.render_color_index = mesh.color_attributes.find(ca.name)


# --------------------------------------------------------------------------- #
# Look: smoothing modifiers
# --------------------------------------------------------------------------- #

def apply_smooth_modifiers(
    obj: bpy.types.Object,
    bevel_width: float = 0.018,
    bevel_segments: int = 2,
    subsurf_levels: int = 1,
    smooth_angle_deg: float = 40.0,
    bevel_angle_deg: float = 30.0,
) -> None:
    """
    Bevel sharp edges + subsurf + auto-smooth for the rounded low-poly toy look.
    Modifiers are left unapplied on the object; export_glb bakes them (export_apply).
    """
    bpy.context.view_layer.objects.active = obj

    if bevel_width > 0.0:
        bevel = obj.modifiers.new(name="Bevel", type="BEVEL")
        bevel.width = bevel_width
        bevel.segments = bevel_segments
        bevel.limit_method = "ANGLE"
        bevel.angle_limit = math.radians(bevel_angle_deg)

    if subsurf_levels > 0:
        subsurf = obj.modifiers.new(name="Subsurf", type="SUBSURF")
        subsurf.levels = subsurf_levels
        subsurf.render_levels = subsurf_levels

    # shade_auto_smooth replaces the removed Mesh.use_auto_smooth flag (5.x).
    bpy.ops.object.shade_smooth()
    bpy.ops.object.shade_auto_smooth(
        use_auto_smooth=True, angle=math.radians(smooth_angle_deg)
    )


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #

def export_glb(obj: bpy.types.Object, path: str) -> None:
    """
    Export a single object as a binary .glb (+Y up, modifiers applied, one node).
    Bakes vertex colors (COLOR_0) and materials.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,  # bake Bevel + Subsurf modifiers
        export_yup=True,  # +Y up (three.js convention)
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",  # emit the active COLOR_0 stream
        export_active_vertex_color_when_no_material=True,
    )
