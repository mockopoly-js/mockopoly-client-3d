import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGameStore } from '../state/gameStore';
import { useIsMobile } from '../ui/useIsMobile';
import { getDebugVisibility, subscribeDebugVisibility } from '../dev/debugVisibility';
import { BOARD_LAYER } from './positions';
import { CLICK_TARGET_SPACES } from './clickTargets';
import {
  GLOW_ATTR,
  GLOW_EMIT_DAY,
  GLOW_EMIT_NIGHT,
  buildGlowGeometry,
  buildGlowMaterial,
  copyGlowSpec,
  createGlowSpec,
  glowInstanceMatrix,
  glowNightDefault,
  glowSpecEquals,
  resolveGlowSpecInto,
  seedGlowDebugVisibility,
} from './ownedGlow';

/**
 * ── OWNED-TILE GLOW (the R3F mount) ───────────────────────────────────────────
 *
 * A soft glow in the owner's token colour under every board tile that somebody owns;
 * tiles held through an active partnership are split into equity-proportional bands,
 * one per partner, separated by a dark seam. Ownership only — whose TURN it is is
 * cued three ways in the DOM HUD and is deliberately NOT repeated here.
 *
 * ONE draw call: a single 28-instance InstancedMesh sharing the click-target
 * ordering, so instance `i` covers exactly the space `CLICK_TARGET_SPACES[i]` does.
 * All the geometry/colour/material logic lives in ownedGlow.ts (pure, unit
 * tested); this file is the React/three wiring only. Mounted from
 * BoardClickTargets, which already owns the per-tile layout, so no new mount point
 * is needed in GameScene.
 *
 * THE THREE THINGS THAT WOULD SILENTLY BREAK IT
 * ---------------------------------------------
 * 1. LAYER. On mobile the pipeline renders the board and the scene in separate
 *    passes and depth-composites them. Glow quads therefore have to be on
 *    BOARD_LAYER (as BoardTiles' slab and the token blob shadows are) or the
 *    composite sorts them against the wrong depth buffer and they either punch
 *    through the board or vanish behind it. Set in a LAYOUT effect, keyed to
 *    isMobile, exactly like BoardTiles.
 * 2. NIGHT CRUSH. The night grade maps linear < ~0.029 to pure black, so the peak
 *    radiance is tuned per mode (GLOW_EMIT_DAY / GLOW_EMIT_NIGHT). See `night`.
 * 3. PER-FRAME COST. Nothing here runs in useFrame and nothing re-renders on state
 *    change: the component subscribes to the store IMPERATIVELY and writes instance
 *    buffers only when ownership/mortgage/partnership actually changed (an O(1)
 *    reference check rejects the ~8/sec camera-readout writes before any work).
 * 4. DEV LAYERS-PANEL TOGGLE. `?glow=0` used to unmount this component entirely
 *    (see the old `glowDisabled()` gate). It now only seeds the `glow` category in
 *    `src/dev/debugVisibility.ts` (see `seedGlowDebugVisibility`); the mesh always
 *    mounts and flips `.visible`, exactly like `board`/`city`/`tokens` below, so a
 *    dev can flip it back on live from the Layers panel without a reload.
 */

const COUNT = CLICK_TARGET_SPACES.length;

export interface OwnedTileGlowProps {
  /**
   * True when the scene is running the moonlit NIGHT rig, which needs its own peak
   * radiance (the day value would be lost in the ACES shoulder; a night value would
   * be invisible by day). Defaults to the mirrored GLOW_NIGHT_MODE constant — see
   * ownedGlow.ts for why, and pass this explicitly from GameScene when it can be
   * threaded.
   */
  night?: boolean;
}

export function OwnedTileGlow({ night }: OwnedTileGlowProps): React.JSX.Element {
  const isMobile = useIsMobile();
  const isNight = night ?? glowNightDefault(isMobile);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Geometry + material are built ONCE and never rebuilt: the quad footprint is
  // static and the only mode-dependent value (peak radiance) is a uniform.
  const geometry = useMemo(() => buildGlowGeometry(COUNT), []);
  const material = useMemo(() => buildGlowMaterial(GLOW_EMIT_DAY), []);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Day/night peak — a single uniform write, no material rebuild, no recompile.
  useEffect(() => {
    material.uniforms.uEmit.value = isNight ? GLOW_EMIT_NIGHT : GLOW_EMIT_DAY;
  }, [material, isNight]);

  // MOBILE ONLY: BOARD_LAYER, so the glow composites in the same pass as the board
  // slab it sits on. Desktop renders in one pass, so layer 0 is correct there.
  // Keyed to isMobile so a resize/orientation flip re-homes the mesh (BoardTiles
  // does the same for the slab).
  useLayoutEffect(() => {
    meshRef.current?.layers.set(isMobile ? BOARD_LAYER : 0);
  }, [isMobile]);

  // Static layout. Every instance is placed at FULL scale first so the bounding
  // sphere three caches covers the whole board (it is computed once and never
  // invalidated by later matrix writes), then all instances are collapsed to zero
  // scale — the initial "nothing is owned" state, and the state the ownership cache
  // below starts in.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < COUNT; i++) mesh.setMatrixAt(i, glowInstanceMatrix(i, true, m));
    mesh.computeBoundingSphere();
    for (let i = 0; i < COUNT; i++) mesh.setMatrixAt(i, glowInstanceMatrix(i, false, m));
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  // Ownership → instance buffers. Imperative store subscription (no re-render), with
  // a reference-equality early-out and a per-tile diff so a GPU upload only happens
  // when the board's ownership picture actually moved.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const geom = mesh.geometry;
    const aColorA = geom.getAttribute(GLOW_ATTR.colorA) as THREE.InstancedBufferAttribute;
    const aColorB = geom.getAttribute(GLOW_ATTR.colorB) as THREE.InstancedBufferAttribute;
    const aColorC = geom.getAttribute(GLOW_ATTR.colorC) as THREE.InstancedBufferAttribute;
    const aSplit = geom.getAttribute(GLOW_ATTR.split) as THREE.InstancedBufferAttribute;
    const aGlow = geom.getAttribute(GLOW_ATTR.glow) as THREE.InstancedBufferAttribute;

    // Preallocated, reused forever: the cache of what the GPU currently holds, one
    // scratch spec, and one scratch matrix. The update path allocates nothing.
    const cache = CLICK_TARGET_SPACES.map(() => createGlowSpec());
    const scratch = createGlowSpec();
    const m = new THREE.Matrix4();

    let lastProperties: unknown;
    let lastPartnerships: unknown;
    let lastPlayers: unknown;

    const apply = (s: ReturnType<typeof useGameStore.getState>) => {
      const properties = s.state?.properties;
      const partnerships = s.state?.partnerships;
      const players = s.state?.players;
      // The store also fires for toasts, panels and the ~8/sec camera readout. Those
      // never replace these three arrays, so three identity checks reject them.
      if (properties === lastProperties && partnerships === lastPartnerships && players === lastPlayers) {
        return;
      }
      lastProperties = properties;
      lastPartnerships = partnerships;
      lastPlayers = players;

      let colorsDirty = false;
      let matrixDirty = false;

      for (let i = 0; i < COUNT; i++) {
        if (properties && partnerships && players) {
          resolveGlowSpecInto(scratch, CLICK_TARGET_SPACES[i], properties, partnerships, players);
        } else {
          scratch.visible = false;
        }
        const cached = cache[i];
        if (glowSpecEquals(cached, scratch)) continue;

        // Visibility flips are the only thing that touches the instance matrix
        // (shown = full scale, hidden = zero scale ⇒ no fragments at all).
        if (cached.visible !== scratch.visible) {
          mesh.setMatrixAt(i, glowInstanceMatrix(i, scratch.visible, m));
          matrixDirty = true;
        }
        copyGlowSpec(cached, scratch);

        aColorA.setXYZ(i, scratch.colorA.r, scratch.colorA.g, scratch.colorA.b);
        aColorB.setXYZ(i, scratch.colorB.r, scratch.colorB.g, scratch.colorB.b);
        aColorC.setXYZ(i, scratch.colorC.r, scratch.colorC.g, scratch.colorC.b);
        aSplit.setXY(i, scratch.split0, scratch.split1);
        aGlow.setX(i, scratch.visible ? scratch.intensity : 0);
        colorsDirty = true;
      }

      if (colorsDirty) {
        aColorA.needsUpdate = true;
        aColorB.needsUpdate = true;
        aColorC.needsUpdate = true;
        aSplit.needsUpdate = true;
        aGlow.needsUpdate = true;
      }
      if (matrixDirty) mesh.instanceMatrix.needsUpdate = true;
    };

    apply(useGameStore.getState());
    return useGameStore.subscribe(apply);
  }, []);

  // DEV-ONLY: glow debug-visibility toggle (see src/dev/debugVisibility.ts).
  // Seeds the `glow` category's initial value from the `?glow=0` launch flag
  // (glowDisabled(), via seedGlowDebugVisibility — see ownedGlow.ts) once, then
  // subscribes to the shared debug flags and flips THIS MESH's `.visible` on
  // toggle — matching board/city/tokens exactly. `.visible`, not unmount: the
  // instanced mesh and its GPU buffers stay alive, so the Layers panel's A/B
  // measures the glow's draw cost, not a mount/unmount cliff. No per-frame
  // cost — only fires on tap. Entirely gated behind `import.meta.env.DEV`;
  // tree-shaken out of production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    seedGlowDebugVisibility();
    const apply = () => {
      if (meshRef.current) meshRef.current.visible = getDebugVisibility().glow;
    };
    apply();
    return subscribeDebugVisibility(apply);
  }, []);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, COUNT]}
      // Draws after the opaque board slab and BEFORE the token blob shadows
      // (renderOrder 2), so a token's contact shadow still darkens the glow it
      // stands on rather than being washed out by it.
      renderOrder={1}
      // Never a raycast target — BoardClickTargets' invisible pickers own picking,
      // and this quad is larger than a tile, so it must not steal hits.
      raycast={() => null}
    />
  );
}
