import { useRef, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * A rigged, animated character usable as a player token (ported from the
 * `spike/characters` proof — see scratchpad/character-spike-report.md). NOT yet
 * wired into PlayerTokens; that integration is CT3.
 *
 * WHY a per-instance clone: `useGLTF(url)` returns a single cached GLTF whose
 * `scene` (and its SkinnedMesh + Skeleton) is SHARED across every consumer of
 * that url. Rendering that shared scene twice would make both instances share
 * one skeleton → they animate in lockstep (same pose) and fight each other.
 * `SkeletonUtils.clone` deep-clones the scene AND rebinds each SkinnedMesh to a
 * fresh Skeleton whose bones are the cloned nodes, so every CharacterToken owns
 * an independent skeleton. drei's `useAnimations(clips, ref)` then spins up a
 * SEPARATE AnimationMixer per instance, bound to that instance's cloned scene,
 * so two tokens with the same url animate fully independently.
 *
 * Animation tracks target bones BY NAME, so the ORIGINAL gltf.animations clips
 * play correctly on the clone (same bone names) — no clip cloning required.
 *
 * COLOR: the character is rendered with its NATIVE materials — no color wash.
 * Each character already has meaningful colors (a Suit is grey, a Wizard purple,
 * etc.), so tinting them toward the player color made them wrong. Player
 * identity on the board is shown by the colored base ring under the token
 * (PlayerTokens), NOT by recoloring the character. We still clone every material
 * per instance so each token can dispose its own materials on unmount without
 * touching the shared cached gltf, but the clone is a faithful copy (colors
 * untouched). The `tint` prop is retained for API/back-compat but is a no-op.
 */
export type CharacterClip =
  | 'Idle'
  | 'Walk'
  | 'Jump'
  | 'Victory'
  | 'Defeat'
  | 'Run'
  | 'Death'
  | 'SitDown'
  | 'StandUp'
  | 'PickUp'
  | 'RecieveHit';

export interface CharacterTokenHandle {
  play: (clip: CharacterClip, opts?: { loop?: boolean; fade?: number }) => void;
}

/**
 * Clone a material per instance (so unmount can dispose it without touching the
 * shared cached gltf) — but keep the character's NATIVE color untouched. No
 * tint/wash: characters render with their own authored colors.
 */
function cloneMaterial(mat: THREE.Material): THREE.Material {
  return (mat as THREE.MeshStandardMaterial).clone();
}

/**
 * Allowlist of primary outfit material names (case-insensitive). The first name
 * in this list that appears in the skin's material set is chosen as the recolor
 * target. Skin/Face/Hair materials are never recolored.
 */
const OUTFIT_ALLOWLIST = ['shirt', 'clothes', 'main', 'jacket', 'armor'];
const SKIN_BLOCKLIST = ['skin', 'face', 'hair', 'eye'];

/**
 * Given a list of material names from a cloned scene, return the name of the
 * primary outfit material to recolor, or null if none qualifies.
 *
 * Strategy:
 * 1. Filter out any Skin/Face/Hair/Eye materials.
 * 2. Among the remaining, find the first whose name is in the OUTFIT_ALLOWLIST
 *    (case-insensitive match).
 * 3. If none match, fall back to the first non-skin material (largest by index).
 *
 * Exported so it can be unit-tested independently of Three.js.
 */
export function pickPrimaryMaterialName(names: string[]): string | null {
  const nonSkin = names.filter(
    (n) => !SKIN_BLOCKLIST.some((b) => n.toLowerCase().includes(b)),
  );
  if (nonSkin.length === 0) return null;
  const allowlisted = nonSkin.find((n) =>
    OUTFIT_ALLOWLIST.some((a) => n.toLowerCase().includes(a)),
  );
  return allowlisted ?? nonSkin[0];
}

/**
 * Apply `baseColor` to the primary outfit material of a cloned scene.
 * Skin/Face/Hair/Eye materials are never touched.
 */
function applyBaseColor(scene: THREE.Group, baseColor: string): void {
  // Collect all unique material names from the scene.
  const matNames: string[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m && m.name && !matNames.includes(m.name)) {
        matNames.push(m.name);
      }
    }
  });

  const targetName = pickPrimaryMaterialName(matNames);
  if (!targetName) return;

  const color = new THREE.Color(baseColor);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m && m.name === targetName) {
        (m as THREE.MeshStandardMaterial).color.set(color);
      }
    }
  });
}

interface CharacterTokenProps {
  url: string;
  /**
   * @deprecated No-op. Characters render with their NATIVE colors; player
   * identity is shown by the colored base ring under the token, not by
   * recoloring the character. Kept only for API/back-compat.
   */
  tint?: string;
  /**
   * Optional hex color to recolor the skin's PRIMARY outfit material (the first
   * material whose name is in the outfit allowlist, or the first non-skin
   * material). Skin/Face/Hair/Eye materials are never touched. When undefined or
   * null the native colors are kept unchanged. Recomputed when `baseColor` or
   * the source scene changes.
   */
  baseColor?: string;
  scale?: number;
  /** First clip played on mount (looped). Defaults to 'Idle'. */
  initialClip?: CharacterClip;
  /**
   * Reactive looping clip. When this prop changes the token crossfades to the
   * new clip (e.g. 'Idle' ↔ 'Walk' as a player starts/stops a hop). Optional —
   * omit it and drive clips purely via the imperative `play()` handle instead.
   * A change to `clip` never re-mounts the instance (same skeleton/mixer), so
   * PlayerTokens can flip Idle↔Walk per player without disturbing the useFrame
   * position lockstep.
   */
  clip?: CharacterClip;
  /** Local vertical offset for the whole rig, e.g. to seat feet on the tile. */
  y?: number;
}

/**
 * Renders one animated character. Feet sit at local y=0 (source models already
 * have feet at y≈0), scaled to ~board token height. Plays `initialClip` (Idle)
 * on loop; pass a reactive `clip` prop and/or call the imperative
 * `play('Walk')` / `play('Idle')` to switch.
 */
export const CharacterToken = forwardRef<CharacterTokenHandle, CharacterTokenProps>(
  function CharacterToken({ url, scale = 0.2, initialClip = 'Idle', clip, y = 0, baseColor }, apiRef) {
    const gltf = useGLTF(url);

    // Per-instance clone (independent skeleton). Materials are cloned so each
    // instance owns/disposes its own. NATIVE colors are kept unless `baseColor`
    // is provided, in which case only the primary outfit material is recolored
    // (Skin/Face/Hair/Eye are always left untouched).
    // Recompute when the source scene OR baseColor changes.
    const scene = useMemo(() => {
      const cloned = cloneSkeleton(gltf.scene) as THREE.Group;
      cloned.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mm) => cloneMaterial(mm));
        } else if (mesh.material) {
          mesh.material = cloneMaterial(mesh.material);
        }
      });
      // Apply outfit recolor after all materials are cloned (safe — per-instance).
      if (baseColor) {
        applyBaseColor(cloned, baseColor);
      }
      return cloned;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gltf.scene, baseColor]);

    // Dispose the per-instance cloned materials on unmount / re-clone. Geometry
    // is shared with the cached gltf (SkeletonUtils clones nodes but reuses
    // geometry buffers), so we only dispose the materials we cloned above.
    useEffect(() => {
      return () => {
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) =>
            m?.dispose(),
          );
        });
      };
    }, [scene]);

    // Ref the mixer to the cloned scene → its OWN AnimationMixer.
    const rootRef = useRef<THREE.Group>(null);
    const { actions, mixer } = useAnimations(gltf.animations, rootRef);
    const current = useRef<CharacterClip | null>(null);

    const play = useMemo(
      () =>
        (clip: CharacterClip, opts?: { loop?: boolean; fade?: number }) => {
          const next = actions[clip];
          if (!next) return;
          if (current.current === clip) return;
          const fade = opts?.fade ?? 0.18;
          const prev = current.current ? actions[current.current] : null;
          next.reset();
          next.setLoop(opts?.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
          next.clampWhenFinished = opts?.loop === false;
          next.enabled = true;
          next.setEffectiveWeight(1);
          if (prev && prev !== next) {
            next.crossFadeFrom(prev, fade, false).play();
          } else {
            next.fadeIn(fade).play();
          }
          current.current = clip;
        },
      [actions],
    );

    // Start on the initial clip once actions are ready.
    useEffect(() => {
      if (actions[initialClip]) play(initialClip);
    }, [actions, initialClip, play]);

    // Reactive clip prop: crossfade whenever it changes (Idle↔Walk driving).
    // `play` early-returns if the clip is already current, so redundant renders
    // are cheap and never re-trigger the animation.
    useEffect(() => {
      if (clip && actions[clip]) play(clip);
    }, [clip, actions, play]);

    useImperativeHandle(apiRef, () => ({ play }), [play]);

    // Keep the mixer reference from being GC-surprised (drei ticks it in useFrame).
    void mixer;

    return (
      <group ref={rootRef} scale={scale} position-y={y}>
        <primitive object={scene} />
      </group>
    );
  },
) as React.ForwardRefExoticComponent<
  CharacterTokenProps & React.RefAttributes<CharacterTokenHandle>
> & {
  /** Warm drei's GLTF cache for a character url ahead of first render. */
  preload: (url: string) => void;
};

/**
 * Preload a character `.glb` into drei's cache (same pattern as
 * `ModelMesh.preload`). Call only for characters that
 * are actually in the current game, not all 52 upfront.
 */
CharacterToken.preload = useGLTF.preload;
