import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../state/gameStore';
import { useGameBusEvent } from '../state/useGameBus';
import { tileToWorld } from './positions';
import { hopPath, stackOffset } from './hopPath';
import { TOKEN_HEX } from '../constants/theme';
import type { Player, TokenType } from '../types/GameState';

const BASE_Y = 0.15;
const HOP_H = 0.3;
const HOP_MS = 150; // ANIMATION_TOKEN_MOVE_PER_SPACE_MS — keeps lockstep with server

interface Anim {
  queue: number[];   // remaining tiles to visit, in order
  elapsed: number;   // ms into the current hop
  fromX: number;     // world x at the start of the current hop
  fromZ: number;     // world z at the start of the current hop
}

/**
 * Rest offset for a token: its planar (x,z) nudge based on its index among the
 * players currently sharing its tile, so up to 4 co-located tokens don't overlap.
 */
function restOffset(player: Player, players: Player[]): [number, number] {
  const coLocated = players.filter((p) => p.position === player.position && !p.isBankrupt);
  const idx = coLocated.findIndex((p) => p.id === player.id);
  return stackOffset(idx < 0 ? 0 : idx);
}

/**
 * Renders one token per non-bankrupt player and animates tile-by-tile hops.
 *
 * Coordinate space: every token mesh is a *direct child of the top-level group*
 * (which sits at the origin), so each mesh's local position IS world position.
 * `useFrame` drives `mesh.position` directly in that single world space — the
 * meshes carry NO React `position` prop, so a store re-render never fights the
 * animation. The white base ring is a child of the mesh, so it follows for free.
 *
 * On a `player-moved` event we enqueue `hopPath(from, to)` and lerp across each
 * tile in exactly HOP_MS. While a hop is queued the store snapshot (which already
 * holds the final tile) is ignored; when the queue drains we reconcile to
 * `tileToWorld(position)` + stack offset so any drift is corrected.
 */
export function PlayerTokens() {
  const players = (useGameStore((s) => s.state?.players) ?? []).filter((p) => !p.isBankrupt);

  // Live refs read inside useFrame (avoids stale closures on re-render).
  const playersRef = useRef<Player[]>(players);
  playersRef.current = players;
  const meshes = useRef<Record<string, THREE.Mesh | null>>({});
  const anims = useRef<Record<string, Anim>>({});
  const seeded = useRef<Record<string, boolean>>({});

  // Server says a token moved → enqueue the tile-by-tile hop.
  useGameBusEvent('player-moved', (d: { playerId: string; from: number; to: number }) => {
    const queue = hopPath(d.from, d.to);
    if (queue.length === 0) return;
    // Seed the hop start from the mesh's current world position when available
    // (handles rapid consecutive moves); otherwise from the `from` tile.
    const mesh = meshes.current[d.playerId];
    let fromX: number;
    let fromZ: number;
    if (mesh) {
      fromX = mesh.position.x;
      fromZ = mesh.position.z;
    } else {
      const [x, , z] = tileToWorld(d.from);
      fromX = x;
      fromZ = z;
    }
    anims.current[d.playerId] = { queue, elapsed: 0, fromX, fromZ };
  });

  useFrame((_, delta) => {
    const dtMs = delta * 1000;
    const current = playersRef.current;
    for (const p of current) {
      const mesh = meshes.current[p.id];
      if (!mesh) continue;

      const anim = anims.current[p.id];
      if (anim && anim.queue.length > 0) {
        anim.elapsed += dtMs;
        const t = Math.min(anim.elapsed / HOP_MS, 1);
        const [tx, , tz] = tileToWorld(anim.queue[0]);
        // World-space lerp: mesh is a direct child of the origin group.
        mesh.position.x = THREE.MathUtils.lerp(anim.fromX, tx, t);
        mesh.position.z = THREE.MathUtils.lerp(anim.fromZ, tz, t);
        mesh.position.y = BASE_Y + Math.sin(t * Math.PI) * HOP_H;
        // juice: squash toward the top of the arc, pop on arrival
        const arc = Math.sin(t * Math.PI);           // 0→1→0 over the hop
        const s = 1 + arc * 0.12;                     // stretch up mid-hop
        mesh.scale.set(1 + (1 - arc) * 0.06, s, 1 + (1 - arc) * 0.06);
        seeded.current[p.id] = true;
        if (t >= 1) {
          // Advance to the next tile; carry over overshoot so we stay in lockstep.
          anim.fromX = tx;
          anim.fromZ = tz;
          anim.elapsed = Math.max(0, anim.elapsed - HOP_MS);
          anim.queue.shift();
          if (anim.queue.length === 0) delete anims.current[p.id];
        }
      } else {
        // Reconcile to the authoritative tile + stack offset (world space).
        const [x, , z] = tileToWorld(p.position);
        const [ox, oz] = restOffset(p, current);
        mesh.position.set(x + ox, BASE_Y, z + oz);
        mesh.scale.set(1, 1, 1);
        seeded.current[p.id] = true;
      }
    }
  });

  return (
    <group>
      {players.map((p) => {
        // Initial placement only (before the first useFrame tick paints it).
        const [x, , z] = tileToWorld(p.position);
        const [ox, oz] = restOffset(p, players);
        return (
          <mesh
            key={p.id}
            ref={(m) => {
              meshes.current[p.id] = m;
              // Seed world position once so the token appears on its tile even
              // if the very first frame hasn't fired yet.
              if (m && !seeded.current[p.id]) {
                m.position.set(x + ox, BASE_Y, z + oz);
              }
            }}
            castShadow
          >
            <cylinderGeometry args={[0.26, 0.26, 0.3, 24]} />
            <meshStandardMaterial
              color={TOKEN_HEX[p.token as TokenType]}
              emissive={TOKEN_HEX[p.token as TokenType]}
              emissiveIntensity={0.15}
            />
            {/* White base ring for legibility on colored tiles — child of the
                token mesh, so it follows the animated world position for free. */}
            <mesh position={[0, -0.12, 0]}>
              <cylinderGeometry args={[0.32, 0.32, 0.04, 24]} />
              <meshStandardMaterial color="#ffffff" />
            </mesh>
          </mesh>
        );
      })}
    </group>
  );
}
