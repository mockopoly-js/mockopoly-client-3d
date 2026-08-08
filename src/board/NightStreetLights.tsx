import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { BOARD_WORLD_SIZE } from './positions';

/**
 * ── MOBILE NIGHT-ONLY: cheap street-lamp glow markers (NOT real lights) ───────
 * A modest ring of small warm-EMISSIVE spheres around the board's outer perimeter that
 * read as street lamps at night. They cast NO real light (a fill-bound mobile path can't
 * afford many point lights) — they are pure emissive geometry, so they glow as bright
 * warm dots regardless of scene lighting (and will really pop once the wave-2 bloom pass
 * lands). ONE instanced draw for the whole ring (cheap), frustum-culled off (they ring
 * the board so are almost always partly on screen; the instance is tiny). Mounted ONLY
 * when isMobile && MOBILE_NIGHT_MODE && MOBILE_NIGHT_STREETLIGHTS (see GameScene) → day +
 * desktop never build it. Rendered at scene root in WORLD space: the board is a 10-unit
 * square centred at the origin (axis-aligned world footprint regardless of BOARD_ROTATION),
 * so a world-space square ring at ±RING_HALF surrounds it.
 *
 * iOS-safe: a plain highp MeshStandard emissive material drawn in the scene pass with
 * shadowMap.enabled=false (layer 0) — no mediump, no shadow GLSL, no shadow-pipeline touch.
 */

// ── TUNABLES (count / spacing / look) ─────────────────────────────────────────
const STREETLIGHT_COUNT_PER_SIDE = 5; // lamps per board edge → ×4 sides = 20 total (modest)
const STREETLIGHT_RING_HALF = BOARD_WORLD_SIZE / 2 + 0.25; // ring half-extent — just outside the board edge
const STREETLIGHT_HEIGHT = 0.75; // world Y of the glowing bulb above the board surface (lamp height)
const STREETLIGHT_RADIUS = 0.09; // bulb sphere radius
const STREETLIGHT_COLOR = '#ffcf8a'; // warm sodium-lamp glow
const STREETLIGHT_INTENSITY = 2.5; // emissiveIntensity — reads as a bright warm dot (bloom wave 2 amplifies)

/** Even markers along the 4 board edges (corner offset by half a step → no corner dup). */
function computePositions(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const H = STREETLIGHT_RING_HALF;
  const n = STREETLIGHT_COUNT_PER_SIDE;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n; // 0..1 along the edge
      const a = -H + 2 * H * t;
      let x: number;
      let z: number;
      if (side === 0) {
        x = a;
        z = -H;
      } else if (side === 1) {
        x = H;
        z = a;
      } else if (side === 2) {
        x = -a;
        z = H;
      } else {
        x = -H;
        z = -a;
      }
      pts.push(new THREE.Vector3(x, STREETLIGHT_HEIGHT, z));
    }
  }
  return pts;
}

export function NightStreetLights(): React.JSX.Element {
  const positions = useMemo(computePositions, []);
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    positions.forEach((p, i) => {
      m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, positions.length]}
      frustumCulled={false}
    >
      <sphereGeometry args={[STREETLIGHT_RADIUS, 8, 8]} />
      <meshStandardMaterial
        color={STREETLIGHT_COLOR}
        emissive={STREETLIGHT_COLOR}
        emissiveIntensity={STREETLIGHT_INTENSITY}
        roughness={1}
        metalness={0}
      />
    </instancedMesh>
  );
}
