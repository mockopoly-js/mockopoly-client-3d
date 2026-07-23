import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameBusEvent } from '../state/useGameBus';
import { FACE_NORMAL, resolveQuaternion } from './dice-orientation';

// ---- Geometry / placement constants -----------------------------------------
const DIE_SIZE = 0.5;               // cube edge length
const HALF = DIE_SIZE / 2;
const DIE_Y = 1.6;                  // hover height above the board plane
const DIE_X_OFFSET = 0.4;           // the two dice sit at ±this on x
const PIP_RADIUS = 0.045;           // pip disc radius
const PIP_GRID = DIE_SIZE * 0.28;   // half-spacing of the 3×3 pip grid
const PIP_INSET = 0.001;            // lift pips just off the face to avoid z-fight

// ---- Animation phase timings (ms) -------------------------------------------
const TUMBLE_MS = 450;   // Phase A: fast multi-axis spin, ease-out
const SETTLE_MS = 250;   // Phase B: slerp to the resolved (server) orientation
const RESOLVE_MS = TUMBLE_MS + SETTLE_MS; // 700ms — under the ~800ms server pace
const HOLD_MS = 1000;    // hold the result before hiding
const POP_MS = 160;      // landing scale-pop duration

// Standard pip 3×3 grid: which of the 9 cells are filled for each value.
// Cell index 0..8 laid out row-major:  0 1 2 / 3 4 5 / 6 7 8
const PIP_CELLS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// Map a 3×3 cell index to a (u, v) offset in {-1, 0, 1} plane units.
function cellUV(cell: number): [number, number] {
  const col = cell % 3;       // 0,1,2 → -1,0,1  (u)
  const row = Math.floor(cell / 3); // 0,1,2 → +1,0,-1 (v, top row = +v)
  return [col - 1, 1 - row];
}

/**
 * For a face value, return two in-plane basis vectors (u, v) orthogonal to that
 * face's outward normal, so pips can be laid on a 3×3 grid. Any consistent basis
 * works — the value shown depends only on the normal (via resolveQuaternion),
 * not on the pip rotation within the face.
 */
function faceBasis(normal: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  // Pick a reference not parallel to the normal.
  const ref =
    Math.abs(normal.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(ref, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return [u, v];
}

interface PipSpec {
  pos: [number, number, number];
  quat: [number, number, number, number];
}

/**
 * Precompute all 21 pip transforms for a die, placed along the exact
 * FACE_NORMAL directions so a resolved face shows the correct value.
 */
function buildPips(): PipSpec[] {
  const pips: PipSpec[] = [];
  const zAxis = new THREE.Vector3(0, 0, 1); // disc geometry faces +Z by default
  for (let value = 1; value <= 6; value++) {
    const n = new THREE.Vector3(...FACE_NORMAL[value]).normalize();
    const [u, v] = faceBasis(n);
    // Orient the disc so its face aligns with the outward normal.
    const quat = new THREE.Quaternion().setFromUnitVectors(zAxis, n);
    for (const cell of PIP_CELLS[value]) {
      const [cu, cv] = cellUV(cell);
      const p = new THREE.Vector3()
        .copy(n)
        .multiplyScalar(HALF + PIP_INSET)
        .addScaledVector(u, cu * PIP_GRID)
        .addScaledVector(v, cv * PIP_GRID);
      pips.push({
        pos: [p.x, p.y, p.z],
        quat: [quat.x, quat.y, quat.z, quat.w],
      });
    }
  }
  return pips;
}

/** A single die: plain white box + 21 dark pip discs on the standard faces. */
function DieMesh({ groupRef }: { groupRef: (g: THREE.Group | null) => void }) {
  const pips = useMemo(buildPips, []);
  return (
    <group ref={groupRef}>
      <mesh castShadow>
        {/* Plain boxGeometry — material sheen (low roughness, slight metalness)
            sells the "toy die" look without extra geometry cost. */}
        <boxGeometry args={[DIE_SIZE, DIE_SIZE, DIE_SIZE]} />
        <meshStandardMaterial color="#fffdf8" roughness={0.35} metalness={0.05} />
      </mesh>
      {pips.map((pip, i) => (
        <mesh key={i} position={pip.pos} quaternion={pip.quat}>
          <circleGeometry args={[PIP_RADIUS, 16]} />
          <meshStandardMaterial color="#2a241a" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

interface DieAnim {
  value: number;
  elapsed: number;          // ms since roll started
  spinAxis: THREE.Vector3;  // random tumble axis
  spinSpeed: number;        // rad/s peak angular velocity
  startQuat: THREE.Quaternion; // orientation captured when settle begins
  captured: boolean;        // whether startQuat has been captured
  targetQuat: THREE.Quaternion;
}

// ---- Die animation factory (module-scope — no per-render allocation) ---------
/** Create a fresh DieAnim for a given server-resolved face value. */
function makeAnim(value: number): DieAnim {
  return {
    value,
    elapsed: 0,
    spinAxis: new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ).normalize(),
    spinSpeed: 14 + Math.random() * 8, // rad/s
    startQuat: new THREE.Quaternion(),
    captured: false,
    targetQuat: resolveQuaternion(value),
  };
}

/**
 * Procedural 3D dice. Idle → hidden. On `dice-rolled` (server-authoritative
 * `dice` tuple) both dice tumble for TUMBLE_MS, slerp to the orientation that
 * shows the server value over SETTLE_MS, pop on landing, hold, then hide.
 *
 * Mirrors PlayerTokens' stale-closure-safe pattern: gameBus writes into refs,
 * useFrame drives the meshes imperatively — no per-frame React re-render.
 */
export function Dice3D() {
  const rootRef = useRef<THREE.Group | null>(null);
  const dieGroups = useRef<Array<THREE.Group | null>>([null, null]);
  const anims = useRef<[DieAnim | null, DieAnim | null]>([null, null]);

  useGameBusEvent('dice-rolled', (d: { dice: [number, number] }) => {
    if (!d?.dice) return;
    anims.current = [makeAnim(d.dice[0]), makeAnim(d.dice[1])];
    // Reset any static resting orientation so the tumble starts clean.
    for (const g of dieGroups.current) {
      if (g) {
        g.quaternion.identity();
        g.scale.set(1, 1, 1);
      }
    }
    if (rootRef.current) rootRef.current.visible = true;
  });

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    // Nothing active → stay hidden.
    if (!anims.current[0] && !anims.current[1]) {
      root.visible = false;
      return;
    }
    const dtMs = delta * 1000;

    let allDone = true;
    for (let i = 0; i < 2; i++) {
      const anim = anims.current[i];
      const g = dieGroups.current[i];
      if (!anim || !g) continue;
      anim.elapsed += dtMs;

      if (anim.elapsed < TUMBLE_MS) {
        // Phase A: tumble with ease-out (angular velocity decays toward settle).
        allDone = false;
        const p = anim.elapsed / TUMBLE_MS;          // 0→1
        const ease = 1 - p * p;                       // ease-out on velocity
        const dtheta = anim.spinSpeed * ease * (dtMs / 1000);
        const dq = new THREE.Quaternion().setFromAxisAngle(anim.spinAxis, dtheta);
        g.quaternion.multiply(dq);
        g.scale.set(1, 1, 1);
      } else if (anim.elapsed < RESOLVE_MS) {
        // Phase B: slerp from the tumbling orientation to the resolved target.
        allDone = false;
        if (!anim.captured) {
          anim.startQuat.copy(g.quaternion);
          anim.captured = true;
        }
        const t = (anim.elapsed - TUMBLE_MS) / SETTLE_MS; // 0→1
        const eased = 1 - Math.pow(1 - t, 3);             // ease-out cubic
        g.quaternion.copy(anim.startQuat).slerp(anim.targetQuat, eased);
      } else {
        // Landed: snap exactly to target, add a small scale pop, then hold.
        g.quaternion.copy(anim.targetQuat);
        const sinceLand = anim.elapsed - RESOLVE_MS;
        if (sinceLand < POP_MS) {
          const pop = Math.sin((sinceLand / POP_MS) * Math.PI) * 0.14;
          g.scale.setScalar(1 + pop);
        } else {
          g.scale.set(1, 1, 1);
        }
        if (anim.elapsed < RESOLVE_MS + HOLD_MS) allDone = false;
      }
    }

    if (allDone) {
      anims.current = [null, null];
      root.visible = false;
    }
  });

  return (
    <group ref={rootRef} visible={false}>
      <group position={[-DIE_X_OFFSET, DIE_Y, 0]}>
        <DieMesh groupRef={(g) => (dieGroups.current[0] = g)} />
      </group>
      <group position={[DIE_X_OFFSET, DIE_Y, 0]}>
        <DieMesh groupRef={(g) => (dieGroups.current[1] = g)} />
      </group>
    </group>
  );
}
