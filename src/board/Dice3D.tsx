import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Physics,
  RigidBody,
  CuboidCollider,
  type RapierRigidBody,
} from '@react-three/rapier';
import * as THREE from 'three';
import { useGameBusEvent } from '../state/useGameBus';
import { FACE_NORMAL, resolveQuaternion } from './dice-orientation';

// ---- Geometry / placement constants -----------------------------------------
const DIE_SIZE = 0.5;               // cube edge length
const HALF = DIE_SIZE / 2;
const PIP_RADIUS = 0.045;           // pip disc radius
const PIP_GRID = DIE_SIZE * 0.28;   // half-spacing of the 3×3 pip grid
const PIP_INSET = 0.001;            // lift pips just off the face to avoid z-fight

// ---- World layout ------------------------------------------------------------
// The board base top sits at y≈0 (BoardTiles: base spans y[-0.1,0], tiles y=0.02).
// The floor collider top is placed at FLOOR_Y so a resting die centre sits at
// FLOOR_Y + HALF. Dice are thrown from START_Y above the board centre.
const FLOOR_Y = 0.03;               // just above the painted tiles
const REST_Y = FLOOR_Y + HALF;      // die centre when at rest on the floor
const START_Y = 2.2;                // throw origin height above board
const START_X = 0.55;               // the two dice start at ∓this on x (toward centre)
const PLAY_HALF = 3.2;              // half-extent of the invisible containment box
const WALL_H = 2.6;                 // wall height (dice can't escape upward much)

// ---- Physics tuning ----------------------------------------------------------
const GRAVITY: [number, number, number] = [0, -30, 0]; // punchy fall for quick settle
const DIE_RESTITUTION = 0.35;       // lively-but-quick bounce
const DIE_FRICTION = 0.85;          // grabs the floor so it stops tumbling fast
const LINEAR_DAMPING = 0.4;
const ANGULAR_DAMPING = 0.55;       // bleeds spin so it settles by the deadline
const DIE_DENSITY = 1.4;

// ---- Animation phase timings (ms) -------------------------------------------
// Physics tumbles freely until it comes to rest OR the hard deadline hits,
// whichever is first. Then we KINEMATICALLY orient the die to the server value.
// Budget: the EXACT server value must be locked by ~700ms (server paces the
// next broadcast ~800ms later). Worst case = deadline snap: DEADLINE_MS + SNAP_MS
// = 560 + 130 = 690ms < 700ms. Natural settle usually fires well before 560ms.
const REST_MIN_MS = 220;            // don't resolve before this even if "still"
const DEADLINE_MS = 560;            // hard cap on the free tumble (see budget above)
const SNAP_MS = 130;                // slerp from rest pose → server orientation
const HOLD_MS = 1000;               // hold the result before hiding

// "At rest" velocity thresholds (world units / s and rad / s).
const REST_LINVEL = 0.35;
const REST_ANGVEL = 1.1;
const REST_FRAMES = 4;              // consecutive still frames required for early settle

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
  const col = cell % 3;             // 0,1,2 → -1,0,1  (u)
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
 * FACE_NORMAL directions so a resolved face shows the correct value. This is
 * the SAME construction as the previous procedural die, so the face↔value
 * mapping (and its passing dice-orientation test) stays intact.
 */
function buildPips(): PipSpec[] {
  const pips: PipSpec[] = [];
  const zAxis = new THREE.Vector3(0, 0, 1); // disc geometry faces +Z by default
  for (let value = 1; value <= 6; value++) {
    const n = new THREE.Vector3(...FACE_NORMAL[value]).normalize();
    const [u, v] = faceBasis(n);
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

/** A single die's visual: plain white box + 21 dark pip discs on standard faces. */
function DieMesh() {
  const pips = useMemo(buildPips, []);
  return (
    <>
      <mesh castShadow>
        {/* Plain boxGeometry — material sheen sells the "toy die" look. */}
        <boxGeometry args={[DIE_SIZE, DIE_SIZE, DIE_SIZE]} />
        <meshStandardMaterial color="#fffdf8" roughness={0.35} metalness={0.05} />
      </mesh>
      {pips.map((pip, i) => (
        <mesh key={i} position={pip.pos} quaternion={pip.quat}>
          <circleGeometry args={[PIP_RADIUS, 16]} />
          <meshStandardMaterial color="#2a241a" roughness={0.6} />
        </mesh>
      ))}
    </>
  );
}

// ---- Predetermined-orientation helper ---------------------------------------
// resolveQuaternion(value) puts `value`'s face up but leaves the yaw (spin about
// the vertical) arbitrary. To make the correction read as a small settle rather
// than a jarring snap, we add the yaw-about-Y that best matches the die's
// current resting orientation. We scan the 4 in-plane 90° rotations (the cube
// symmetries that keep the same face up) plus a continuous yaw fit, and pick the
// closest by quaternion dot. The face shown is ALWAYS `value` — only yaw varies.
const YAW_STEPS = 4; // 0, 90, 180, 270 about world-Y
const _tmpBase = new THREE.Quaternion();
const _tmpYaw = new THREE.Quaternion();
const _tmpCand = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);

function resolveQuaternionNear(value: number, current: THREE.Quaternion): THREE.Quaternion {
  _tmpBase.copy(resolveQuaternion(value));
  let best = new THREE.Quaternion().copy(_tmpBase);
  let bestDot = -Infinity;
  for (let k = 0; k < YAW_STEPS; k++) {
    const angle = (k * Math.PI) / 2;
    _tmpYaw.setFromAxisAngle(_yAxis, angle);
    // Yaw is applied in WORLD space (pre-multiply): keeps `value` up, spins die.
    _tmpCand.copy(_tmpYaw).multiply(_tmpBase);
    // Quaternion "distance" is symmetric under q/-q; use abs(dot).
    const dot = Math.abs(_tmpCand.dot(current));
    if (dot > bestDot) {
      bestDot = dot;
      best = new THREE.Quaternion().copy(_tmpCand);
    }
  }
  return best;
}

// ---- Per-die runtime state (refs, no React re-render) ------------------------
type Phase = 'idle' | 'tumbling' | 'snapping' | 'holding';

interface DieState {
  phase: Phase;
  value: number;             // server-authoritative face value for THIS die
  elapsed: number;           // ms since roll started
  stillFrames: number;       // consecutive frames under the rest thresholds
  snapElapsed: number;       // ms into the kinematic slerp
  snapStart: THREE.Quaternion; // rotation captured at snap start
  snapTarget: THREE.Quaternion; // resolved server orientation (+ closest yaw)
  snapPos: THREE.Vector3;    // resting XZ, clamped to floor Y
  holdElapsed: number;       // ms since the snap completed
}

function makeDieState(): DieState {
  return {
    phase: 'idle',
    value: 1,
    elapsed: 0,
    stillFrames: 0,
    snapElapsed: 0,
    snapStart: new THREE.Quaternion(),
    snapTarget: new THREE.Quaternion(),
    snapPos: new THREE.Vector3(),
    holdElapsed: 0,
  };
}

// Reusable scratch to avoid per-frame allocation in the frame loop.
const _q = new THREE.Quaternion();
const _rndAxis = new THREE.Vector3();

/** Throw one die: teleport to start pose, zero velocities, apply randomized
 *  impulse + spin. Random ONLY affects the throw trajectory, never the value. */
function throwDie(body: RapierRigidBody, startX: number) {
  // Ensure dynamic before applying forces (it may be kinematic from a prior roll).
  body.setBodyType(0 /* Dynamic */, true);
  body.setTranslation(
    {
      x: startX + (Math.random() - 0.5) * 0.3,
      y: START_Y + Math.random() * 0.4,
      z: (Math.random() - 0.5) * 0.6,
    },
    true,
  );
  // Random start orientation.
  _rndAxis
    .set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
    .normalize();
  _q.setFromAxisAngle(_rndAxis, Math.random() * Math.PI * 2);
  body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  // Throw toward the board centre + a bit up, so dice arc and bounce inward.
  const inward = startX > 0 ? -1 : 1;
  body.applyImpulse(
    {
      x: inward * (0.9 + Math.random() * 0.7),
      y: 0.6 + Math.random() * 0.6,
      z: (Math.random() - 0.5) * 1.4,
    },
    true,
  );
  // Strong random tumble so the roll reads as a real dice throw.
  body.applyTorqueImpulse(
    {
      x: (Math.random() - 0.5) * 0.09,
      y: (Math.random() - 0.5) * 0.09,
      z: (Math.random() - 0.5) * 0.09,
    },
    true,
  );
}

/**
 * Rapier-physics 3D dice. Idle → hidden. On `dice-rolled` (server-authoritative
 * `dice` tuple) both dice are thrown as dynamic rigid bodies that tumble and
 * bounce off a fixed floor + invisible containment walls. They settle naturally
 * (~500–650ms), but at the hard DEADLINE_MS (or earlier natural rest) each die
 * is switched to KINEMATIC and slerped to the orientation that shows its server
 * value — so the displayed value is NEVER left to physics chance and is always
 * readable well before the server's ~800ms follow-up broadcast.
 *
 * die 0 → dice[0], die 1 → dice[1] (never swapped). Physics randomness affects
 * only the throw trajectory, never the outcome.
 *
 * Follows PlayerTokens' stale-closure-safe pattern: gameBus writes into refs,
 * useFrame drives the bodies imperatively — no per-frame React re-render.
 */
export function Dice3D() {
  const rootRef = useRef<THREE.Group | null>(null);
  const bodies = useRef<Array<RapierRigidBody | null>>([null, null]);
  const states = useRef<[DieState, DieState]>([makeDieState(), makeDieState()]);
  const active = useRef(false);
  // `running` mirrors `active` for the <Physics paused> prop: the world only
  // simulates during a roll (tumble → snap → hold) and is fully paused when
  // idle, so no physics/CPU runs between rolls. Flips once per roll, not per
  // frame — the per-frame work stays in useFrame reading refs.
  const [running, setRunning] = useState(false);

  useGameBusEvent('dice-rolled', (d: { dice?: [number, number] }) => {
    if (!d?.dice) return;
    const [b0, b1] = bodies.current;
    if (!b0 || !b1) return;

    for (let i = 0; i < 2; i++) {
      const s = states.current[i];
      s.phase = 'tumbling';
      s.value = d.dice[i]; // die i → dice[i], no swap
      s.elapsed = 0;
      s.stillFrames = 0;
      s.snapElapsed = 0;
      s.holdElapsed = 0;
    }
    throwDie(b0, -START_X);
    throwDie(b1, START_X);
    active.current = true;
    setRunning(true); // un-pause the physics world for this roll
    if (rootRef.current) rootRef.current.visible = true;
  });

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    if (!active.current) {
      root.visible = false;
      return;
    }
    const dtMs = delta * 1000;

    for (let i = 0; i < 2; i++) {
      const s = states.current[i];
      const body = bodies.current[i];
      if (!body || s.phase === 'idle') continue;
      s.elapsed += dtMs;

      if (s.phase === 'tumbling') {
        // Track natural rest: enough consecutive slow frames past REST_MIN_MS.
        const lv = body.linvel();
        const av = body.angvel();
        const linSpeed = Math.hypot(lv.x, lv.y, lv.z);
        const angSpeed = Math.hypot(av.x, av.y, av.z);
        if (s.elapsed >= REST_MIN_MS && linSpeed < REST_LINVEL && angSpeed < REST_ANGVEL) {
          s.stillFrames++;
        } else {
          s.stillFrames = 0;
        }
        const settledEarly = s.stillFrames >= REST_FRAMES;
        const deadlineHit = s.elapsed >= DEADLINE_MS;
        if (settledEarly || deadlineHit) {
          // Begin the predetermined KINEMATIC orient toward the server value.
          const t = body.translation();
          const r = body.rotation();
          s.snapStart.set(r.x, r.y, r.z, r.w);
          s.snapTarget.copy(resolveQuaternionNear(s.value, s.snapStart));
          // Clamp resting XZ inside the play box, drop centre to the floor.
          s.snapPos.set(
            THREE.MathUtils.clamp(t.x, -PLAY_HALF + HALF, PLAY_HALF - HALF),
            REST_Y,
            THREE.MathUtils.clamp(t.z, -PLAY_HALF + HALF, PLAY_HALF - HALF),
          );
          // Freeze physics: kinematic bodies ignore gravity/collisions.
          body.setBodyType(2 /* KinematicPositionBased */, true);
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          s.snapElapsed = 0;
          s.phase = 'snapping';
        }
      }

      if (s.phase === 'snapping') {
        s.snapElapsed += dtMs;
        const t = Math.min(1, s.snapElapsed / SNAP_MS);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        _q.copy(s.snapStart).slerp(s.snapTarget, eased);
        body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
        body.setTranslation(
          { x: s.snapPos.x, y: s.snapPos.y, z: s.snapPos.z },
          true,
        );
        if (t >= 1) {
          s.holdElapsed = 0;
          s.phase = 'holding';
        }
      }

      if (s.phase === 'holding') {
        // Exact server orientation is guaranteed here (slerp reached t=1).
        body.setRotation(
          {
            x: s.snapTarget.x,
            y: s.snapTarget.y,
            z: s.snapTarget.z,
            w: s.snapTarget.w,
          },
          true,
        );
        body.setTranslation(
          { x: s.snapPos.x, y: s.snapPos.y, z: s.snapPos.z },
          true,
        );
        s.holdElapsed += dtMs;
      }
    }

    // Once BOTH dice have finished their hold, retire and hide.
    const s0 = states.current[0];
    const s1 = states.current[1];
    const done0 = s0.phase === 'idle' || (s0.phase === 'holding' && s0.holdElapsed >= HOLD_MS);
    const done1 = s1.phase === 'idle' || (s1.phase === 'holding' && s1.holdElapsed >= HOLD_MS);
    if (done0 && done1) {
      s0.phase = 'idle';
      s1.phase = 'idle';
      active.current = false;
      root.visible = false;
      setRunning(false); // fully pause the physics world until the next roll
    }
  });

  return (
    <group ref={rootRef} visible={false}>
      {/* Physics world scoped to the dice + a fixed floor/walls ONLY. Tokens,
          buildings and the board are NOT physics bodies — the dice bounce off
          this dedicated floor collider, not the real board mesh. */}
      <Physics gravity={GRAVITY} colliders={false} timeStep="vary" paused={!running}>
        {/* Fixed floor at the board surface: a thin cuboid whose TOP is FLOOR_Y. */}
        <RigidBody type="fixed" colliders={false} friction={DIE_FRICTION} restitution={0.2}>
          <CuboidCollider
            args={[PLAY_HALF, 0.25, PLAY_HALF]}
            position={[0, FLOOR_Y - 0.25, 0]}
          />
          {/* Invisible low containment walls so a lively die never flies off. */}
          <CuboidCollider args={[0.1, WALL_H, PLAY_HALF]} position={[-PLAY_HALF, WALL_H, 0]} />
          <CuboidCollider args={[0.1, WALL_H, PLAY_HALF]} position={[PLAY_HALF, WALL_H, 0]} />
          <CuboidCollider args={[PLAY_HALF, WALL_H, 0.1]} position={[0, WALL_H, -PLAY_HALF]} />
          <CuboidCollider args={[PLAY_HALF, WALL_H, 0.1]} position={[0, WALL_H, PLAY_HALF]} />
        </RigidBody>

        {/* Two dynamic dice. Each is a cuboid collider rendered with the shared
            die mesh (white box + 21 FACE_NORMAL pips). die[0] left, die[1] right. */}
        <RigidBody
          ref={(b) => (bodies.current[0] = b)}
          type="dynamic"
          colliders={false}
          position={[-START_X, START_Y, 0]}
          restitution={DIE_RESTITUTION}
          friction={DIE_FRICTION}
          linearDamping={LINEAR_DAMPING}
          angularDamping={ANGULAR_DAMPING}
          ccd
          canSleep={false}
        >
          <CuboidCollider args={[HALF, HALF, HALF]} density={DIE_DENSITY} />
          <DieMesh />
        </RigidBody>

        <RigidBody
          ref={(b) => (bodies.current[1] = b)}
          type="dynamic"
          colliders={false}
          position={[START_X, START_Y, 0]}
          restitution={DIE_RESTITUTION}
          friction={DIE_FRICTION}
          linearDamping={LINEAR_DAMPING}
          angularDamping={ANGULAR_DAMPING}
          ccd
          canSleep={false}
        >
          <CuboidCollider args={[HALF, HALF, HALF]} density={DIE_DENSITY} />
          <DieMesh />
        </RigidBody>
      </Physics>
    </group>
  );
}
