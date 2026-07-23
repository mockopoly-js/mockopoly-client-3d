"""
Headless Blender generator for mockopoly house + hotel models.

Exports:
  public/models/buildings/house.glb  — small toy house, green walls + darker roof
  public/models/buildings/hotel.glb  — larger toy hotel, red walls + dark roof

Multi-color COLOR_0 is baked via lib's per-region callable path so the client's
vertexColors MeshStandardMaterial shows the baked palette untinted (tint=white).

Model-forward axis: +Y (Blender) / +Z (three.js after +Y-up export).
The model's "front" faces +Z in three.js space. Buildings are rotated in
Buildings.tsx so front faces the board center.

Base rests at local z=0 (Blender) / y=0 (three.js after export_yup).

Run headless:
    /Applications/Blender.app/Contents/MacOS/Blender \
        --background --python scripts/blender/gen_buildings.py

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

# House: bright green walls, dark forest-green roof
HOUSE_WALL   = (0.15, 0.60, 0.20)   # vivid green
HOUSE_ROOF   = (0.05, 0.20, 0.06)   # dark green

# Hotel: red walls, very dark slate roof
HOTEL_WALL   = (0.72, 0.08, 0.08)   # vivid red
HOTEL_ROOF   = (0.12, 0.04, 0.04)   # near-black dark red


# --------------------------------------------------------------------------- #
# Low-level box primitive — canonical impl lives in lib.py; alias so the
# building builders keep calling the bare `add_box(...)` (shared with
# gen_tokens.py / gen_city.py via lib.add_box).
# --------------------------------------------------------------------------- #

add_box = lib.add_box


def add_hip_roof(bm, cx, cy, z_base, z_peak, hx, hy):
    """
    Build a pyramid roof (single apex) centered at (cx,cy) above z_base with
    apex at z_peak.  hx/hy are the half-extents of the rectangular base.
    All four triangular faces meet at the single apex point.
    """
    # 4 base corners
    bl = bm.verts.new((cx - hx, cy - hy, z_base))
    br = bm.verts.new((cx + hx, cy - hy, z_base))
    fr = bm.verts.new((cx + hx, cy + hy, z_base))
    fl = bm.verts.new((cx - hx, cy + hy, z_base))
    # Single apex — pyramid roof (not a hip/ridge roof)
    apex = bm.verts.new((cx, cy, z_peak))
    bm.faces.new((bl, br, apex))          # -y face
    bm.faces.new((br, fr, apex))          # +x face
    bm.faces.new((fr, fl, apex))          # +y face
    bm.faces.new((fl, bl, apex))          # -x face
    bm.faces.new((bl, fl, fr, br))        # bottom (close underside of roof)


# --------------------------------------------------------------------------- #
# House builder
# Footprint ~0.22 (x) x ~0.22 (y), height ~0.28, base z=0.
# --------------------------------------------------------------------------- #

def build_house() -> bpy.types.Object:
    """
    Small toy house: rectangular box body + single-apex pyramid roof on top.
    Green walls, dark green roof — both baked as COLOR_0.
    Footprint: 0.22 x 0.22 in x/y, total height 0.28, base at z=0.
    Forward axis: +Y (three.js +Z after Y-up export).
    """
    WALL_W  = 0.22    # x extent
    WALL_D  = 0.22    # y extent
    WALL_H  = 0.18    # z height of the boxy body (base at 0, top at WALL_H)
    ROOF_H  = 0.10    # roof adds this height above WALL_H

    bm = bmesh.new()

    # --- Wall body ---
    # Centered in x/y so the footprint is symmetric around origin.
    wall_verts = add_box(bm, 0.0, 0.0, WALL_H / 2, WALL_W, WALL_D, WALL_H)

    # --- Hip roof (pyramid) ---
    add_hip_roof(
        bm, 0.0, 0.0,
        z_base=WALL_H,
        z_peak=WALL_H + ROOF_H,
        hx=WALL_W / 2 + 0.01,   # slight overhang
        hy=WALL_D / 2 + 0.01,
    )

    obj = lib.finalize_bmesh(bm, "House")

    # Per-region color: above the wall/roof split z goes dark green.
    roof_z = WALL_H - 0.005   # small margin so roof faces always pick dark
    def house_color(co):
        return HOUSE_ROOF if co.z >= roof_z else HOUSE_WALL

    lib.apply_material_and_colors(obj, house_color)
    lib.apply_smooth_modifiers(obj, bevel_width=0.016, bevel_segments=2, subsurf_levels=1)
    return obj


# --------------------------------------------------------------------------- #
# Hotel builder
# Footprint ~0.50 x ~0.30, height ~0.35, base z=0.
# --------------------------------------------------------------------------- #

def build_hotel() -> bpy.types.Object:
    """
    Larger toy hotel: wide rectangular body + flat-ish pyramid roof.
    Red walls, dark roof — both baked as COLOR_0.
    Footprint: 0.50 (x) x 0.30 (y), total height 0.35, base at z=0.
    Forward axis: +Y (three.js +Z after Y-up export).
    """
    WALL_W  = 0.50    # x extent (wider than house)
    WALL_D  = 0.30    # y extent
    WALL_H  = 0.26    # body height
    ROOF_H  = 0.09    # low hip roof

    bm = bmesh.new()

    # --- Body ---
    add_box(bm, 0.0, 0.0, WALL_H / 2, WALL_W, WALL_D, WALL_H)

    # --- Hip roof ---
    add_hip_roof(
        bm, 0.0, 0.0,
        z_base=WALL_H,
        z_peak=WALL_H + ROOF_H,
        hx=WALL_W / 2 + 0.01,
        hy=WALL_D / 2 + 0.01,
    )

    obj = lib.finalize_bmesh(bm, "Hotel")

    roof_z = WALL_H - 0.005
    def hotel_color(co):
        return HOTEL_ROOF if co.z >= roof_z else HOTEL_WALL

    lib.apply_material_and_colors(obj, hotel_color)
    lib.apply_smooth_modifiers(obj, bevel_width=0.018, bevel_segments=2, subsurf_levels=1)
    return obj


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

BUILDINGS = {
    "house": build_house,
    "hotel": build_hotel,
}


def main() -> None:
    for name, builder in BUILDINGS.items():
        lib.reset_scene()
        obj = builder()
        out = lib.model_path("buildings", f"{name}.glb")
        lib.export_glb(obj, out)
        print(f"[gen_buildings] exported {name:8s} -> {out}")


if __name__ == "__main__":
    main()
