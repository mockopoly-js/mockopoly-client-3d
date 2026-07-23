import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../state/gameStore';
import { useGameBusEvent } from '../state/useGameBus';
import { tileToWorld } from './positions';
import { hopPath, stackOffset } from './hopPath';
import { TOKEN_HEX } from '../constants/theme';
import { TOKEN_MODEL } from '../constants/models';
import { ModelMesh } from './ModelMesh';
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
 * Coordinate space: every player's token is a *direct child of the top-level
 * group* (which sits at the origin) as a `THREE.Group`, so each group's local
 * position IS world position. `useFrame` drives `group.position` / `group.scale`
 * directly in that single world space — the groups carry NO React `position`
 * prop, so a store re-render never fights the animation. Inside each group sits
 * the tinted token model (a `<ModelMesh>`) plus a subtle white base disc; both
 * are static children offset down so the model's base (local y=0) rests on the
 * tile when the group is at BASE_Y, and both inherit the group's animated
 * transform (position + squash/stretch scale) for free — exactly as the ring
 * used to inherit the cylinder mesh's transform.
 *
 * On a `player-moved` event we enqueue `hopPath(from, to)` and lerp across each
 * tile in exactly HOP_MS. While a hop is queued the store snapshot (which already
 * holds the final tile) is ignored; when the queue drains we reconcile to
 * `tileToWorld(position)` + stack offset so any drift is corrected.
 *
 * Only the animated object changed from a `THREE.Mesh` (cylinder) to a
 * `THREE.Group` (wrapping the glb) — the drive math below is unchanged.
 */
export function PlayerTokens() {
  const players = (useGameStore((s) => s.state?.players) ?? []).filter((p) => !p.isBankrupt);

  // Live refs read inside useFrame (avoids stale closures on re-render).
  const playersRef = useRef<Player[]>(players);
  playersRef.current = players;
  const groups = useRef<Record<string, THREE.Group | null>>({});
  const anims = useRef<Record<string, Anim>>({});
  const seeded = useRef<Record<string, boolean>>({});

  // Server says a token moved → enqueue the tile-by-tile hop.
  useGameBusEvent('player-moved', (d: { playerId: string; from: number; to: number }) => {
    const queue = hopPath(d.from, d.to);
    if (queue.length === 0) return;
    // Seed the hop start from the group's current world position when available
    // (handles rapid consecutive moves); otherwise from the `from` tile.
    const group = groups.current[d.playerId];
    let fromX: number;
    let fromZ: number;
    if (group) {
      fromX = group.position.x;
      fromZ = group.position.z;
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
      const group = groups.current[p.id];
      if (!group) continue;

      const anim = anims.current[p.id];
      if (anim && anim.queue.length > 0) {
        anim.elapsed += dtMs;
        const t = Math.min(anim.elapsed / HOP_MS, 1);
        const [tx, , tz] = tileToWorld(anim.queue[0]);
        // World-space lerp: group is a direct child of the origin group.
        group.position.x = THREE.MathUtils.lerp(anim.fromX, tx, t);
        group.position.z = THREE.MathUtils.lerp(anim.fromZ, tz, t);
        group.position.y = BASE_Y + Math.sin(t * Math.PI) * HOP_H;
        // juice: squash toward the top of the arc, pop on arrival
        const arc = Math.sin(t * Math.PI);           // 0→1→0 over the hop
        const s = 1 + arc * 0.12;                     // stretch up mid-hop
        group.scale.set(1 + (1 - arc) * 0.06, s, 1 + (1 - arc) * 0.06);
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
        group.position.set(x + ox, BASE_Y, z + oz);
        group.scale.set(1, 1, 1);
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
        const hex = TOKEN_HEX[p.token as TokenType];
        return (
          <group
            key={p.id}
            ref={(g) => {
              groups.current[p.id] = g;
              // Seed world position once so the token appears on its tile even
              // if the very first frame hasn't fired yet.
              if (g && !seeded.current[p.id]) {
                g.position.set(x + ox, BASE_Y, z + oz);
              }
            }}
          >
            {/* Tinted token model. Base at local y=0, so offset down by BASE_Y
                to rest on the tile when the group sits at BASE_Y. */}
            <ModelMesh url={TOKEN_MODEL[p.token as TokenType]} tint={hex} position={[0, -BASE_Y, 0]} />
            {/* Subtle white base disc for legibility on colored tiles — a child
                of the group, so it follows the animated transform for free
                (same role the ring played as a child of the old cylinder mesh). */}
            <mesh position={[0, -0.12, 0]}>
              <cylinderGeometry args={[0.32, 0.32, 0.04, 24]} />
              <meshStandardMaterial color="#ffffff" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
