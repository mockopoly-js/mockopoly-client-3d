"""
Headless Blender generator for mockopoly toy-city decorative props.

Exports:
  public/models/city/tree.glb          — low-poly stylized tree, brown trunk + green foliage
  public/models/city/building-tall.glb — toy skyscraper with lighter roof + accent band
  public/models/city/building-wide.glb — squat wide block building, different accent color
  public/models/city/car.glb           — tiny street-prop car (body + cabin + 4 wheels)

Multi-color COLOR_0 is baked via lib's per-region callable path so the client's
vertexColors MeshStandardMaterial shows the baked palette untinted (tint=white).

Base rests at local z=0 (Blender) / y=0 (three.js after export_yup=True).
All props are city dressing placed in the board center (x,z ∈ [-3.2, 3.2]).

Run headless:
    /Applications/Blender.app/Contents/MacOS/Blender \
        --background --python scripts/blender/gen_city.py

Tested against Blender 5.2.0 LTS. See lib.py for 5.x API notes.
"""

import math
import os
import sys

import bmesh
import bpy

sys.path.append(os.path.dirname(__file__))
import lib  # noqa: E402


# --------------------------------------------------------------------------- #
# Color palette (linear 0..1)
# --------------------------------------------------------------------------- #

# Tree
TREE_TRUNK    = (0.25, 0.12, 0.04)   # warm brown
TREE_FOLIAGE  = (0.08, 0.40, 0.10)   # medium green

# Building-tall: cream/off-white facade, lighter roof, teal accent window band
TALL_WALL     = (0.72, 0.68, 0.58)   # warm beige/cream
TALL_ROOF     = (0.90, 0.88, 0.80)   # near-white light roof
TALL_ACCENT   = (0.08, 0.42, 0.52)   # teal accent band (windows)

# Building-wide: terracotta/brick facade, dark slate roof, yellow accent band
WIDE_WALL     = (0.62, 0.24, 0.14)   # terracotta/brick red
WIDE_ROOF     = (0.14, 0.10, 0.10)   # dark slate
WIDE_ACCENT   = (0.70, 0.60, 0.10)   # golden-yellow accent (windows)

# Car: bright candy red body, light gray wheels, dark windscreen cabin
CAR_BODY      = (0.80, 0.08, 0.08)   # vivid red
CAR_WHEELS    = (0.15, 0.15, 0.15)   # near-black rubber
CAR_CABIN     = (0.60, 0.70, 0.80)   # light blue-gray windscreen


# --------------------------------------------------------------------------- #
# Shared box primitive (same as gen_buildings.py)
# --------------------------------------------------------------------------- #

def add_box(bm, cx, cy, cz, sx, sy, sz):
    """Add an axis-aligned box centered at (cx, cy, cz) with full sizes (sx,sy,sz)."""
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


# --------------------------------------------------------------------------- #
# Tree builder
# height ≈ 0.40, base z=0
# --------------------------------------------------------------------------- #

def build_tree() -> bpy.types.Object:
    """
    Stylized low-poly tree: cylindrical brown trunk + two icosphere-like foliage blobs.
    Trunk: octagonal prism, brown. Foliage: two UV-sphere-based blobs (low segments), green.
    Total height ≈ 0.40, base at z=0, footprint ≈ 0.18 radius.
    """
    TRUNK_R    = 0.030
    TRUNK_H    = 0.14
    SEGS       = 8      # low-poly feel

    bm = bmesh.new()

    # --- Trunk: octagonal prism ---
    bot_ring = lib.add_ring(bm, TRUNK_R, 0.0,      SEGS)
    top_ring = lib.add_ring(bm, TRUNK_R, TRUNK_H,  SEGS)
    lib.bridge(bm, bot_ring, top_ring)
    lib.cap(bm, bot_ring, 0.0,     flip=True)
    lib.cap(bm, top_ring, TRUNK_H, flip=False)

    # --- Lower foliage blob: bigger sphere centered above trunk ---
    FOL1_R   = 0.12
    FOL1_CZ  = TRUNK_H + FOL1_R * 0.7   # overlap trunk top slightly
    FOL1_VERT_SEGS = 4
    FOL1_HORIZ_SEGS = 6
    prev_ring = None
    for vi in range(FOL1_VERT_SEGS + 1):
        t = vi / FOL1_VERT_SEGS            # 0..1 bottom to top
        phi = math.pi * t                  # 0..pi
        ring_r = FOL1_R * math.sin(phi)
        ring_z = FOL1_CZ - FOL1_R + FOL1_R * 2 * t
        if vi == 0 or vi == FOL1_VERT_SEGS:
            # pole vertex
            pole = bm.verts.new((0.0, 0.0, ring_z))
            if prev_ring is not None:
                # cap off with the previous ring
                for i in range(len(prev_ring)):
                    j = (i + 1) % len(prev_ring)
                    bm.faces.new((pole, prev_ring[j], prev_ring[i]))
            prev_ring = [pole]
        else:
            cur_ring = lib.add_ring(bm, ring_r, ring_z, FOL1_HORIZ_SEGS)
            if prev_ring is not None and len(prev_ring) > 1:
                lib.bridge(bm, prev_ring, cur_ring)
            elif prev_ring is not None and len(prev_ring) == 1:
                pole = prev_ring[0]
                for i in range(len(cur_ring)):
                    j = (i + 1) % len(cur_ring)
                    bm.faces.new((pole, cur_ring[i], cur_ring[j]))
            prev_ring = cur_ring

    # --- Upper foliage blob: smaller sphere offset slightly ---
    FOL2_R   = 0.08
    FOL2_CZ  = FOL1_CZ + FOL1_R * 0.8
    FOL2_VERT_SEGS = 3
    FOL2_HORIZ_SEGS = 5
    prev_ring2 = None
    for vi in range(FOL2_VERT_SEGS + 1):
        t = vi / FOL2_VERT_SEGS
        phi = math.pi * t
        ring_r = FOL2_R * math.sin(phi)
        ring_z = FOL2_CZ - FOL2_R + FOL2_R * 2 * t
        if vi == 0 or vi == FOL2_VERT_SEGS:
            pole = bm.verts.new((0.0, 0.0, ring_z))
            if prev_ring2 is not None:
                for i in range(len(prev_ring2)):
                    j = (i + 1) % len(prev_ring2)
                    bm.faces.new((pole, prev_ring2[j], prev_ring2[i]))
            prev_ring2 = [pole]
        else:
            cur_ring2 = lib.add_ring(bm, ring_r, ring_z, FOL2_HORIZ_SEGS)
            if prev_ring2 is not None and len(prev_ring2) > 1:
                lib.bridge(bm, prev_ring2, cur_ring2)
            elif prev_ring2 is not None and len(prev_ring2) == 1:
                pole = prev_ring2[0]
                for i in range(len(cur_ring2)):
                    j = (i + 1) % len(cur_ring2)
                    bm.faces.new((pole, cur_ring2[i], cur_ring2[j]))
            prev_ring2 = cur_ring2

    obj = lib.finalize_bmesh(bm, "Tree")

    # Color by z: below foliage start → trunk brown; above → green
    foliage_start = TRUNK_H - 0.01

    def tree_color(co):
        return TREE_FOLIAGE if co.z >= foliage_start else TREE_TRUNK

    lib.apply_material_and_colors(obj, tree_color)
    lib.apply_smooth_modifiers(obj, bevel_width=0.005, bevel_segments=1, subsurf_levels=0)
    return obj


# --------------------------------------------------------------------------- #
# Building-tall builder
# height ≈ 0.90, footprint ≈ 0.28 × 0.24, base z=0
# --------------------------------------------------------------------------- #

def build_building_tall() -> bpy.types.Object:
    """
    Toy skyscraper: three stacked tapered box segments + flat roof cap.
    Colors: beige/cream walls, lighter roof, teal accent band (window row).
    Height ≈ 0.90, footprint ≈ 0.28 (x) × 0.24 (y), base at z=0.
    """
    # Lower block (widest)
    LO_W, LO_D, LO_H = 0.28, 0.24, 0.35
    # Mid block (slightly narrower)
    MID_W, MID_D, MID_H = 0.22, 0.19, 0.30
    # Upper block (narrowest)
    UPP_W, UPP_D, UPP_H = 0.15, 0.13, 0.20
    # Roof cap
    ROOF_H = 0.05

    # Accent band z-range (window row on mid block)
    ACC_Z_LO = LO_H + 0.06
    ACC_Z_HI = LO_H + 0.14

    bm = bmesh.new()

    # Lower block: base z=0 → z=LO_H
    add_box(bm, 0.0, 0.0, LO_H / 2, LO_W, LO_D, LO_H)

    # Mid block: LO_H → LO_H+MID_H, centered
    add_box(bm, 0.0, 0.0, LO_H + MID_H / 2, MID_W, MID_D, MID_H)

    # Upper block: LO_H+MID_H → LO_H+MID_H+UPP_H
    upp_z0 = LO_H + MID_H
    add_box(bm, 0.0, 0.0, upp_z0 + UPP_H / 2, UPP_W, UPP_D, UPP_H)

    # Roof cap: slightly wider than upper block
    roof_z0 = upp_z0 + UPP_H
    add_box(bm, 0.0, 0.0, roof_z0 + ROOF_H / 2, UPP_W + 0.02, UPP_D + 0.02, ROOF_H)

    total_h = roof_z0 + ROOF_H

    obj = lib.finalize_bmesh(bm, "BuildingTall")

    roof_z_threshold = roof_z0 - 0.005

    def tall_color(co):
        z = co.z
        if z >= roof_z_threshold:
            return TALL_ROOF
        if ACC_Z_LO <= z <= ACC_Z_HI:
            return TALL_ACCENT
        return TALL_WALL

    lib.apply_material_and_colors(obj, tall_color)
    lib.apply_smooth_modifiers(obj, bevel_width=0.010, bevel_segments=1, subsurf_levels=0)
    return obj


# --------------------------------------------------------------------------- #
# Building-wide builder
# height ≈ 0.50, footprint ≈ 0.48 × 0.36, base z=0
# --------------------------------------------------------------------------- #

def build_building_wide() -> bpy.types.Object:
    """
    Squat wide block building: two layers (main body + smaller penthouse),
    flat-ish dark roof cap.
    Colors: terracotta/brick walls, dark slate roof, golden-yellow accent band.
    Height ≈ 0.50, footprint ≈ 0.48 (x) × 0.36 (y), base at z=0.
    """
    BODY_W, BODY_D, BODY_H = 0.48, 0.36, 0.32
    PH_W, PH_D, PH_H = 0.28, 0.20, 0.12
    ROOF_H = 0.06

    # Accent band z-range (horizontal stripe across the main body)
    ACC_Z_LO = 0.10
    ACC_Z_HI = 0.16

    bm = bmesh.new()

    # Main body
    add_box(bm, 0.0, 0.0, BODY_H / 2, BODY_W, BODY_D, BODY_H)

    # Penthouse (centered on top)
    ph_z0 = BODY_H
    add_box(bm, 0.0, 0.0, ph_z0 + PH_H / 2, PH_W, PH_D, PH_H)

    # Roof cap over penthouse
    roof_z0 = ph_z0 + PH_H
    add_box(bm, 0.0, 0.0, roof_z0 + ROOF_H / 2, PH_W + 0.02, PH_D + 0.02, ROOF_H)

    obj = lib.finalize_bmesh(bm, "BuildingWide")

    roof_z_threshold = roof_z0 - 0.005

    def wide_color(co):
        z = co.z
        if z >= roof_z_threshold:
            return WIDE_ROOF
        if z >= ph_z0 - 0.005:
            # penthouse: same wall color
            return WIDE_WALL
        if ACC_Z_LO <= z <= ACC_Z_HI:
            return WIDE_ACCENT
        return WIDE_WALL

    lib.apply_material_and_colors(obj, wide_color)
    lib.apply_smooth_modifiers(obj, bevel_width=0.010, bevel_segments=1, subsurf_levels=0)
    return obj


# --------------------------------------------------------------------------- #
# Car builder
# height ≈ 0.15, footprint ≈ 0.30 × 0.16, base z=0
# --------------------------------------------------------------------------- #

def add_wheel(bm, cx, cy, cz, radius, thickness, segments):
    """
    Add a disc-shaped wheel (short cylinder) centered at (cx, cy, cz).
    The disc axis is along y (left-right).  Returns (inner_bot, inner_top) rings
    so the caller can track which verts belong to which wheel.
    """
    # Build rings in local space, then offset.
    # We use x/z for the disc face, y for depth.
    half_t = thickness / 2.0
    bot_verts = []
    top_verts = []
    for i in range(segments):
        a = (2.0 * math.pi) * (i / segments)
        dx = radius * math.cos(a)
        dz = radius * math.sin(a)
        bot_verts.append(bm.verts.new((cx + dx, cy - half_t, cz + dz)))
        top_verts.append(bm.verts.new((cx + dx, cy + half_t, cz + dz)))

    # Side faces
    n = segments
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot_verts[i], bot_verts[j], top_verts[j], top_verts[i]))

    # Cap faces (fan from center)
    bot_ctr = bm.verts.new((cx, cy - half_t, cz))
    top_ctr = bm.verts.new((cx, cy + half_t, cz))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot_ctr, bot_verts[j], bot_verts[i]))   # bottom face (flipped)
        bm.faces.new((top_ctr, top_verts[i], top_verts[j]))   # top face


def build_car() -> bpy.types.Object:
    """
    Tiny street-prop car: low flat body block + smaller cabin block on top + 4 disc wheels.
    Distinct from the token car — simpler, street-prop scale, brighter color.
    Body: vivid red. Cabin (windscreen): blue-gray. Wheels: near-black.
    Height ≈ 0.15, footprint ≈ 0.30 (x) × 0.16 (y), base at z=0.
    Wheels protrude sideways in y; body base is at z=0.
    """
    BODY_W  = 0.30   # length (x)
    BODY_D  = 0.13   # body depth (y, between wheel faces)
    BODY_H  = 0.08   # body block height (z)

    CAB_W   = 0.14   # cabin length (x, centered)
    CAB_D   = 0.09   # cabin depth (y)
    CAB_H   = 0.06   # cabin height on top of body

    WHEEL_R = 0.040  # wheel disc radius
    WHEEL_T = 0.025  # wheel thickness (y axis)
    WHEEL_SEGS = 8

    # Wheel center z = WHEEL_R so wheel base touches z=0
    WHEEL_Z  = WHEEL_R
    # Wheel x positions: front and rear
    WHEEL_XS = [BODY_W / 2 - 0.060, -(BODY_W / 2 - 0.060)]
    # Wheel y positions: outside body flanks
    WHEEL_YP = BODY_D / 2 + WHEEL_T / 2   # positive side
    WHEEL_YN = -(BODY_D / 2 + WHEEL_T / 2)

    bm = bmesh.new()

    # Body block: base at z=0, centered at origin
    add_box(bm, 0.0, 0.0, BODY_H / 2, BODY_W, BODY_D, BODY_H)

    # Cabin: sits on top of body
    add_box(bm, 0.0, 0.0, BODY_H + CAB_H / 2, CAB_W, CAB_D, CAB_H)

    # 4 wheels using explicit helper (avoids BMElemSeq index issues)
    for wx in WHEEL_XS:
        add_wheel(bm, wx, WHEEL_YP, WHEEL_Z, WHEEL_R, WHEEL_T, WHEEL_SEGS)
        add_wheel(bm, wx, WHEEL_YN, WHEEL_Z, WHEEL_R, WHEEL_T, WHEEL_SEGS)

    obj = lib.finalize_bmesh(bm, "Car")

    # Color regions: wheels by y position, cabin by z, rest body red
    body_y_limit = BODY_D / 2 + 0.005

    def car_color(co):
        if abs(co.y) > body_y_limit:
            return CAR_WHEELS
        if co.z >= BODY_H - 0.005:
            return CAR_CABIN
        return CAR_BODY

    lib.apply_material_and_colors(obj, car_color)
    lib.apply_smooth_modifiers(obj, bevel_width=0.005, bevel_segments=1, subsurf_levels=0)
    return obj


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

PROPS = {
    "tree":           build_tree,
    "building-tall":  build_building_tall,
    "building-wide":  build_building_wide,
    "car":            build_car,
}


def main() -> None:
    for name, builder in PROPS.items():
        lib.reset_scene()
        obj = builder()
        out = lib.model_path("city", f"{name}.glb")
        lib.export_glb(obj, out)
        print(f"[gen_city] exported {name:20s} -> {out}")


if __name__ == "__main__":
    main()
