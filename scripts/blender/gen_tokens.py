"""
Headless Blender generator for the 8 mockopoly player-token models.

Each token is a chunky, low-poly, readable toy silhouette (Monopoly-GO look),
built from bmesh primitives + box/cylinder parts, merged into ONE mesh, given a
uniform WHITE COLOR_0 vertex stream (the per-player tint is applied client-side
by ModelMesh), smooth-shaded, and exported to:

    public/models/tokens/<name>.glb

Shapes: tophat, car, dog, ship, boot, thimble, wheelbarrow, cat.

Shared conventions (Global Constraints):
  * base rests at local y=0 (Blender z=0 before +Y-up export),
  * footprint radius ~= 0.32 (so the client `scale=3` placement holds),
  * total height 0.5..0.7, < ~3k tris each,
  * WHITE COLOR_0 (tint is client-side).

Run headless:
    /Applications/Blender.app/Contents/MacOS/Blender \
        --background --python scripts/blender/gen_tokens.py

Tested against Blender 5.2.0 LTS. See lib.py for the 5.x API gotchas.

Note on axes: geometry is authored in Blender's Z-up space (z = height). The
exporter (`export_yup=True`) rotates Z-up -> three.js Y-up, so authoring "up"
as +z is correct.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
import lib  # noqa: E402

# White vertex color — the client tints per player.
WHITE = (1.0, 1.0, 1.0)

SEG = 24  # radial segment budget for round parts


# --------------------------------------------------------------------------- #
# Low-level box helper (adds a solid box to an existing bmesh)
# --------------------------------------------------------------------------- #

def add_box(bm, cx, cy, cz, sx, sy, sz):
    """Add an axis-aligned box centered at (cx,cy,cz) with full sizes (sx,sy,sz)."""
    hx, hy, hz = sx / 2.0, sy / 2.0, sz / 2.0
    verts = [
        bm.verts.new((cx - hx, cy - hy, cz - hz)),
        bm.verts.new((cx + hx, cy - hy, cz - hz)),
        bm.verts.new((cx + hx, cy + hy, cz - hz)),
        bm.verts.new((cx - hx, cy + hy, cz - hz)),
        bm.verts.new((cx - hx, cy - hy, cz + hz)),
        bm.verts.new((cx + hx, cy - hy, cz + hz)),
        bm.verts.new((cx + hx, cy + hy, cz + hz)),
        bm.verts.new((cx - hx, cy + hy, cz + hz)),
    ]
    f = bm.faces.new
    f((verts[0], verts[1], verts[2], verts[3]))  # bottom
    f((verts[7], verts[6], verts[5], verts[4]))  # top
    f((verts[0], verts[4], verts[5], verts[1]))  # -y
    f((verts[1], verts[5], verts[6], verts[2]))  # +x
    f((verts[2], verts[6], verts[7], verts[3]))  # +y
    f((verts[3], verts[7], verts[4], verts[0]))  # -x
    return verts


def add_cylinder(bm, cx, cy, z0, z1, radius, segments=SEG, axis="z"):
    """
    Add a closed cylinder. For axis='z' it spans z0..z1 around (cx,cy).
    For axis='y' it spans y0..y1 (passed as z0..z1) at height cz=cx? — we keep
    it simple and only support 'z' and 'x' here.
    """
    if axis == "z":
        lower = [
            bm.verts.new(
                (cx + radius * math.cos(2 * math.pi * i / segments),
                 cy + radius * math.sin(2 * math.pi * i / segments), z0)
            )
            for i in range(segments)
        ]
        upper = [
            bm.verts.new(
                (cx + radius * math.cos(2 * math.pi * i / segments),
                 cy + radius * math.sin(2 * math.pi * i / segments), z1)
            )
            for i in range(segments)
        ]
    elif axis == "x":
        # Wheel lying on the x-axis: circle in (y,z), extruded along x from cx-? .
        # Here z0,z1 are the x extents; cx is unused, cy is center y, and the
        # circle is centered at (cy, height) — we pass height via a closure below,
        # so implement a dedicated wheel helper instead. Not used generically.
        raise NotImplementedError
    lib.bridge(bm, lower, upper)
    lib.cap(bm, lower, z0, flip=True)
    lib.cap(bm, upper, z1, flip=False)
    return lower, upper


def add_wheel(bm, cx, x0, x1, cy, cz, radius, segments=16):
    """
    Add a wheel (short cylinder) whose axle runs along the x-axis.
    Circle lies in the (y,z) plane centered at (cy,cz); the wheel spans x0..x1.
    """
    def ring(x):
        return [
            bm.verts.new(
                (x,
                 cy + radius * math.cos(2 * math.pi * i / segments),
                 cz + radius * math.sin(2 * math.pi * i / segments))
            )
            for i in range(segments)
        ]
    lo = ring(x0)
    hi = ring(x1)
    lib.bridge(bm, lo, hi)
    # cap flat sides (fan) — build manually since lib.cap fans around z-axis
    for side, x, flip in ((lo, x0, True), (hi, x1, False)):
        center = bm.verts.new((x, cy, cz))
        n = len(side)
        for i in range(n):
            j = (i + 1) % n
            tri = (center, side[i], side[j])
            if flip:
                tri = (center, side[j], side[i])
            bm.faces.new(tri)


# --------------------------------------------------------------------------- #
# Shape builders — each returns a linked, selected object, base at z=0
# --------------------------------------------------------------------------- #

def build_tophat() -> bpy.types.Object:
    """The proven top-hat (moved from gen_models.py), now baked white."""
    BRIM_RADIUS = 0.320
    BRIM_HEIGHT = 0.045
    CROWN_BOTTOM_R = 0.210
    CROWN_TOP_R = 0.185
    CROWN_HEIGHT = 0.560
    BAND_RADIUS_EXTRA = 0.012
    BAND_BOTTOM = 0.075
    BAND_TOP = 0.150

    seg = SEG
    bm = bmesh.new()
    z_brim_top = BRIM_HEIGHT
    z_crown_top = BRIM_HEIGHT + CROWN_HEIGHT

    brim_bottom_ring = lib.add_ring(bm, BRIM_RADIUS, 0.0, seg)
    brim_top_ring = lib.add_ring(bm, BRIM_RADIUS, z_brim_top, seg)
    lib.cap(bm, brim_bottom_ring, 0.0, flip=True)
    lib.bridge(bm, brim_bottom_ring, brim_top_ring)

    crown_base_ring = lib.add_ring(bm, CROWN_BOTTOM_R, z_brim_top, seg)
    lib.bridge(bm, brim_top_ring, crown_base_ring)

    band_lo = z_brim_top + BAND_BOTTOM
    band_hi = z_brim_top + BAND_TOP
    levels = [z_brim_top, band_lo, (band_lo + band_hi) * 0.5, band_hi, z_crown_top]

    def crown_radius(z):
        t = (z - z_brim_top) / CROWN_HEIGHT
        base_r = CROWN_BOTTOM_R + (CROWN_TOP_R - CROWN_BOTTOM_R) * t
        if band_lo <= z <= band_hi:
            base_r += BAND_RADIUS_EXTRA
        return base_r

    prev_ring = crown_base_ring
    for z in levels[1:]:
        ring = lib.add_ring(bm, crown_radius(z), z, seg)
        lib.bridge(bm, prev_ring, ring)
        prev_ring = ring
    lib.cap(bm, prev_ring, z_crown_top, flip=False)

    obj = lib.finalize_bmesh(bm, "Tophat")
    lib.apply_material_and_colors(obj, WHITE)
    lib.apply_smooth_modifiers(obj)
    return obj


def build_car() -> bpy.types.Object:
    """Classic roadster: body block + tapered hood + cabin + 4 wheels."""
    bm = bmesh.new()
    wheel_r = 0.11
    axle_z = wheel_r  # wheels rest on the ground -> base at z=0
    # Body sits above the wheels. Widened so the footprint radius ~= 0.32.
    add_box(bm, 0.0, 0.0, axle_z + 0.09, 0.42, 0.52, 0.16)   # main body (x=width)
    add_box(bm, 0.0, 0.20, axle_z + 0.07, 0.38, 0.18, 0.12)  # hood (front, +y)
    add_box(bm, 0.0, -0.07, axle_z + 0.20, 0.32, 0.26, 0.13)  # cabin
    # 4 wheels, axle along x. body length is along y.
    for wy in (0.19, -0.19):
        add_wheel(bm, 0.0, -0.27, -0.20, wy, axle_z, wheel_r, segments=10)  # left
        add_wheel(bm, 0.0, 0.20, 0.27, wy, axle_z, wheel_r, segments=10)    # right
    obj = lib.finalize_bmesh(bm, "Car")
    lib.apply_material_and_colors(obj, WHITE)
    lib.apply_smooth_modifiers(obj, bevel_width=0.02, subsurf_levels=0)
    return obj


def build_dog() -> bpy.types.Object:
    """Stylized Scottie: blocky body + head + 4 stubby legs + ears + tail."""
    bm = bmesh.new()
    leg_h = 0.14
    add_box(bm, 0.0, 0.0, leg_h + 0.11, 0.20, 0.42, 0.22)    # body
    add_box(bm, 0.0, 0.26, leg_h + 0.17, 0.18, 0.16, 0.18)   # head (front +y)
    add_box(bm, 0.0, 0.30, leg_h + 0.30, 0.16, 0.10, 0.08)   # snout/brow ridge -> ears base
    # ears
    add_box(bm, -0.05, 0.30, leg_h + 0.34, 0.05, 0.05, 0.09)
    add_box(bm, 0.05, 0.30, leg_h + 0.34, 0.05, 0.05, 0.09)
    # tail (up, back -y)
    add_box(bm, 0.0, -0.22, leg_h + 0.20, 0.06, 0.06, 0.14)
    # 4 stubby legs
    for lx in (-0.06, 0.06):
        for ly in (0.15, -0.15):
            add_box(bm, lx, ly, leg_h / 2.0, 0.07, 0.08, leg_h)
    obj = lib.finalize_bmesh(bm, "Dog")
    lib.apply_material_and_colors(obj, WHITE)
    lib.apply_smooth_modifiers(obj, bevel_width=0.022, subsurf_levels=0)
    return obj


def build_ship() -> bpy.types.Object:
    """Battleship: tapered hull + flat deck + 2 smokestacks."""
    bm = bmesh.new()
    hull_h = 0.16
    # Tapered hull: bottom narrow, top wide, pointed bow (+y).
    # Build as a lofted box using two rings of 4 verts (rectangles) — bow taper.
    def rect(y_front, y_back, half_w_front, half_w_back, z, taper_front=0.0):
        return [
            bm.verts.new((-half_w_back, y_back, z)),
            bm.verts.new((half_w_back, y_back, z)),
            bm.verts.new((half_w_front - taper_front, y_front, z)),
            bm.verts.new((-half_w_front + taper_front, y_front, z)),
        ]
    y_front, y_back = 0.40, -0.34
    lower = rect(y_front, y_back, 0.10, 0.14, 0.0, taper_front=0.07)
    upper = rect(y_front, y_back, 0.16, 0.20, hull_h, taper_front=0.10)
    lib.bridge(bm, lower, upper)
    bm.faces.new(tuple(reversed(lower)))  # hull bottom
    # deck (flat top box)
    add_box(bm, 0.0, 0.0, hull_h + 0.03, 0.30, 0.58, 0.06)
    # superstructure block
    add_box(bm, 0.0, -0.02, hull_h + 0.13, 0.20, 0.24, 0.14)
    # 2 smokestacks
    add_cylinder(bm, 0.0, 0.02, hull_h + 0.20, hull_h + 0.40, 0.05, segments=14)
    add_cylinder(bm, 0.0, -0.14, hull_h + 0.20, hull_h + 0.40, 0.05, segments=14)
    obj = lib.finalize_bmesh(bm, "Ship")
    lib.apply_material_and_colors(obj, WHITE)
    lib.apply_smooth_modifiers(obj, bevel_width=0.015, subsurf_levels=1)
    return obj


def build_boot() -> bpy.types.Object:
    """Extruded boot side-profile (in the y-z plane) + sole thickness (along x)."""
    bm = bmesh.new()
    # Side profile points (y=length, z=height), CCW. Boot points toe toward +y.
    # y-span ~= -0.22..0.40 (length 0.62 -> footprint radius ~0.31).
    profile = [
        (-0.22, 0.0),   # heel bottom
        (0.36, 0.0),    # toe bottom
        (0.40, 0.11),   # toe front
        (0.14, 0.15),   # instep
        (0.03, 0.19),   # ankle front
        (0.03, 0.58),   # shaft top front
        (-0.18, 0.58),  # shaft top back
        (-0.18, 0.17),  # heel back top
        (-0.22, 0.09),  # heel back
    ]
    half_w = 0.13
    front = [bm.verts.new((half_w, y, z)) for (y, z) in profile]
    back = [bm.verts.new((-half_w, y, z)) for (y, z) in profile]
    n = len(profile)
    # side walls
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    # front & back faces (fan from vertex 0)
    for i in range(1, n - 1):
        bm.faces.new((front[0], front[i], front[i + 1]))
        bm.faces.new((back[0], back[i + 1], back[i]))
    obj = lib.finalize_bmesh(bm, "Boot")
    lib.apply_material_and_colors(obj, WHITE)
    lib.apply_smooth_modifiers(obj, bevel_width=0.02, subsurf_levels=1)
    return obj


def build_thimble() -> bpy.types.Object:
    """Tapered rounded cup, open bottom, slightly domed top."""
    bm = bmesh.new()
    seg = SEG
    # Profile radii from bottom (wide) to top (narrow).
    levels = [
        (0.00, 0.30),
        (0.10, 0.29),
        (0.28, 0.26),
        (0.46, 0.22),
        (0.58, 0.17),
    ]
    rings = []
    for z, r in levels:
        rings.append(lib.add_ring(bm, r, z, seg))
    for i in range(len(rings) - 1):
        lib.bridge(bm, rings[i], rings[i + 1])
    # domed top: small ring + cap
    dome = lib.add_ring(bm, 0.10, 0.64, seg)
    lib.bridge(bm, rings[-1], dome)
    lib.cap(bm, dome, 0.66, flip=False)
    # bottom rim (open bottom): give it a thin inner wall so it's watertight-ish.
    inner = lib.add_ring(bm, 0.26, 0.03, seg)
    lib.bridge(bm, rings[0], inner)   # bottom rim thickness
    lib.cap(bm, inner, 0.03, flip=True)  # close the underside (hidden)
    obj = lib.finalize_bmesh(bm, "Thimble")
    lib.apply_material_and_colors(obj, WHITE)
    lib.apply_smooth_modifiers(obj, bevel_width=0.012, subsurf_levels=1)
    return obj


def build_wheelbarrow() -> bpy.types.Object:
    """Shallow tray + single front wheel + 2 support legs + 2 handles."""
    bm = bmesh.new()
    wheel_r = 0.12
    tray_z = wheel_r + 0.02
    # Tray: open-top shallow box approximated as a solid slab + raised walls.
    add_box(bm, 0.0, -0.02, tray_z + 0.06, 0.36, 0.34, 0.12)   # tray body
    add_box(bm, 0.0, 0.14, tray_z + 0.11, 0.36, 0.05, 0.14)    # front wall (+y)
    # front wheel (axle along x), at front +y, touching ground
    add_wheel(bm, 0.0, -0.05, 0.05, 0.24, wheel_r, wheel_r, segments=12)
    # wheel fork/support to tray
    add_box(bm, 0.0, 0.19, tray_z, 0.06, 0.10, 0.08)
    # 2 rear support legs
    for lx in (-0.14, 0.14):
        add_box(bm, lx, -0.16, (tray_z) / 2.0, 0.05, 0.05, tray_z)
    # 2 handles extending back -y and up
    for lx in (-0.14, 0.14):
        add_box(bm, lx, -0.24, tray_z + 0.09, 0.045, 0.20, 0.045)
    obj = lib.finalize_bmesh(bm, "Wheelbarrow")
    lib.apply_material_and_colors(obj, WHITE)
    lib.apply_smooth_modifiers(obj, bevel_width=0.015, subsurf_levels=0)
    return obj


def build_cat() -> bpy.types.Object:
    """Sitting cat: rounded body + head + triangular ears + curled tail."""
    bm = bmesh.new()
    cseg = 16  # cat uses a lower ring budget (bevel handles rounding)
    # Sitting body: wider at base, tapering up. Base widened so footprint ~= 0.32.
    body_levels = [
        (0.00, 0.30),
        (0.08, 0.31),
        (0.24, 0.26),
        (0.38, 0.18),
    ]
    rings = [lib.add_ring(bm, r, z, cseg) for (z, r) in body_levels]
    lib.cap(bm, rings[0], 0.0, flip=True)
    for i in range(len(rings) - 1):
        lib.bridge(bm, rings[i], rings[i + 1])
    # neck cap
    lib.cap(bm, rings[-1], 0.40, flip=False)
    # head (sphere-ish via stacked rings)
    head_cz = 0.52
    head_levels = [
        (head_cz - 0.11, 0.05),
        (head_cz - 0.06, 0.13),
        (head_cz + 0.00, 0.15),
        (head_cz + 0.06, 0.12),
        (head_cz + 0.11, 0.05),
    ]
    hrings = [lib.add_ring(bm, r, z, cseg) for (z, r) in head_levels]
    lib.cap(bm, hrings[0], head_cz - 0.13, flip=True)
    for i in range(len(hrings) - 1):
        lib.bridge(bm, hrings[i], hrings[i + 1])
    lib.cap(bm, hrings[-1], head_cz + 0.13, flip=False)
    # triangular ears (thin boxes, will bevel/subsurf into wedges)
    for ex in (-0.09, 0.09):
        add_box(bm, ex, 0.0, head_cz + 0.15, 0.06, 0.05, 0.10)
    # curled tail (back +? -y, up)
    add_box(bm, 0.0, -0.20, 0.06, 0.06, 0.10, 0.10)
    add_box(bm, 0.0, -0.24, 0.20, 0.06, 0.06, 0.16)
    obj = lib.finalize_bmesh(bm, "Cat")
    lib.apply_material_and_colors(obj, WHITE)
    lib.apply_smooth_modifiers(obj, bevel_width=0.018, subsurf_levels=0)
    return obj


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

TOKENS = {
    "tophat": build_tophat,
    "car": build_car,
    "dog": build_dog,
    "ship": build_ship,
    "boot": build_boot,
    "thimble": build_thimble,
    "wheelbarrow": build_wheelbarrow,
    "cat": build_cat,
}


def main() -> None:
    for name, builder in TOKENS.items():
        lib.reset_scene()
        obj = builder()
        out = lib.model_path("tokens", f"{name}.glb")
        lib.export_glb(obj, out)
        print(f"[gen_tokens] exported {name:12s} -> {out}")


if __name__ == "__main__":
    main()
