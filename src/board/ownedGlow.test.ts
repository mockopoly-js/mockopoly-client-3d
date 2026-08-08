import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { overrideLaunchQuery } from '../dev/urlFlags';
import {
  getDebugVisibility,
  setDebugVisibility,
  toggleDebugVisibility,
} from '../dev/debugVisibility';
import * as THREE from 'three';
import { BOARD_SPACES, PURCHASABLE_SPACES } from '../constants/board';
import { TOKEN_HEX } from '../constants/theme';
import type { Partnership, Player, PropertyState, TokenType } from '../types/GameState';
import { BOARD_WORLD_SIZE, tileToWorld } from './positions';
import { CLICK_TARGET_SPACES } from './clickTargets';
import {
  GLOW_COVER,
  GLOW_FEATHER,
  GLOW_FILL,
  GLOW_MORTGAGE_DIM,
  GLOW_NO_BAND,
  GLOW_POLYGON_OFFSET,
  GLOW_EMIT_DAY,
  GLOW_EMIT_NIGHT,
  GLOW_QUAD_D,
  GLOW_QUAD_W,
  GLOW_TILE_D,
  GLOW_TILE_W,
  GLOW_Y,
  buildGlowGeometry,
  buildGlowMaterial,
  copyGlowSpec,
  createGlowSpec,
  glowDisabled,
  glowInstanceMatrix,
  glowSpecEquals,
  glowTileYaw,
  resolveGlowSpecInto,
  resetGlowDebugVisibilitySeedForTests,
  seedGlowDebugVisibility,
} from './ownedGlow';

// ────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ────────────────────────────────────────────────────────────────────────────

function player(id: string, token: TokenType): Player {
  return {
    id,
    name: id,
    token,
    position: 0,
    money: 0,
    properties: [],
    isJailed: false,
    jailTurns: 0,
    jailCardCount: 0,
    isBankrupt: false,
    isConnected: true,
    isHost: false,
    isReady: true,
    reconnectToken: '',
    goDeductionsUsed: 0,
    goSkipsRemaining: 0,
  };
}

function prop(spaceIndex: number, ownerId: string | null, isMortgaged = false): PropertyState {
  return { spaceIndex, ownerId, houses: 0, hasHotel: false, isMortgaged };
}

function pact(
  colorGroup: Partnership['colorGroup'],
  partners: { playerId: string; percentage: number }[],
  status: Partnership['status'] = 'active',
): Partnership {
  return { partnershipId: `pact-${colorGroup}`, colorGroup, partners, status, createdAt: 0 };
}

const PLAYERS = [player('alice', 'red'), player('bob', 'blue'), player('cara', 'green')];

// Old Kent Road (1) and Whitechapel (3) are the two BROWN properties.
const BROWN_A = 1;
const BROWN_B = 3;
// Pall Mall — PINK, used for the "unrelated group" cases.
const PINK_A = 11;

const LUMA = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * Independent re-derivation of the expected band colour: sRGB hex → linear working
 * space → full value → half-way luminance equalisation (see normaliseGlowColor).
 * Written out longhand rather than imported so the tests actually check the mapping.
 */
function expectedBandColor(token: TokenType): THREE.Color {
  const c = new THREE.Color().setStyle(TOKEN_HEX[token]);
  c.multiplyScalar(1 / Math.max(c.r, c.g, c.b));
  return c.multiplyScalar(Math.sqrt(0.45 / LUMA(c)));
}

/** Exact float signature of a linear colour (getHexString clamps >1 channels). */
function sig(c: THREE.Color): string {
  return [c.r, c.g, c.b].map((v) => v.toFixed(5)).join(',');
}

/** Hue signature: channel ratios, invariant to any uniform brightness scaling. */
function chroma(c: THREE.Color): [number, number] {
  const m = Math.max(c.r, c.g, c.b);
  return [c.r / m, c.g / m];
}

// ────────────────────────────────────────────────────────────────────────────
// LAYOUT — the quad footprint must come from the ring math, not magic numbers
// ────────────────────────────────────────────────────────────────────────────

describe('ownedGlow — tile footprint', () => {
  it('derives the regular-tile size from positions.ts (0.8133 × 1.34 world units)', () => {
    expect(GLOW_TILE_W).toBeCloseTo((1 - 2 * 0.134) / 9 * BOARD_WORLD_SIZE, 6);
    expect(GLOW_TILE_D).toBeCloseTo(0.134 * BOARD_WORLD_SIZE, 6);
  });

  it('matches the actual spacing of adjacent tiles on every board side', () => {
    // bottom row, left column, top row, right column — consecutive purchasable
    // neighbours are exactly one tile width apart along their shared row axis.
    const pairs: [number, number][] = [[6, 8], [16, 18], [26, 27], [31, 32]];
    for (const [a, b] of pairs) {
      const [ax, , az] = tileToWorld(a);
      const [bx, , bz] = tileToWorld(b);
      const gap = Math.hypot(ax - bx, az - bz);
      // 8-6 = 2 tiles, 18-16 = 2 tiles, 27-26 = 1, 32-31 = 1
      const steps = Math.abs(b - a);
      expect(gap / steps).toBeCloseTo(GLOW_TILE_W, 6);
    }
  });

  it('the quad is the tile plus one feather margin per side', () => {
    expect(GLOW_QUAD_W).toBeCloseTo(GLOW_TILE_W + 2 * GLOW_FEATHER, 10);
    expect(GLOW_QUAD_D).toBeCloseTo(GLOW_TILE_D + 2 * GLOW_FEATHER, 10);
  });

  it('sits above the board artwork plane (0.02) with real depth clearance', () => {
    // Clearance alone is not enough (the board top is polygonOffset(-1,-1)), which is
    // why the material carries a LARGER negative offset — assert both halves.
    expect(GLOW_Y).toBeGreaterThan(0.02 + 0.005);
    expect(GLOW_POLYGON_OFFSET).toBeLessThan(-1);
  });

  it('the night emission clears the night grade black-crush floor (~0.029 linear)', () => {
    // The night grade maps linear < ~0.029 to pure black. The rim emits EMIT_NIGHT on
    // top of (1 - COVER) of the board, so the emission alone must clear the floor with
    // room to spare or a night glow over a near-black tile disappears entirely.
    expect(GLOW_EMIT_NIGHT).toBeGreaterThan(0.029 * 3);
    // Day has to compete with a board lit several times brighter, so it must emit more.
    expect(GLOW_EMIT_DAY).toBeGreaterThan(GLOW_EMIT_NIGHT);
  });

  it('covers part of the board so the hue lands even where the board is blown out', () => {
    // COVER is the half of the blend that does NOT depend on lighting mode: without
    // it a day glow is invisible (measured), with it the tint always reads.
    expect(GLOW_COVER).toBeGreaterThan(0.1);
    expect(GLOW_COVER).toBeLessThan(0.5);
    // ...but the interior wash must leave most of the printed artwork showing through.
    expect(GLOW_FILL * GLOW_COVER).toBeLessThan(0.2);
  });
});

describe('ownedGlow — per-tile transform', () => {
  it('orients every purchasable tile so local +Y points INWARD and +X runs along the row', () => {
    for (const spaceIndex of PURCHASABLE_SPACES) {
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI / 2, glowTileYaw(spaceIndex), 0, 'YXZ'),
      );
      const [wx, , wz] = tileToWorld(spaceIndex);
      const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);

      // Inward = perpendicular to the board edge the tile sits on, pointing at the
      // board. Derived independently of glowTileYaw: for a non-corner tile the axis
      // it is pinned to always has the larger magnitude (|4.33| vs at most |3.67|).
      const inward = Math.abs(wz) > Math.abs(wx)
        ? new THREE.Vector3(0, 0, -Math.sign(wz))
        : new THREE.Vector3(-Math.sign(wx), 0, 0);
      expect(localY.dot(inward)).toBeCloseTo(1, 5);
      // The row axis is perpendicular to inward, and the quad always faces up.
      expect(Math.abs(localX.dot(inward))).toBeCloseTo(0, 5);
      expect(normal.dot(new THREE.Vector3(0, 1, 0))).toBeCloseTo(1, 5);
    }
  });

  it('places instance i over CLICK_TARGET_SPACES[i] at GLOW_Y', () => {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < CLICK_TARGET_SPACES.length; i++) {
      glowInstanceMatrix(i, true, m);
      p.setFromMatrixPosition(m);
      const [wx, , wz] = tileToWorld(CLICK_TARGET_SPACES[i]);
      expect(p.x).toBeCloseTo(wx, 10);
      expect(p.y).toBeCloseTo(GLOW_Y, 10);
      expect(p.z).toBeCloseTo(wz, 10);
    }
  });

  it('hides a tile by collapsing the instance to zero scale (no fragments at all)', () => {
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    glowInstanceMatrix(0, false, m);
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    expect(s.z).toBe(0);

    glowInstanceMatrix(0, true, m);
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.x).toBeCloseTo(1, 10);
  });

  it('never allocates on the update path (repeated calls reuse module scratch)', () => {
    const a = new THREE.Matrix4();
    const b = new THREE.Matrix4();
    glowInstanceMatrix(5, true, a);
    glowInstanceMatrix(5, true, b);
    expect(a.elements).toEqual(b.elements);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// OWNERSHIP → COLOUR
// ────────────────────────────────────────────────────────────────────────────

describe('ownedGlow — solo ownership → colour', () => {
  it('an unowned tile is not drawn', () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(out, BROWN_A, [prop(BROWN_A, null)], [], PLAYERS);
    expect(out.visible).toBe(false);
  });

  it('a tile with no PropertyState at all is not drawn', () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(out, BROWN_A, [], [], PLAYERS);
    expect(out.visible).toBe(false);
  });

  it("a solo-owned tile glows in the owner's token colour across the whole tile", () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(out, BROWN_A, [prop(BROWN_A, 'alice')], [], PLAYERS);
    expect(out.visible).toBe(true);
    expect(out.intensity).toBe(1);
    // No band boundary is reachable, so band A covers 0..1 — solo by construction.
    expect(out.split0).toBe(GLOW_NO_BAND);
    expect(out.split1).toBe(GLOW_NO_BAND);
    expect(sig(out.colorA)).toBe(sig(expectedBandColor('red')));
  });

  it('uses the real TOKEN_HEX map — a different token gives a different colour', () => {
    const a = createGlowSpec();
    const b = createGlowSpec();
    resolveGlowSpecInto(a, BROWN_A, [prop(BROWN_A, 'alice')], [], PLAYERS);
    resolveGlowSpecInto(b, BROWN_A, [prop(BROWN_A, 'bob')], [], PLAYERS);
    expect(sig(a.colorA)).not.toBe(sig(b.colorA));
    expect(sig(b.colorA)).toBe(sig(expectedBandColor('blue')));
  });

  it('preserves the token hue while equalising perceived brightness', () => {
    const out = createGlowSpec();
    for (const [id, token] of [['alice', 'red'], ['bob', 'blue'], ['cara', 'green']] as const) {
      resolveGlowSpecInto(out, BROWN_A, [prop(BROWN_A, id)], [], PLAYERS);
      // Hue is intact: the channel RATIOS still match the raw linear token colour.
      const raw = new THREE.Color().setStyle(TOKEN_HEX[token]);
      expect(chroma(out.colorA)[0]).toBeCloseTo(chroma(raw)[0], 6);
      expect(chroma(out.colorA)[1]).toBeCloseTo(chroma(raw)[1], 6);
    }
  });

  it('lands every token colour within a narrow luminance band (no shouty green)', () => {
    // Raw TOKEN_HEX luminances span ~5x (green 0.62 vs red 0.19). After normalisation
    // every band must sit close enough that ONE emission constant reads the same for
    // all eight players — the un-equalised first render had green ~2x blue.
    const out = createGlowSpec();
    const lumas: number[] = [];
    for (const [id] of [['alice'], ['bob'], ['cara']] as const) {
      resolveGlowSpecInto(out, BROWN_A, [prop(BROWN_A, id)], [], PLAYERS);
      lumas.push(LUMA(out.colorA));
    }
    const rawLumas = (['red', 'blue', 'green'] as const).map((t) => {
      const c = new THREE.Color().setStyle(TOKEN_HEX[t]);
      c.multiplyScalar(1 / Math.max(c.r, c.g, c.b));
      return LUMA(c);
    });
    const spread = Math.max(...lumas) / Math.min(...lumas);
    const rawSpread = Math.max(...rawLumas) / Math.min(...rawLumas);
    expect(rawSpread).toBeGreaterThan(2.5);   // green is ~3x red before equalisation
    expect(spread).toBeLessThan(1.8);         // ...and well under 2x after
    expect(spread).toBeLessThan(rawSpread);
  });

  it('falls back to a neutral colour when the owner has left the roster', () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(out, BROWN_A, [prop(BROWN_A, 'ghost')], [], PLAYERS);
    expect(out.visible).toBe(true);
    expect(sig(out.colorA)).not.toBe(sig(expectedBandColor('red')));
  });

  it('resolves every purchasable space (no gaps in the board mapping)', () => {
    const out = createGlowSpec();
    const properties = PURCHASABLE_SPACES.map((i) => prop(i, 'alice'));
    for (const i of PURCHASABLE_SPACES) {
      resolveGlowSpecInto(out, i, properties, [], PLAYERS);
      expect(out.visible).toBe(true);
      expect(out.split0).toBe(GLOW_NO_BAND);
    }
  });
});

describe('ownedGlow — partnership', () => {
  it('splits a partnered tile into equity-proportional bands, deed holder first', () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(
      out,
      BROWN_A,
      [prop(BROWN_A, 'alice')],
      [pact('brown', [{ playerId: 'alice', percentage: 60 }, { playerId: 'bob', percentage: 40 }])],
      PLAYERS,
    );
    expect(out.visible).toBe(true);
    // Band A = deed holder (alice/red) over 0..0.6, band B = partner (bob/blue) 0.6..1.
    expect(sig(out.colorA)).toBe(sig(expectedBandColor('red')));
    expect(sig(out.colorB)).toBe(sig(expectedBandColor('blue')));
    expect(out.split0).toBeCloseTo(0.6, 10);
    expect(out.split1).toBe(GLOW_NO_BAND);
  });

  it('is visually distinguishable from solo: a solo tile has NO reachable boundary', () => {
    const solo = createGlowSpec();
    const shared = createGlowSpec();
    resolveGlowSpecInto(solo, BROWN_A, [prop(BROWN_A, 'alice')], [], PLAYERS);
    resolveGlowSpecInto(
      shared,
      BROWN_A,
      [prop(BROWN_A, 'alice')],
      [pact('brown', [{ playerId: 'alice', percentage: 50 }, { playerId: 'bob', percentage: 50 }])],
      PLAYERS,
    );
    // The shader selects bands with step(split, s), s ∈ [0,1]: > 1 can never fire.
    expect(solo.split0).toBeGreaterThan(1);
    expect(shared.split0).toBeLessThan(1);
    expect(shared.split0).toBeGreaterThan(0);
    expect(sig(shared.colorA)).not.toBe(sig(shared.colorB));
  });

  it('puts the DEED HOLDER in band A even when they are the minority partner', () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(
      out,
      BROWN_A,
      [prop(BROWN_A, 'bob')],
      [pact('brown', [{ playerId: 'alice', percentage: 70 }, { playerId: 'bob', percentage: 30 }])],
      PLAYERS,
    );
    expect(sig(out.colorA)).toBe(sig(expectedBandColor('blue'))); // bob, deed
    expect(sig(out.colorB)).toBe(sig(expectedBandColor('red')));  // alice, 70%
    expect(out.split0).toBeCloseTo(0.3, 10);
  });

  it('supports three partners (two boundaries, cumulative)', () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(
      out,
      BROWN_A,
      [prop(BROWN_A, 'alice')],
      [pact('brown', [
        { playerId: 'alice', percentage: 50 },
        { playerId: 'bob', percentage: 30 },
        { playerId: 'cara', percentage: 20 },
      ])],
      PLAYERS,
    );
    expect(out.split0).toBeCloseTo(0.5, 10);
    expect(out.split1).toBeCloseTo(0.8, 10);
    expect(sig(out.colorA)).toBe(sig(expectedBandColor('red')));
    expect(sig(out.colorB)).toBe(sig(expectedBandColor('blue')));
    expect(sig(out.colorC)).toBe(sig(expectedBandColor('green')));
  });

  it('orders non-owner partners by DESCENDING equity', () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(
      out,
      BROWN_A,
      [prop(BROWN_A, 'alice')],
      [pact('brown', [
        { playerId: 'alice', percentage: 20 },
        { playerId: 'bob', percentage: 30 },
        { playerId: 'cara', percentage: 50 },
      ])],
      PLAYERS,
    );
    // alice (deed) 20% first, then cara 50%, then bob 30%.
    expect(sig(out.colorB)).toBe(sig(expectedBandColor('green')));
    expect(sig(out.colorC)).toBe(sig(expectedBandColor('blue')));
    expect(out.split0).toBeCloseTo(0.2, 10);
    expect(out.split1).toBeCloseTo(0.7, 10);
  });

  it('normalises equity that does not sum to 100', () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(
      out,
      BROWN_A,
      [prop(BROWN_A, 'alice')],
      [pact('brown', [{ playerId: 'alice', percentage: 30 }, { playerId: 'bob', percentage: 10 }])],
      PLAYERS,
    );
    expect(out.split0).toBeCloseTo(0.75, 10);
  });

  it('ignores a PENDING partnership — the tile is still solo', () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(
      out,
      BROWN_A,
      [prop(BROWN_A, 'alice')],
      [pact('brown', [{ playerId: 'alice', percentage: 60 }, { playerId: 'bob', percentage: 40 }], 'pending')],
      PLAYERS,
    );
    expect(out.split0).toBe(GLOW_NO_BAND);
  });

  it('ignores a partnership in a DIFFERENT colour group', () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(
      out,
      PINK_A,
      [prop(PINK_A, 'alice')],
      [pact('brown', [{ playerId: 'alice', percentage: 60 }, { playerId: 'bob', percentage: 40 }])],
      PLAYERS,
    );
    expect(BOARD_SPACES[PINK_A].colorGroup).toBe('pink');
    expect(out.split0).toBe(GLOW_NO_BAND);
  });

  it('a property in a partnered group owned by an OUTSIDER stays solo', () => {
    // The group is partnered by alice+bob, but cara owns this deed and is not in the
    // pact — it is hers alone, and must not be painted as shared.
    const out = createGlowSpec();
    resolveGlowSpecInto(
      out,
      BROWN_B,
      [prop(BROWN_A, 'alice'), prop(BROWN_B, 'cara')],
      [pact('brown', [{ playerId: 'alice', percentage: 60 }, { playerId: 'bob', percentage: 40 }])],
      PLAYERS,
    );
    expect(out.split0).toBe(GLOW_NO_BAND);
    expect(sig(out.colorA)).toBe(sig(expectedBandColor('green')));
  });

  it('both partners see the SAME split widths on their own deeds', () => {
    const properties = [prop(BROWN_A, 'alice'), prop(BROWN_B, 'bob')];
    const partnerships = [
      pact('brown', [{ playerId: 'alice', percentage: 60 }, { playerId: 'bob', percentage: 40 }]),
    ];
    const a = createGlowSpec();
    const b = createGlowSpec();
    resolveGlowSpecInto(a, BROWN_A, properties, partnerships, PLAYERS);
    resolveGlowSpecInto(b, BROWN_B, properties, partnerships, PLAYERS);
    // alice's deed: 60 red | 40 blue.  bob's deed: 40 blue | 60 red — deed holder
    // always leads, so the leading band width IS that player's own equity.
    expect(a.split0).toBeCloseTo(0.6, 10);
    expect(b.split0).toBeCloseTo(0.4, 10);
    expect(sig(a.colorA)).toBe(sig(b.colorB));
    expect(sig(a.colorB)).toBe(sig(b.colorA));
  });

  it('clamps a >3-partner pact to the 3 shader bands without losing tile coverage', () => {
    const out = createGlowSpec();
    const four = [
      player('alice', 'red'), player('bob', 'blue'), player('cara', 'green'), player('dan', 'yellow'),
    ];
    resolveGlowSpecInto(
      out,
      BROWN_A,
      [prop(BROWN_A, 'alice')],
      [pact('brown', [
        { playerId: 'alice', percentage: 25 },
        { playerId: 'bob', percentage: 25 },
        { playerId: 'cara', percentage: 25 },
        { playerId: 'dan', percentage: 25 },
      ])],
      four,
    );
    expect(out.split0).toBeCloseTo(0.25, 10);
    // The 4th partner's equity is folded into the last band, so the bands still
    // tile the whole space (last boundary < 1, band C runs to the edge).
    expect(out.split1).toBeCloseTo(0.5, 10);
    expect(out.split1).toBeLessThan(1);
  });

  it('falls back to an even split when all equity is zero', () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(
      out,
      BROWN_A,
      [prop(BROWN_A, 'alice')],
      [pact('brown', [{ playerId: 'alice', percentage: 0 }, { playerId: 'bob', percentage: 0 }])],
      PLAYERS,
    );
    expect(out.split0).toBeCloseTo(0.5, 10);
  });
});

describe('ownedGlow — mortgaged', () => {
  it('dims and desaturates a mortgaged tile relative to a live one', () => {
    const live = createGlowSpec();
    const dead = createGlowSpec();
    resolveGlowSpecInto(live, BROWN_A, [prop(BROWN_A, 'alice')], [], PLAYERS);
    resolveGlowSpecInto(dead, BROWN_A, [prop(BROWN_A, 'alice', true)], [], PLAYERS);

    expect(live.intensity).toBe(1);
    expect(dead.intensity).toBe(GLOW_MORTGAGE_DIM);
    expect(dead.intensity).toBeLessThan(live.intensity);

    // Desaturated: the channel spread collapses toward the colour's own luminance.
    const spread = (c: THREE.Color) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    expect(spread(dead.colorA)).toBeLessThan(spread(live.colorA) * 0.5);
  });

  it('keeps the mortgage treatment on partnership bands too', () => {
    const out = createGlowSpec();
    resolveGlowSpecInto(
      out,
      BROWN_A,
      [prop(BROWN_A, 'alice', true)],
      [pact('brown', [{ playerId: 'alice', percentage: 60 }, { playerId: 'bob', percentage: 40 }])],
      PLAYERS,
    );
    expect(out.intensity).toBe(GLOW_MORTGAGE_DIM);
    expect(out.split0).toBeCloseTo(0.6, 10);
    const spread = (c: THREE.Color) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    expect(spread(out.colorA)).toBeLessThan(0.5);
    expect(spread(out.colorB)).toBeLessThan(0.5);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DIFF / CACHE — the "only upload when ownership actually changed" contract
// ────────────────────────────────────────────────────────────────────────────

describe('ownedGlow — change detection', () => {
  it('two hidden specs are equal regardless of stale colour data', () => {
    const a = createGlowSpec();
    const b = createGlowSpec();
    resolveGlowSpecInto(a, BROWN_A, [prop(BROWN_A, 'alice')], [], PLAYERS);
    copyGlowSpec(b, a);
    a.visible = false;
    b.visible = false;
    b.colorA.setRGB(1, 1, 1, THREE.LinearSRGBColorSpace);
    expect(glowSpecEquals(a, b)).toBe(true);
  });

  it('detects owner, mortgage and partnership changes', () => {
    const cached = createGlowSpec();
    const next = createGlowSpec();
    const base = [prop(BROWN_A, 'alice')];
    resolveGlowSpecInto(cached, BROWN_A, base, [], PLAYERS);

    // Same input → no upload.
    resolveGlowSpecInto(next, BROWN_A, base, [], PLAYERS);
    expect(glowSpecEquals(cached, next)).toBe(true);

    // New owner → upload.
    resolveGlowSpecInto(next, BROWN_A, [prop(BROWN_A, 'bob')], [], PLAYERS);
    expect(glowSpecEquals(cached, next)).toBe(false);

    // Mortgaged → upload.
    resolveGlowSpecInto(next, BROWN_A, [prop(BROWN_A, 'alice', true)], [], PLAYERS);
    expect(glowSpecEquals(cached, next)).toBe(false);

    // Partnership formed → upload.
    resolveGlowSpecInto(
      next,
      BROWN_A,
      base,
      [pact('brown', [{ playerId: 'alice', percentage: 60 }, { playerId: 'bob', percentage: 40 }])],
      PLAYERS,
    );
    expect(glowSpecEquals(cached, next)).toBe(false);

    // Sold → hidden, which is also a change.
    resolveGlowSpecInto(next, BROWN_A, [prop(BROWN_A, null)], [], PLAYERS);
    expect(glowSpecEquals(cached, next)).toBe(false);
  });

  it('copyGlowSpec makes the two specs compare equal without sharing Color instances', () => {
    const a = createGlowSpec();
    const b = createGlowSpec();
    resolveGlowSpecInto(a, BROWN_A, [prop(BROWN_A, 'alice')], [], PLAYERS);
    copyGlowSpec(b, a);
    expect(glowSpecEquals(a, b)).toBe(true);
    expect(b.colorA).not.toBe(a.colorA);
    b.colorA.setRGB(0, 0, 0, THREE.LinearSRGBColorSpace);
    expect(sig(a.colorA)).toBe(sig(expectedBandColor('red')));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GPU RESOURCES — one draw call, additive, non-depth-writing, unlit
// ────────────────────────────────────────────────────────────────────────────

describe('ownedGlow — geometry + material', () => {
  it('builds one instanced quad with all five per-instance attributes', () => {
    const geom = buildGlowGeometry(CLICK_TARGET_SPACES.length);
    for (const name of ['aColorA', 'aColorB', 'aColorC', 'aSplit', 'aGlow']) {
      const attr = geom.getAttribute(name);
      expect(attr).toBeDefined();
      expect((attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute).toBe(true);
      expect(attr.count).toBe(CLICK_TARGET_SPACES.length);
    }
    // A single 4-vertex quad — the whole layer is one draw call.
    expect(geom.getAttribute('position').count).toBe(4);
    geom.dispose();
  });

  it('is unlit, premultiplied over rgb only, and does not write depth', () => {
    const mat = buildGlowMaterial(GLOW_EMIT_DAY);
    // Unlit ⇒ shadowMap.enabled injects no shadow GLSL ⇒ no mediump iOS landmine.
    expect(mat.lights).toBe(false);
    expect(mat.depthWrite).toBe(false);
    expect(mat.depthTest).toBe(true);
    expect(mat.transparent).toBe(true);
    expect(mat.blending).toBe(THREE.CustomBlending);
    // Premultiplied "over": rgb = src + dst*(1-srcAlpha).
    expect(mat.blendSrc).toBe(THREE.OneFactor);
    expect(mat.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    // Destination alpha is preserved — the board FBO's alpha must stay untouched.
    expect(mat.blendSrcAlpha).toBe(THREE.ZeroFactor);
    expect(mat.blendDstAlpha).toBe(THREE.OneFactor);
    expect(mat.precision).toBe('highp');
    expect(mat.fog).toBe(false);
    expect(mat.uniforms.uEmit.value).toBe(GLOW_EMIT_DAY);
    mat.dispose();
  });

  it('bakes the derived tile size into the shader and adds no post-processing pass', () => {
    const mat = buildGlowMaterial(GLOW_EMIT_NIGHT);
    expect(mat.fragmentShader).toContain((GLOW_TILE_W / 2).toFixed(5));
    expect(mat.fragmentShader).toContain((GLOW_TILE_D / 2).toFixed(5));
    // No derivatives: a GLSL ES 1.00 shader using fwidth can fail to compile on iOS,
    // and a failed compile renders INVISIBLE rather than wrong.
    expect(mat.fragmentShader).not.toMatch(/fwidth|dFdx|dFdy/);
    // Linear radiance out — the grade chain owns tonemapping + sRGB encode.
    expect(mat.fragmentShader).not.toContain('tonemapping_fragment');
    expect(mat.fragmentShader).not.toContain('colorspace_fragment');
    mat.dispose();
  });
});

/**
 * THE DEV KILL SWITCH.
 *
 * The glow is a FILL-BOUND layer, and fill cost is the one thing a desktop
 * harness cannot answer for a phone: the DOM rasterises at the device dpr while
 * the renderer is capped at 2. Until this existed the only way to A/B the layer
 * on a real device was a rebuild, which is not an A/B. Its whole contract is
 * "off only when explicitly asked", because a flag that fires by accident turns
 * a perf run into a measurement of the wrong build.
 */
describe('ownedGlow — ?glow=0 DEV override', () => {
  // The flag is read from the LAUNCH query, snapshotted at boot, because the
  // router rewrites the URL to a bare `/game` before the glow ever mounts —
  // so a test that poked window.location would be testing a path the app does
  // not use. See src/dev/urlFlags.ts.
  const search = (q: string) => { overrideLaunchQuery(q); };
  afterEach(() => { overrideLaunchQuery(''); });

  it('is OFF by default — no query string, no override', () => {
    expect(glowDisabled()).toBe(false);
  });

  it('disables on ?glow=0 and ?glow=false', () => {
    search('?glow=0');
    expect(glowDisabled()).toBe(true);
    search('?glow=false');
    expect(glowDisabled()).toBe(true);
  });

  it('a bare ?glow, or any other value, leaves the glow ON', () => {
    // A truthy-ish parse here would mean `?glow` — the thing you type when you
    // mean "show me the glow" — silently deleting the layer under measurement.
    for (const q of ['?glow', '?glow=1', '?glow=true', '?glow=on']) {
      search(q);
      expect(glowDisabled(), q).toBe(false);
    }
  });

  it('is not the day/night knob — ?glowNight does not touch it', () => {
    for (const q of ['?glowNight=0', '?glowNight=1']) {
      search(q);
      expect(glowDisabled(), q).toBe(false);
    }
  });
});

/**
 * THE LAYERS-PANEL "Owned-Tile Glow" TOGGLE.
 *
 * `?glow=0` used to unmount OwnedTileGlow entirely; it now only seeds the
 * `glow` category in `src/dev/debugVisibility.ts` via `seedGlowDebugVisibility`
 * (called from OwnedTileGlow's mount effect), and the mesh stays mounted with
 * `.visible` driven by that category — so the panel can flip it back on live.
 *
 * Two singletons need resetting per test, neither with automatic isolation:
 * `debugVisibility`'s flags object (restored to `glow: true`, its default) and
 * `seedGlowDebugVisibility`'s own "already seeded" guard (via
 * `resetGlowDebugVisibilitySeedForTests`), which otherwise makes every test
 * after the first one a no-op.
 */
describe('ownedGlow — seedGlowDebugVisibility (the Layers-panel toggle)', () => {
  const search = (q: string) => { overrideLaunchQuery(q); };
  beforeEach(() => {
    setDebugVisibility('glow', true);
    resetGlowDebugVisibilitySeedForTests();
  });
  afterEach(() => {
    overrideLaunchQuery('');
    setDebugVisibility('glow', true);
    resetGlowDebugVisibilitySeedForTests();
  });

  it('is a no-op when ?glow is absent — glow stays at its default, ON', () => {
    search('');
    seedGlowDebugVisibility();
    expect(getDebugVisibility().glow).toBe(true);
  });

  it('seeds `glow` OFF on ?glow=0 and ?glow=false', () => {
    for (const q of ['?glow=0', '?glow=false']) {
      setDebugVisibility('glow', true);
      resetGlowDebugVisibilitySeedForTests();
      search(q);
      seedGlowDebugVisibility();
      expect(getDebugVisibility().glow, q).toBe(false);
    }
  });

  it('a bare ?glow, or any other value, leaves `glow` ON — same contract as glowDisabled()', () => {
    for (const q of ['?glow', '?glow=1', '?glow=true']) {
      setDebugVisibility('glow', true);
      resetGlowDebugVisibilitySeedForTests();
      search(q);
      seedGlowDebugVisibility();
      expect(getDebugVisibility().glow, q).toBe(true);
    }
  });

  it('the seeded-OFF value can still be flipped back on live — the whole point of using .visible, not unmount', () => {
    search('?glow=0');
    seedGlowDebugVisibility();
    expect(getDebugVisibility().glow).toBe(false);
    toggleDebugVisibility('glow');
    expect(getDebugVisibility().glow).toBe(true);
  });

  it('never stomps a value the dev already restored — re-seeding after a manual re-enable is a no-op', () => {
    search('?glow=0');
    seedGlowDebugVisibility();
    toggleDebugVisibility('glow'); // dev flips it back on from the panel
    expect(getDebugVisibility().glow).toBe(true);
    seedGlowDebugVisibility(); // e.g. a hypothetical re-mount — must not re-hide it
    expect(getDebugVisibility().glow).toBe(true);
  });
});
