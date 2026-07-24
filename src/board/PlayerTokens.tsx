import { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../state/gameStore';
import { useGameBusEvent } from '../state/useGameBus';
import { tileToWorld } from './positions';
import { hopPath, stackOffset } from './hopPath';
import { TOKEN_HEX } from '../constants/theme';
import { CharacterToken, type CharacterTokenHandle } from './CharacterToken';
import { resolveCharacter, DEFAULT_CHARACTER } from '../constants/characters';
import type { Player, TokenType } from '../types/GameState';

const BASE_Y = 0.15;
const HOP_H = 0.3;
const HOP_MS = 150; // ANIMATION_TOKEN_MOVE_PER_SPACE_MS — keeps lockstep with server
const CHAR_SCALE = 0.2; // matches CharacterToken's board-token default
const ROT_LERP = 0.35; // how quickly the character swings to face travel each frame
const FACING_OFFSET = 0; // radians — single knob: set to Math.PI if model faces backward
const RING_INNER = 0.26; // inner radius of the identity ring
const RING_OUTER = 0.32; // outer radius (~0.06 band — thin, not fat)

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
 * position IS world position. `useFrame` drives `group.position` /
 * `group.rotation` directly in that single world space — the groups carry NO
 * React `position` prop, so a store re-render never fights the animation. Inside
 * each group sits the player's chosen animated character (`<CharacterToken>`)
 * plus a subtle base disc; both are static children of the group and inherit its
 * animated transform for free.
 *
 * The rendered object changed from a tinted pawn (`<ModelMesh>`) to the player's
 * `<CharacterToken>` (CT3). The character renders with its NATIVE colors (a Suit
 * is grey, a Wizard purple, …) — NOT recolored by player color. Its feet are
 * seated on the tile via a `y={-BASE_Y}` local offset (feet at rig y=0, so when
 * the group is at BASE_Y the feet land on the tile top at world y=0 — the same
 * seating the pawn had). Each character plays 'Idle' at rest and 'Walk' while
 * its token is mid-hop, driven by the reactive `clip` prop below.
 *
 * IDENTITY BY COLOR: since the character is no longer tinted, player identity is
 * shown by a prominent TOKEN_HEX-colored ring/puck the character stands on (two
 * co-located players can even pick the same character — the ring color still
 * tells them apart, and it matches the token color the pods/ownership use).
 *
 * On a `player-moved` event we enqueue `hopPath(from, to)` and lerp across each
 * tile in exactly HOP_MS. While a hop is queued the store snapshot (which
 * already holds the final tile) is ignored; when the queue drains we reconcile
 * to `tileToWorld(position)` + stack offset so any drift is corrected. The drive
 * math is UNCHANGED from the pawn version — only the rendered object and the
 * Idle↔Walk clip switch are new.
 *
 * Clip switching does NOT touch the position lockstep: it is a per-player React
 * state map (`moving`) flipped to true when a hop is enqueued (in the
 * `player-moved` handler) and back to false the first frame the queue drains
 * (guarded so we only setState on the transition, never every frame). The
 * CharacterToken key is stable per `player.id`, so flipping `clip` crossfades
 * the animation without re-mounting the skeleton/mixer.
 *
 * Facing: the character swings to face its direction of travel during a hop
 * (heading derived from the per-frame movement delta, slerped into
 * `group.rotation.y`) and holds that facing at rest. This is applied only to the
 * group's rotation inside useFrame — it never perturbs the position lerp.
 */
export function PlayerTokens() {
  const players = (useGameStore((s) => s.state?.players) ?? []).filter((p) => !p.isBankrupt);

  // Preload only the characters actually in the current game.
  useEffect(() => {
    for (const p of players) {
      CharacterToken.preload(resolveCharacter(p.character ?? DEFAULT_CHARACTER).url);
    }
  }, [players.map((p) => `${p.id}:${p.character ?? ''}`).join(',')]);

  // Per-player "is mid-hop" → drives Idle↔Walk. React state so the clip prop
  // re-renders; a ref mirror lets useFrame flip it without a stale closure and
  // without a setState every frame (only on the enter/leave transition).
  const [moving, setMoving] = useState<Record<string, boolean>>({});
  const movingRef = useRef(moving);
  movingRef.current = moving;

  // Live refs read inside useFrame (avoids stale closures on re-render).
  const playersRef = useRef<Player[]>(players);
  playersRef.current = players;
  const groups = useRef<Record<string, THREE.Group | null>>({});
  const anims = useRef<Record<string, Anim>>({});
  const seeded = useRef<Record<string, boolean>>({});
  const facing = useRef<Record<string, number>>({}); // last committed heading (y-rot)
  // Imperative handles to each character, for one-shot Victory/Defeat clips.
  const chars = useRef<Record<string, CharacterTokenHandle | null>>({});

  // Server says a token moved → enqueue the tile-by-tile hop + flag it moving.
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
    // Flip to 'Walk' (only if not already flagged — avoids a redundant render).
    if (!movingRef.current[d.playerId]) {
      setMoving((m) => ({ ...m, [d.playerId]: true }));
    }
  });

  // One-shot Victory for the winner on game over.
  useGameBusEvent('game-over', (d: { winnerId: string }) => {
    chars.current[d.winnerId]?.play('Victory', { loop: false });
  });

  // One-shot Defeat when a player goes bankrupt (played on the frame before the
  // store snapshot filters the token out — best-effort; the token is removed on
  // the next state update, so the clip mostly flashes. Kept lightweight.)
  useGameBusEvent('player-bankrupt', (d: { playerId: string }) => {
    chars.current[d.playerId]?.play('Defeat', { loop: false });
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
        const prevX = group.position.x;
        const prevZ = group.position.z;
        // World-space lerp: group is a direct child of the origin group.
        group.position.x = THREE.MathUtils.lerp(anim.fromX, tx, t);
        group.position.z = THREE.MathUtils.lerp(anim.fromZ, tz, t);
        group.position.y = BASE_Y + Math.sin(t * Math.PI) * HOP_H;
        // Face direction of travel: derive heading from this frame's planar
        // delta (fall back to the whole-hop delta on the very first sub-frame so
        // a heading exists immediately). Only rotation is touched here — the
        // position lerp above is untouched.
        let dx = group.position.x - prevX;
        let dz = group.position.z - prevZ;
        if (Math.abs(dx) < 1e-5 && Math.abs(dz) < 1e-5) {
          dx = tx - anim.fromX;
          dz = tz - anim.fromZ;
        }
        if (Math.abs(dx) > 1e-5 || Math.abs(dz) > 1e-5) {
          const target = Math.atan2(dx, dz) + FACING_OFFSET; // three's +z is "forward" for atan2(x,z)
          const cur = facing.current[p.id] ?? target;
          // Shortest-arc lerp toward the target heading.
          let diff = target - cur;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          const next = cur + diff * ROT_LERP;
          group.rotation.y = next;
          facing.current[p.id] = next;
        }
        // NO squash/stretch for characters — the Walk clip supplies the body
        // motion; we keep only the positional hop arc so the humanoid doesn't
        // look rubbery. (scale stays at the CharacterToken default.)
        seeded.current[p.id] = true;
        if (t >= 1) {
          // Advance to the next tile; carry over overshoot so we stay in lockstep.
          anim.fromX = tx;
          anim.fromZ = tz;
          anim.elapsed = Math.max(0, anim.elapsed - HOP_MS);
          anim.queue.shift();
          if (anim.queue.length === 0) {
            delete anims.current[p.id];
            // Queue drained → back to 'Idle'. Guard so we setState only on the
            // transition, never every frame.
            if (movingRef.current[p.id]) {
              setMoving((m) => {
                if (!m[p.id]) return m;
                const nextMap = { ...m };
                delete nextMap[p.id];
                return nextMap;
              });
            }
          }
        }
      } else {
        // Reconcile to the authoritative tile + stack offset (world space).
        const [x, , z] = tileToWorld(p.position);
        const [ox, oz] = restOffset(p, current);
        group.position.set(x + ox, BASE_Y, z + oz);
        // Hold the character's facing at rest (keeps whatever heading it landed
        // with); rotation.y is already set from the last hop frame.
        group.rotation.y = facing.current[p.id] ?? group.rotation.y;
        seeded.current[p.id] = true;
        // Safety net: if some path left `moving` stuck true with no queue, clear
        // it (transition-guarded, so this is a no-op on the steady state).
        if (movingRef.current[p.id]) {
          setMoving((m) => {
            if (!m[p.id]) return m;
            const nextMap = { ...m };
            delete nextMap[p.id];
            return nextMap;
          });
        }
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
        const char = resolveCharacter(p.character ?? DEFAULT_CHARACTER);
        const clip = moving[p.id] ? 'Walk' : 'Idle';
        return (
          <group
            key={p.id}
            ref={(g) => {
              groups.current[p.id] = g;
              // Seed world position once so the token appears on its tile even
              // if the very first frame hasn't fired yet.
              if (g && !seeded.current[p.id]) {
                g.position.set(x + ox, BASE_Y, z + oz);
                // Seed rest rotation: face direction of travel toward the next tile
                // using the same convention as the hop code so rest and hop agree.
                const [nx, , nz] = tileToWorld((p.position + 1) % 40);
                const [cx, , cz] = tileToWorld(p.position);
                const rdx = nx - cx, rdz = nz - cz;
                const seedRot = Math.atan2(rdx, rdz) + FACING_OFFSET;
                g.rotation.y = seedRot;
                facing.current[p.id] = seedRot;
              }
            }}
          >
            {/* Player's chosen character with its NATIVE colors (no tint), feet
                seated on the tile: rig feet at y=0, so y={-BASE_Y} lands them on
                the tile top when the group sits at BASE_Y (same seating the pawn
                had). `clip` flips Idle↔Walk with the hop; a stable key per
                player.id keeps the skeleton/mixer instance from re-mounting. */}
            <CharacterToken
              ref={(h) => {
                chars.current[p.id] = h;
              }}
              url={char.url}
              scale={CHAR_SCALE}
              clip={clip}
              y={-BASE_Y}
              baseColor={p.characterColor ?? undefined}
            />
            {/* IDENTITY RING — a thin hollow annulus in the player's TOKEN_HEX
                color. Since the character is no longer tinted, THIS is how you
                tell whose token is whose at a glance (matches the color the
                pods/ownership use). ringGeometry lies in the XY plane; the
                rotation lays it flat on the board facing up. DoubleSide ensures
                it shows from grazing/below angles. */}
            <mesh position={[0, -BASE_Y + 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[RING_INNER, RING_OUTER, 48]} />
              <meshStandardMaterial
                color={hex}
                emissive={hex}
                emissiveIntensity={0.4}
                roughness={0.4}
                metalness={0.1}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
