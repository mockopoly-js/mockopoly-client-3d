import { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../state/gameStore';
import { useGameBusEvent } from '../state/useGameBus';
import { tileToWorld, buildTilePath } from './positions';
import { stackOffset } from './hopPath';
import { TOKEN_HEX } from '../constants/theme';
import { CharacterToken, type CharacterTokenHandle } from './CharacterToken';
import { resolveCharacter, DEFAULT_CHARACTER } from '../constants/characters';
import type { Player } from '../types/GameState';

const BASE_Y = 0.15;
const CHAR_SCALE = 0.2; // matches CharacterToken's board-token default
const FACING_OFFSET = 0; // radians — single knob: set to Math.PI if model faces backward
const RING_INNER = 0.26; // inner radius of the identity ring
const RING_OUTER = 0.32; // outer radius (~0.06 band — thin, not fat)

// ── Walk-motion tuning ───────────────────────────────────────────────────────
// NOTE: the server mirrors ANIMATION_TOKEN_MOVE_PER_SPACE_MS (~150 ms/tile) to
// gate the next GAME_STATE_UPDATE. The walk below takes LONGER than that window
// on purpose — the authoritative snapshot lands BEFORE the walk finishes. That
// is safe because the reconcile branch (else below) only runs when there is NO
// in-flight anim (anims.current[id] absent), so the walk owns the token's
// position until completion and is never interrupted.
//
// WALK_MS_PER_TILE is the desired glide time per board tile. Speed is driven
// SOLELY by this constant — the server-window cap has been removed. The walk
// intentionally outlasts the server's 150 ms/tile gate; the in-flight walk
// holds position until completion so the arriving GAME_STATE_UPDATE never snaps
// the token mid-stride (the reconcile else-branch is guarded by !anims.current).
const WALK_MS_PER_TILE = 320;

// Yaw turn rate: fraction of the remaining angle closed per 60fps-equivalent
// frame (delta-scaled below). High so the character finishes rotating to the
// new segment direction essentially AT the corner vertex, not a tile later.
const YAW_TURN_PER_FRAME = 0.55;
// If the remaining yaw error is below this (radians) we snap to target — kills
// the last-degree crawl so the turn reads as crisp/complete at the corner.
const YAW_SNAP_EPSILON = 0.03;

interface Anim {
  /** World-space vertices of the walk polyline (RAW tile centers), from A..B.
   *  These stay un-offset so lerp/tangent (facing) math is computed from true
   *  tile centers — the destination stack offset is applied SEPARATELY below. */
  pts: { x: number; z: number }[];
  /** Fixed planar bias (destination stack slot) added to the lerped position so
   *  the token rests exactly on its stack slot WITHOUT skewing the last segment's
   *  tangent. Facing is derived from the raw (un-offset) centers; only the final
   *  rendered position carries this bias, ramped in over the walk. */
  destOffset: { x: number; z: number };
  /** Index of the segment currently being walked (pts[seg] → pts[seg+1]). */
  seg: number;
  /** ms elapsed into the current segment. */
  segElapsed: number;
  /** ms budget per segment. */
  perTile: number;
  /** Board tile index of the destination (used on completion to compute the
   *  next-tile rest facing — Fix B). */
  toTile: number;
}

/** Shortest-arc step of `cur` toward `target` by `frac` (delta-scaled), with an
 *  epsilon snap so the turn crisply completes instead of crawling forever. */
function stepYaw(cur: number, target: number, frac: number): number {
  let diff = target - cur;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // unwrap to [-π, π]
  if (Math.abs(diff) <= YAW_SNAP_EPSILON) return target;
  return cur + diff * frac;
}

/**
 * Rest offset for a token: its planar (x,z) nudge based on its index among the
 * players currently sharing its tile, so up to 4 co-located tokens don't overlap.
 */
function restOffset(player: Player, players: Player[]): [number, number] {
  const coLocated = players.filter((p) => p.position === player.position && !p.isBankrupt);
  if (coLocated.length <= 1) return [0, 0];
  const idx = coLocated.findIndex((p) => p.id === player.id);
  return stackOffset(idx < 0 ? 0 : idx);
}

/**
 * Predicted resting offset for `playerId` arriving on tile `to`, using the same
 * index rule as `restOffset` but keyed on the DESTINATION tile (store positions
 * are still stale when `player-moved` fires). The moving player is folded into
 * the co-located set at `to` so its stack index matches what the reconcile will
 * compute once the authoritative snapshot lands. Order-stable with the store's
 * player order so the index is consistent across the walk end and the reconcile.
 */
function destOffset(playerId: string, to: number, players: Player[]): [number, number] {
  const coLocated = players.filter(
    (p) => !p.isBankrupt && (p.id === playerId || p.position === to),
  );
  if (coLocated.length <= 1) return [0, 0];
  const idx = coLocated.findIndex((p) => p.id === playerId);
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
 * MOTION MODEL — the token WALKS, it does not hop. On a `player-moved` event we
 * build `buildTilePath(from, to)` → an ordered polyline of world-space tile
 * centers (A, A+1, …, B, wrapping past GO so corners are rounded and the board
 * is never cut across diagonally). Each frame the token glides along the current
 * segment at a CONSTANT pace (`WALK_MS_PER_TILE` ms per tile) with its feet flat
 * on the board — there is NO vertical hop arc; y is pinned at BASE_Y throughout.
 * The Walk animation clip supplies all the body motion. While walking the store
 * snapshot (which already holds the final tile) is ignored — the reconcile else-
 * branch is guarded by `!anims.current[id]` so the in-flight walk owns the
 * token's position until completion; the now-longer walk never gets snapped
 * mid-stride by an arriving GAME_STATE_UPDATE.
 *
 * FACING turns AT the corner and PIVOTS ON ARRIVAL: while walking, target yaw =
 * current-segment tangent (pts[seg]→pts[seg+1]) + FACING_OFFSET. On walk
 * completion the target yaw is retargeted to the NEXT-TILE direction from the
 * destination (tileToWorld(to+1) - tileToWorld(to)), identical to the mount-seed
 * convention. The yaw lerp (delta-scaled, epsilon-snapped) continues running
 * EVEN WHILE IDLE, so the token visibly pivots at the corner on arrival and
 * settles without jitter. Straight-edge landings are unaffected (next-tile dir ==
 * incoming heading).
 *
 * Clip switching does NOT touch the position lockstep: it is a per-player React
 * state map (`moving`) flipped to true when a walk starts (in the `player-moved`
 * handler) and back to false the first frame the path completes (guarded so we
 * only setState on the transition, never every frame). The CharacterToken key is
 * stable per `player.id`, so flipping `clip` crossfades Idle↔Walk without
 * re-mounting the skeleton/mixer.
 */
export function PlayerTokens() {
  const players = (useGameStore((s) => s.state?.players) ?? []).filter((p) => !p.isBankrupt);

  // Stable identity key for the current roster's (id, character) pairs. Extracted
  // so the preload effect below depends on the CONTENT (re-runs only when a
  // player's chosen character actually changes), not on the players array's
  // reference (which churns on every unrelated GAME_STATE_UPDATE).
  const rosterCharKey = players.map((p) => `${p.id}:${p.character ?? ''}`).join(',');

  // Preload only the characters actually in the current game. The `players`
  // read inside is the roster captured at the render that created this effect;
  // rosterCharKey (its content-hash) is the dependency, so a new effect with a
  // fresh `players` runs only when a player's chosen character actually changes.
  useEffect(() => {
    for (const p of players) {
      CharacterToken.preload(resolveCharacter(p.character ?? DEFAULT_CHARACTER).url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rosterCharKey is the content-hash of exactly the (id, character) info the loop reads; adding `players` would re-run this preload on every unrelated GAME_STATE_UPDATE
  }, [rosterCharKey]);

  // Per-player "is walking" → drives Idle↔Walk. React state so the clip prop
  // re-renders; a ref mirror lets useFrame flip it without a stale closure and
  // without a setState every frame (only on the enter/leave transition).
  const [moving, setMoving] = useState<Record<string, boolean>>({});
  const movingRef = useRef(moving);
  movingRef.current = moving;

  // Live refs read inside useFrame (avoids stale closures on re-render).
  const playersRef = useRef<Player[]>(players);
  playersRef.current = players;
  const groups = useRef<Record<string, THREE.Group | null>>({});
  // Value types carry `| undefined` because these are sparse, id-keyed maps:
  // a key is absent until that token first walks / is seeded, so reads must be
  // (and are) guarded. Typing them honestly keeps the runtime guards meaningful.
  const anims = useRef<Record<string, Anim | undefined>>({});
  const seeded = useRef<Record<string, boolean>>({});
  const facing = useRef<Record<string, number | undefined>>({}); // last committed heading (y-rot)
  // Per-token TARGET yaw — decoupled from the committed heading so idle tokens
  // can continue lerping toward the desired rest direction (next-tile facing)
  // even when not walking. While walking, target = current-segment tangent;
  // on walk completion, target = next-tile direction from destination.
  const targetYaw = useRef<Record<string, number | undefined>>({});
  // Imperative handles to each character, for one-shot Victory/Defeat clips.
  const chars = useRef<Record<string, CharacterTokenHandle | null>>({});

  // ── Victory-on-gain detection ─────────────────────────────────────────────
  // Previous snapshot values keyed by player id. Null until the first snapshot
  // lands — so the initial load never triggers a celebration.
  const prevMoney = useRef<Record<string, number | undefined>>({});
  const prevPropCount = useRef<Record<string, number | undefined>>({});
  // Set to true while a Victory one-shot is in flight; prevents re-triggering.
  const isCelebrating = useRef<Record<string, boolean | undefined>>({});
  // Set to true when a gain is detected during an active run; cleared and played
  // once the walk finishes (so pass-GO salary celebrates on arrival, not mid-run).
  const pendingVictory = useRef<Record<string, boolean>>({});
  // Last players array REFERENCE seen by the subscribe listener — used to skip
  // store writes that did not touch the players array (e.g. setCameraReadout,
  // toasts, panels) without relying on subscribeWithSelector middleware.
  const prevPlayersRef = useRef<Player[] | undefined>(undefined);

  // ── Victory-on-gain: subscribe to store player snapshots ─────────────────
  // Runs whenever the authoritative state.players array changes (GAME_STATE_UPDATE
  // lands). Diffs each non-bankrupt player's money and properties.length against
  // the previous snapshot. The very FIRST snapshot initialises the baseline
  // without triggering Victory. On subsequent updates, a gain (money up OR
  // properties gained) schedules or plays the Victory one-shot.
  //
  // Cleanup: the subscribe returns an unsubscribe function; returned from useEffect
  // so it fires on unmount (no leak).
  useEffect(() => {
    const playVictory = (id: string) => {
      if (isCelebrating.current[id]) return;
      isCelebrating.current[id] = true;
      chars.current[id]?.play('Victory', {
        loop: false,
        onFinished: () => {
          isCelebrating.current[id] = false;
          // Return to the correct reactive state (Run if still moving, else Idle).
          chars.current[id]?.play(movingRef.current[id] ? 'Run' : 'Idle');
        },
      });
    };

    const unsub = useGameStore.subscribe((store) => {
      const players = store.state?.players;
      if (!players) return;
      // Skip all store writes that did not touch the players array reference
      // (e.g. setCameraReadout ~8×/sec, toasts, panels). No middleware needed.
      if (players === prevPlayersRef.current) return;
      prevPlayersRef.current = players;

      const isFirstSnapshot =
        Object.keys(prevMoney.current).length === 0 &&
        Object.keys(prevPropCount.current).length === 0;

      for (const p of players) {
        if (p.isBankrupt) {
          // Clean up tracking for removed/bankrupt players. A true `delete` (not
          // assign-undefined) is required so Object.keys(prevMoney).length stays
          // an accurate "have any baselines been recorded?" signal for the
          // first-snapshot check above, and so removed players leave no residue.
          /* eslint-disable @typescript-eslint/no-dynamic-delete -- id-keyed tracking maps; a real delete (not =undefined) preserves Object.keys length semantics used by first-snapshot detection */
          delete prevMoney.current[p.id];
          delete prevPropCount.current[p.id];
          delete pendingVictory.current[p.id];
          delete isCelebrating.current[p.id];
          /* eslint-enable @typescript-eslint/no-dynamic-delete */
          continue;
        }

        const prevM = prevMoney.current[p.id];
        const prevPC = prevPropCount.current[p.id];

        // Always update baseline (even on first snapshot).
        prevMoney.current[p.id] = p.money;
        prevPropCount.current[p.id] = p.properties.length;

        if (isFirstSnapshot) continue; // Initialise baseline only — no celebration.

        // Detect a gain: money up OR new properties acquired.
        const gained =
          (prevM !== undefined && p.money > prevM) ||
          (prevPC !== undefined && p.properties.length > prevPC);

        if (!gained) continue;

        // If the token is currently running (mid-hop), defer until walk ends.
        if (movingRef.current[p.id]) {
          pendingVictory.current[p.id] = true;
        } else {
          playVictory(p.id);
        }
      }
    });

    return unsub;
   
  }, []);

  // Server says a token moved → build the walk polyline + flag it moving.
  // `passedGo` rides along on the S_PlayerMoved contract event and is already
  // forwarded verbatim by GameStateSync (gameBus.emit('player-moved', data)),
  // so we can read it directly here without touching the socket contract.
  useGameBusEvent(
    'player-moved',
    (d: { playerId: string; from: number; to: number; passedGo?: boolean }) => {
      // DIRECTION of travel. The reliable signal is passedGo (the server credits
      // it whenever a forward move wrapped past GO). So a move is FORWARD when the
      // server passed GO, OR when the index simply increased; it is BACKWARD only
      // when the index decreased AND GO was not passed ("Go back N spaces" from a
      // non-corner tile decrements position without passing GO).
      //
      // Known negligible corner (do NOT over-engineer): a backward-3 from tiles
      // {0,1,2} lands on {37,38,39} with to>from and !passedGo, indistinguishable
      // from an "advance to Boardwalk"-type forward move → treated as forward.
      // Cosmetic + ultra-rare; left as-is intentionally.
      const forward = !!d.passedGo || d.to >= d.from;
      const tiles = buildTilePath(d.from, d.to, !forward);
      // A single-vertex path means no actual move (from === to) → stay Idle.
      if (tiles.length < 2) return;

      // Vertices are the RAW tile centers to glide through, in order. Stack
      // offset is NOT baked in here (see destOffset below) so segment tangents
      // — and therefore facing — stay true to the ring, un-skewed by the slot.
      const pts = tiles.map((idx) => {
        const [x, , z] = tileToWorld(idx);
        return { x, z };
      });

      // Seed the first vertex from the group's current world position when
      // available (handles rapid consecutive moves so the walk starts exactly
      // where the token is, with no visible jump); otherwise the `from` center.
      const group = groups.current[d.playerId];
      if (group) {
        pts[0] = { x: group.position.x, z: group.position.z };
      }

      // Destination stack slot. Applied as a FIXED positional bias added AFTER
      // the lerp (see useFrame), NOT baked into the final vertex — so the last
      // segment's tangent (facing) is computed from raw centers and never skews
      // toward the slot, while the token still comes to rest exactly on its slot.
      //
      // NOTE: at event time the store positions are still stale (the authoritative
      // GAME_STATE_UPDATE that moves this player to `d.to` arrives AFTER the anim
      // window). We predict the destination offset from `d.to` directly,
      // reproducing the same index rule the rest-reconcile uses, so the walk ends
      // exactly where the token will rest.
      const [dox, doz] = destOffset(d.playerId, d.to, playersRef.current);

      // perTile is driven solely by WALK_MS_PER_TILE — no server-window cap.
      // The walk intentionally outlasts the server's 150 ms/tile gate; the
      // reconcile else-branch only runs when anims.current[id] is absent, so
      // the in-flight walk owns the token's position and is never interrupted.
      const perTile = WALK_MS_PER_TILE;

      anims.current[d.playerId] = {
        pts,
        destOffset: { x: dox, z: doz },
        seg: 0,
        segElapsed: 0,
        perTile,
        toTile: d.to,
      };

      // Flip to 'Run' (only if not already flagged — avoids a redundant render).
      // Also clear isCelebrating so movement (Run) takes over from any in-flight
      // Victory one-shot — the reactive clip prop drives the crossfade.
      isCelebrating.current[d.playerId] = false;
      if (!movingRef.current[d.playerId]) {
        setMoving((m) => ({ ...m, [d.playerId]: true }));
      }
    },
  );

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
      if (anim && anim.seg < anim.pts.length - 1) {
        // Advance through segments, carrying overshoot so a fast frame can cross
        // more than one tile without stalling (keeps constant ground speed).
        anim.segElapsed += dtMs;
        while (anim.segElapsed >= anim.perTile && anim.seg < anim.pts.length - 2) {
          anim.segElapsed -= anim.perTile;
          anim.seg += 1;
        }

        const a = anim.pts[anim.seg];
        const b = anim.pts[anim.seg + 1];
        const t = Math.min(anim.segElapsed / anim.perTile, 1);

        // Position lerp uses RAW tile centers (a, b), so the resulting tangent
        // below is un-skewed. The destination stack offset is a FIXED positional
        // bias added on TOP of the lerp — ramped in only over the FINAL segment so
        // (a) intermediate segments ride the true ring centerline and (b) the
        // token still arrives exactly on its resting slot with no end-of-walk pop.
        const isLastSeg = anim.seg >= anim.pts.length - 2;
        const offX = isLastSeg ? anim.destOffset.x * t : 0;
        const offZ = isLastSeg ? anim.destOffset.z * t : 0;

        // Constant-speed glide along the current segment, feet flat on the board.
        group.position.x = THREE.MathUtils.lerp(a.x, b.x, t) + offX;
        group.position.z = THREE.MathUtils.lerp(a.z, b.z, t) + offZ;
        group.position.y = BASE_Y; // NO hop arc — walk at ground level.

        // FACING follows the CURRENT segment tangent, computed from the RAW tile
        // centers (offset excluded) so the last segment's heading points straight
        // down the ring rather than angling toward the stack slot. The target
        // heading flips discretely at each corner vertex; a fast, delta-scaled yaw
        // lerp (with an epsilon snap) closes that error within a frame or two, so
        // the turn reads as completing AT the corner, not one tile later.
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        if (Math.abs(dx) > 1e-6 || Math.abs(dz) > 1e-6) {
          // While walking: target = current-segment tangent.
          targetYaw.current[p.id] = Math.atan2(dx, dz) + FACING_OFFSET;
        }

        // Apply yaw lerp toward targetYaw (frame-rate aware, epsilon snap).
        // Runs every frame whether moving or idle so the turn settles smoothly.
        {
          const ty = targetYaw.current[p.id];
          if (ty !== undefined) {
            const cur = facing.current[p.id] ?? ty;
            const frac = Math.min(1, YAW_TURN_PER_FRAME * (dtMs / (1000 / 60)));
            const next = stepYaw(cur, ty, frac);
            group.rotation.y = next;
            facing.current[p.id] = next;
          }
        }

        seeded.current[p.id] = true;

        // Reached the final vertex → walk done.
        if (anim.seg >= anim.pts.length - 2 && anim.segElapsed >= anim.perTile) {
          // Snap to the exact final vertex + full stack offset to kill sub-pixel
          // drift and land precisely on the resting slot, then clear. (b is a raw
          // tile center, so the full destOffset is added here.)
          group.position.x = b.x + anim.destOffset.x;
          group.position.z = b.z + anim.destOffset.z;
          // Clear the in-flight anim so the reconcile else-branch takes over.
          // Assigning undefined (vs delete) is equivalent here: the map is only
          // read as `anims.current[id]` (truthiness), never key-iterated.
          anims.current[p.id] = undefined;

          // REST FACING (Fix B): on arrival, retarget yaw to the NEXT-tile
          // direction from the destination so the token pivots at the corner
          // rather than holding the incoming heading until next move. Matches
          // the mount-seed convention (same formula as the ref callback below).
          const toTile = anim.toTile;
          const [nx, , nz] = tileToWorld((toTile + 1) % 40);
          const [cx, , cz] = tileToWorld(toTile);
          const rdx = nx - cx;
          const rdz = nz - cz;
          if (Math.abs(rdx) > 1e-6 || Math.abs(rdz) > 1e-6) {
            targetYaw.current[p.id] = Math.atan2(rdx, rdz) + FACING_OFFSET;
          }

          // Deferred Victory: if a gain was detected while this token was running
          // (e.g. GO salary credited mid-move), play it now that the walk is done.
          // ORDERING (critical): set isCelebrating BEFORE setMoving so the render
          // triggered by setMoving reads isCelebrating=true and the CharacterToken
          // reactive-clip effect returns early (does NOT stomp Victory with Idle).
          if (pendingVictory.current[p.id] && !isCelebrating.current[p.id]) {
            pendingVictory.current[p.id] = false;
            isCelebrating.current[p.id] = true; // set BEFORE setMoving below
            const pid = p.id; // capture for closure
            chars.current[pid]?.play('Victory', {
              loop: false,
              onFinished: () => {
                isCelebrating.current[pid] = false;
                chars.current[pid]?.play(movingRef.current[pid] ? 'Run' : 'Idle');
              },
            });
          }

          // Path complete → back to 'Idle'. Guard so we setState only on the
          // transition, never every frame. Done AFTER the isCelebrating flag is
          // set (above) so the re-render from this setMoving already sees
          // isCelebrating=true and the CharacterToken reactive effect skips the
          // Run→Idle clip stomp.
          if (movingRef.current[p.id]) {
            setMoving((m) => {
              if (!m[p.id]) return m;
              // Setting false (vs deleting) is equivalent: `moving` is only read
              // for truthiness (`moving[id] ? 'Run' : 'Idle'`), never key-iterated.
              return { ...m, [p.id]: false };
            });
          }
        }
      } else {
        // Reconcile to the authoritative tile + stack offset (world space).
        const [x, , z] = tileToWorld(p.position);
        const [ox, oz] = restOffset(p, current);
        group.position.set(x + ox, BASE_Y, z + oz);
        seeded.current[p.id] = true;

        // Continue lerping toward targetYaw even while idle — the token pivots
        // smoothly to its rest facing (next-tile direction set on walk completion)
        // rather than snapping. Skip if no target is set yet (first frame).
        const ty = targetYaw.current[p.id];
        if (ty !== undefined) {
          const cur = facing.current[p.id] ?? ty;
          const frac = Math.min(1, YAW_TURN_PER_FRAME * (dtMs / (1000 / 60)));
          const next = stepYaw(cur, ty, frac);
          group.rotation.y = next;
          facing.current[p.id] = next;
        } else {
          // First frame before any walk: hold whatever seeded facing is on the group.
          group.rotation.y = facing.current[p.id] ?? group.rotation.y;
        }

        // Safety net: if some path left `moving` stuck true with no queue, clear
        // it (transition-guarded, so this is a no-op on the steady state).
        if (movingRef.current[p.id]) {
          setMoving((m) => {
            if (!m[p.id]) return m;
            // See above: set false rather than delete (truthiness-only reads).
            return { ...m, [p.id]: false };
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
        const hex = TOKEN_HEX[p.token];
        const char = resolveCharacter(p.character ?? DEFAULT_CHARACTER);
        const clip = moving[p.id] ? 'Run' : 'Idle';
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
                // using the same convention as walk-completion so rest and hop agree.
                const [nx, , nz] = tileToWorld((p.position + 1) % 40);
                const [cx, , cz] = tileToWorld(p.position);
                const rdx = nx - cx, rdz = nz - cz;
                const seedRot = Math.atan2(rdx, rdz) + FACING_OFFSET;
                g.rotation.y = seedRot;
                facing.current[p.id] = seedRot;
                // Also seed targetYaw so the idle lerp starts already settled
                // (no spurious pivot on first frame). Only seed if unset.
                targetYaw.current[p.id] ??= seedRot;
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
              isCelebrating={!!isCelebrating.current[p.id]}
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
